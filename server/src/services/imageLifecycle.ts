import fs from 'fs';
import path from 'path';
import { db } from '../config/database.js';
import { env } from '../config/env.js';
import { parseImages } from '../utils/mappers.js';

/**
 * 图片生命周期管理。
 *
 * 需求背景：
 *  1) 正式归档按【账户名】而不是数字 ID 建目录，便于老师辨认与备份；
 *  2) 只保留"已保存回访"的图片 —— 没保存的不该一直躺在磁盘上。
 *
 * 设计（暂存 → 提交）：
 *  - 上传先落到 uploads/_staging/<账户名>/（AI 生成与预览都从这里读）。
 *    这是必须的：生成发生在保存之前，模型要能读到图。
 *  - 保存回访时把暂存图【提交】到 uploads/<账户名>/，记录里存最终路径。
 *  - 被放弃的暂存图由 GC 清理（与草稿同样保留 7 天，
 *    因为跨设备草稿可能引用着这张暂存图）。
 *  - 已保存回访里删掉的引用、以及历史遗留的孤儿文件，由清理任务一并回收。
 */

/** 暂存目录名（放在 uploads 树内，AI 读图按相对路径即可解析到） */
export const STAGING_DIR_NAME = '_staging';
/** 暂存保留期：与草稿 TTL 一致 —— 草稿过期后其引用的暂存图才允许被清理 */
export const STAGING_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function stagingRoot(): string {
  return path.join(env.UPLOAD_DIR, STAGING_DIR_NAME);
}

/**
 * 账户名 -> 目录名。
 * 允许中文等常规字符，但拦截一切可能造成路径穿越或与保留名冲突的形态；
 * 不安全的账户名回落为数字 ID（老路径习惯），保证任何输入都出不了事。
 */
export function safeFolderName(username: string): string {
  const n = String(username || '').trim();
  if (!n) return '';
  if (n === '.' || n === '..' || n === STAGING_DIR_NAME) return '';
  if (n.includes('/') || n.includes('\\') || n.includes('..')) return '';
  // 控制字符一律拒绝
  if (/[\u0000-\u001f]/.test(n)) return '';
  return n;
}

/** 某用户的归档目录名：优先账户名，不安全时回落数字 ID */
export function ownerFolderFor(userId: number): string {
  const row = db.prepare('SELECT username FROM users WHERE id = ?').get(userId) as any;
  const folder = row ? safeFolderName(row.username || '') : '';
  return folder || String(userId);
}

