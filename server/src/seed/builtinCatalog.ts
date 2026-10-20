/**
 * 内置课程目录。
 *
 * 「全年课程体系目录」是机构级的参考数据，不是某个老师的私有资产——所以直接打进镜像，
 * 服务启动时幂等灌库。任何账号登录后都能看到、能筛、能导出、能定掌握星级。
 * 老师自己上传的目录同样全局共享（见 routes/catalog.ts 的查询口径）。
 *
 * 幂等口径：按文件 sha256 判重。目录文件升级后 sha 变了，会作为一次新导入记录进来，
 * 旧记录留在历史里；课程本身按内容去重，不会重复灌。
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import ExcelJS from 'exceljs';
import { db } from '../config/database.js';
import { env } from '../config/env.js';
import { parseCatalogWorkbook, type Band } from '../utils/catalogParse.js';
import { log } from '../utils/logger.js';

/** 内置目录挂在谁名下：只为满足 user_id 的 NOT NULL + 外键，不是真人账号，登不进去 */
export const CATALOG_SYSTEM_USER = '__catalog__';

export interface BuiltInCatalogFile {
  /** 镜像里的文件名（ASCII，避开 git 与路径处理上的编码坑） */
  file: string;
  band: Band;
  /** 展示用文件名，写进 catalog_imports.filename */
  filename: string;
}

export const BUILTIN_CATALOGS: BuiltInCatalogFile[] = [
  { file: '2026-2027-primary.xlsx', band: '小初', filename: '2026-2027个性化小初全年课程体系目录.xlsx' },
  { file: '2026-2027-high.xlsx', band: '高中', filename: '2026-2027个性化高中全年课程体系目录.xlsx' },
];

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * 内置目录文件所在目录。
 * 源码跑是 src/seed/、编译后是 dist/seed/，都是「包根 / 一层 / seed」，
 * 往上两级就是包根，两种跑法拿到同一路径。
 */
export function seedDir(): string {
  return join(__dirname, '..', '..', 'seed', 'catalog');
}

function sha256(buffer: Uint8Array): string {
  return createHash('sha256').update(buffer).digest('hex');
}

async function loadWorkbook(buffer: Uint8Array): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  // exceljs 与新版 @types/node 的 Buffer 泛型定义不一致，这里直接跳过类型检查
  await wb.xlsx.load(buffer as any);
  return wb;
}

/** 系统账号：内置目录必须有归属人，但这个账号登录不了（口令是随机哈希） */
export function ensureCatalogSystemUser(): number {
  const row = db
    .prepare('SELECT id FROM users WHERE username = ?')
    .get(CATALOG_SYSTEM_USER) as { id: number } | undefined;
  if (row) return row.id;

  const secret = createHash('sha256')
    .update(process.pid + ':' + Date.now() + ':' + Math.random())
    .digest('hex');
  const result = db
    .prepare('INSERT INTO users (username, password) VALUES (?, ?)')
    .run(CATALOG_SYSTEM_USER, bcrypt.hashSync(secret, 10));
  return Number(result.lastInsertRowid);
}

export interface SeedResult {
  /** 本次新灌的导入记录数 */
  imports: number;
  /** 本次新灌的课程条数 */
  courses: number;
  /** 跳过原因（空串表示没跳过） */
  skipped: string;
}

/**
 * 把镜像里自带的目录灌进数据库。幂等：文件 sha 已存在就整份跳过。
 *
 * 目录文件缺失时（比如有人为了瘦身镜像删掉了 seed 目录）静默跳过，不影响启动。
 * 测试环境默认跳过（灌 3589 条会让每个用例变慢、还会污染行数断言），
 * 需要真的验一遍时传 { force: true }。
 */
export async function seedBuiltInCatalog(options: { force?: boolean } = {}): Promise<SeedResult> {
  if (!options.force && env.NODE_ENV === 'test') {
    return { imports: 0, courses: 0, skipped: '测试环境' };
  }

  const dir = seedDir();
  const missing = BUILTIN_CATALOGS.filter((f) => !existsSync(join(dir, f.file)));
  if (missing.length) {
    log.warn({ dir, missing: missing.map((f) => f.file) }, '内置课程目录文件缺失，跳过灌库');
    return { imports: 0, courses: 0, skipped: '目录文件缺失' };
  }

  const userId = ensureCatalogSystemUser();
  let imports = 0;
  let courses = 0;

  for (const f of BUILTIN_CATALOGS) {
    const buffer = readFileSync(join(dir, f.file));
    const digest = sha256(buffer);

    const exists = db
      .prepare('SELECT id FROM catalog_imports WHERE user_id = ? AND is_builtin = 1 AND file_sha256 = ?')
      .get(userId, digest);
    if (exists) continue;

    const parsed = await parseCatalogWorkbook(new Uint8Array(buffer), f.band, loadWorkbook);
    if (!parsed.courses.length) {
      log.warn({ file: f.file, failedSheets: parsed.failedSheets }, '内置课程目录没有解析出课程，跳过');
      continue;
    }

    const importId = db
      .prepare(
        `INSERT INTO catalog_imports
           (user_id, band, filename, file_sha256, courses_total, courses_imported, courses_duplicated, failed_sheets, is_builtin)
         VALUES (?, ?, ?, ?, ?, 0, 0, ?, 1)`
      )
      .run(userId, f.band, f.filename, digest, parsed.courses.length, JSON.stringify(parsed.failedSheets))
      .lastInsertRowid as number;

    // 去重口径跟用户导入一致：不带 user_id，跨账号去重
    const findExisting = db.prepare(
      `SELECT id FROM course_catalog
       WHERE band = ? AND grade = ? AND subject = ? AND track = ? AND term = ? AND seq = ?
         AND TRIM(content) = TRIM(?)`
    );
    const insertCourse = db.prepare(
      `INSERT INTO course_catalog
         (user_id, import_id, band, term, grade, subject, track, seq, content,
          type, score, difficulty, impact, textbook, section, sheet, source_row)
       VALUES
         (@user_id, @import_id, @band, @term, @grade, @subject, @track, @seq, @content,
          @type, @score, @difficulty, @impact, @textbook, @section, @sheet, @source_row)`
    );

    const written = db.transaction(() => {
      let n = 0;
      for (const c of parsed.courses) {
        if (findExisting.get(c.band, c.grade, c.subject, c.track, c.term, c.seq, c.content)) continue;
        insertCourse.run({
          user_id: userId,
          import_id: importId,
          band: c.band,
          term: c.term,
          grade: c.grade,
          subject: c.subject,
          track: c.track,
          seq: c.seq,
          content: c.content,
          type: c.type,
          score: c.score,
          difficulty: c.difficulty,
          impact: c.impact,
          textbook: c.textbook,
          section: c.section,
          sheet: c.sheet,
          source_row: c.sourceRow,
        });
        n++;
      }
      return n;
    })();

    db.prepare('UPDATE catalog_imports SET courses_imported = ?, courses_duplicated = ? WHERE id = ?')
      .run(written, parsed.courses.length - written, importId);

    imports++;
    courses += written;
    log.info(
      { file: f.filename, courses: written, failedSheets: parsed.failedSheets.length },
      '内置课程目录已灌库'
    );
  }

  return { imports, courses, skipped: '' };
}