/** 某用户暂存目录（上传先落这里） */
export function stagingDirFor(userId: number): string {
  return path.join(stagingRoot(), ownerFolderFor(userId));
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * 保存回访时【提交】图片：把暂存图从 _staging 挪到正式归档目录。
 * 已是正式路径（历史数据/外部路径）的条目原样保留。
 * 文件缺失（如被 GC 清理）则跳过并记日志，不让保存失败。
 */
export function commitImages(userId: number, images: string[]): string[] {
  const result: string[] = [];
  const owner = ownerFolderFor(userId);
  const stagingPrefix = STAGING_DIR_NAME + '/';

  for (const raw of images) {
    const rel = String(raw || '').trim();
    if (!rel) continue;

    if (!rel.startsWith(stagingPrefix)) {
      // 历史正式路径（<uid>/x.png 或 <username>/x.png）：不动
      result.push(rel);
      continue;
    }

    // _staging/<folder>/<filename> -> <owner>/<filename>
    const rest = rel.slice(stagingPrefix.length);
    const parts = rest.split('/');
    if (parts.length !== 2) {
      console.warn('[图片提交] 暂存路径格式异常，跳过: ' + rel);
      continue;
    }

    const from = path.resolve(env.UPLOAD_DIR, rel);
    const to = path.join(env.UPLOAD_DIR, owner, parts[1]);

    // 防穿越：源必须仍在暂存区内
    if (!from.startsWith(stagingRoot() + path.sep)) {
      console.warn('[图片提交] 暂存路径越界，跳过: ' + rel);
      continue;
    }

    if (!fs.existsSync(from)) {
      console.warn('[图片提交] 暂存图已不存在（可能被清理），跳过: ' + rel);
      continue;
    }

    ensureDir(path.dirname(to));
    fs.renameSync(from, to);
    result.push(owner + '/' + parts[1]);
  }

  return result;
}

/**
 * 删除一张暂存图（表单里点 X 时调用）。
 * 只允许删 _staging 下属于该用户的文件 —— 正式归档一律不可通过此入口删除。
 */
export function discardStagedImage(userId: number, imagePath: string): boolean {
  const rel = String(imagePath || '').trim();
  const stagingPrefix = STAGING_DIR_NAME + '/';
  if (!rel.startsWith(stagingPrefix)) return false;

  const from = path.resolve(env.UPLOAD_DIR, rel);
  const root = stagingRoot() + path.sep;
  if (!from.startsWith(root)) return false;

  // 必须是该用户自己的暂存目录
  const owner = rel.split('/')[1] || '';
  const mine = ownerFolderFor(userId);
  const uidFolder = String(userId);
  if (owner !== mine && owner !== uidFolder) return false;

  if (!fs.existsSync(from)) return false;
  fs.unlinkSync(from);
  return true;
}

/**
 * 启动迁移：把历史 uploads/<uid>/ 目录改名为 uploads/<账户名>/，
 * 并同步改写 followups 与 drafts 里存的引用路径。
 * 幂等：目标已存在同名文件则跳过；账户名不安全则保留原样。
 */
export function migrateLegacyFolders(): { movedFiles: number; renamedDirs: number } {
  let movedFiles = 0;
  let renamedDirs = 0;

  if (!fs.existsSync(env.UPLOAD_DIR)) return { movedFiles, renamedDirs };

  const users = db.prepare('SELECT id, username FROM users').all() as any[];
  for (const u of users) {
    const folder = safeFolderName(u.username || '');
    if (!folder) continue; // 账户名不适合做目录名 → 保留数字 ID 目录

    const legacyDir = path.join(env.UPLOAD_DIR, String(u.id));
    const targetDir = path.join(env.UPLOAD_DIR, folder);
    if (!fs.existsSync(legacyDir)) continue;

    ensureDir(targetDir);
    const legacyPrefix = u.id + '/';
    const newPrefix = folder + '/';

    // 1) 移动文件（跳过同名冲突）
    for (const name of fs.readdirSync(legacyDir)) {
      const from = path.join(legacyDir, name);
      const to = path.join(targetDir, name);
      if (fs.existsSync(to)) continue;
      if (fs.statSync(from).isFile()) {
        fs.renameSync(from, to);
        movedFiles++;
      }
    }

    // 2) 改写数据库引用（followups.images 为 JSON 数组）
    const rows = db.prepare('SELECT id, images FROM followups WHERE user_id = ?').all(u.id) as any[];
    const update = db.prepare('UPDATE followups SET images = ? WHERE id = ?');
    for (const r of rows) {
      const imgs = parseImages(r.images).map((p) =>
        p.startsWith(legacyPrefix) ? newPrefix + p.slice(legacyPrefix.length) : p
      );
      update.run(JSON.stringify(imgs), r.id);
    }

    // 3) 改写草稿里的引用
    const drafts = db.prepare('SELECT user_id, payload FROM drafts WHERE user_id = ?').all(u.id) as any[];
    const updateDraft = db.prepare('UPDATE drafts SET payload = ? WHERE user_id = ?');
    for (const d of drafts) {
      try {
        const payload = JSON.parse(d.payload);
        if (Array.isArray(payload?.images)) {
          payload.images = payload.images.map((p: string) =>
            typeof p === 'string' && p.startsWith(legacyPrefix)
              ? newPrefix + p.slice(legacyPrefix.length)
              : p
          );
          updateDraft.run(JSON.stringify(payload), u.id);
        }
      } catch {
        /* 脏数据跳过 */
      }
    }

    // 4) 目录已空则移除
    if (fs.readdirSync(legacyDir).length === 0) {
      fs.rmdirSync(legacyDir);
      renamedDirs++;
    }
  }

  return { movedFiles, renamedDirs };
}

/** 递归收集目录下所有文件（相对根的路径） */
function walkFiles(root: string, base: string, out: string[]): void {
  if (!fs.existsSync(root)) return;
  for (const name of fs.readdirSync(root)) {
    const full = path.join(root, name);
    if (fs.statSync(full).isDirectory()) {
      walkFiles(full, base, out);
    } else {
      out.push(path.relative(base, full));
    }
  }
}

/**
 * 清理过期的暂存图。
 * 保留期与草稿一致：草稿还没过期，它引用的暂存图就不能删。
 */
export function gcStagedImages(maxAgeMs = STAGING_TTL_MS): number {
  const root = stagingRoot();
  if (!fs.existsSync(root)) return 0;

  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;

  const walk = (dir: string) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(full);
        removed++;
      }
    }
  };
  walk(root);

  return removed;
}

/**
 * 回收"没有任何记录引用"的正式归档图（含历史遗留的孤儿文件）。
 * 引用来源：所有 followups.images + 所有草稿 payload.images。
 * 只删超过保留期的文件，避免误删刚操作过的内容。
 */
export function cleanupOrphanImages(maxAgeMs = STAGING_TTL_MS): number {
  if (!fs.existsSync(env.UPLOAD_DIR)) return 0;

  const referenced = new Set<string>();

  for (const r of db.prepare('SELECT images FROM followups').all() as any[]) {
    for (const p of parseImages(r.images)) referenced.add(p);
  }

  for (const d of db.prepare('SELECT payload FROM drafts').all() as any[]) {
    try {
      const payload = JSON.parse(d.payload);
      if (Array.isArray(payload?.images)) {
        for (const p of payload.images) if (typeof p === 'string') referenced.add(p);
      }
    } catch {
      /* 脏数据跳过 */
    }
  }

  const stagingRel = STAGING_DIR_NAME + path.sep;
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;

  for (const rel of walkToArray(env.UPLOAD_DIR)) {
    // 暂存区由 gcStagedImages 负责
    if (rel.startsWith(stagingRel)) continue;

    if (!referenced.has(rel)) {
      const full = path.join(env.UPLOAD_DIR, rel);
      if (fs.statSync(full).mtimeMs < cutoff) {
        fs.unlinkSync(full);
        removed++;
      }
    }
  }

  return removed;
}

function walkToArray(root: string): string[] {
  const out: string[] = [];
  walkFiles(root, root, out);
  return out;
}
