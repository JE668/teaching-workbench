import { Router } from 'express';
import type { Response } from 'express';
import fs from 'node:fs';
import crypto from 'node:crypto';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { db } from '../config/database.js';
import { AuthenticatedRequest } from '../types/index.js';
import { dedupeCourseCatalog, resetCatalogToBuiltIn } from '../migrations/catalogDedupe.js';
import { parseCatalogWorkbook, type Band } from '../utils/catalogParse.js';
import {
  COURSE_ORDER,
  compareGrade,
  compareSubject,
  compareTerm,
  compareTrack,
  compareZh,
} from '../utils/catalogOrder.js';
import { suggestMasteryStars } from '../services/catalogStar.js';
import { STAR_SCOPE_LIMIT } from '../utils/catalogStar.js';
import {
  buildCatalogXlsx,
  buildCatalogFilename,
  type CatalogExcelInput,
} from '../utils/catalogExcel.js';

/**
 * 全年课程体系目录。
 *
 * 老师自己维护两份 Excel（高中 / 小初），列布局 6 种、合并单元格、分区标题行都很多，
 * 手工搬运到工作台不现实。这里做一次批量导入落库，后面「课程总结」「课程规划」
 * 都从 course_catalog 取数。
 *
 * 导入是可重复的：同一个文件重复上传不会重复灌库，按
 * (band, grade, subject, track, term, seq, content) 判重。
 *
 * 目录是**全局共享**的：内置课程目录随镜像灌库，老师自己导入的目录也所有人可见。
 * 所有读接口都不带 user_id 过滤；user_id 只留作「谁导入的」留痕。
 * 去重同样是跨账号的——两个人导入同一份文件，第二个人得到「全部重复」。
 */
const router = Router();

const BANDS: Band[] = ['高中', '小初'];

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

function sha256(buffer: Uint8Array): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * 上传文件名的编码订正。
 *
 * multer 按 latin1 解码 multipart 的 filename，中文文件名会变成「ä¸ªæ...」这种乱码，
 * 而文件名是要展示给老师看的。把 latin1 字节按 UTF-8 重新解一遍就对了；
 * 本来就是 ASCII 的名字解完不变，替换字符说明不是这种乱码，原样返回。
 */
function safeFilename(raw: string): string {
  try {
    const fixed = Buffer.from(raw, 'latin1').toString('utf8');
    return fixed === raw || fixed.includes('\uFFFD') ? raw : fixed;
  } catch {
    return raw;
  }
}

async function loadWorkbook(buffer: Uint8Array): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  // exceljs 与新版 @types/node 的 Buffer 泛型定义不一致，这里直接跳过类型检查
  await wb.xlsx.load(buffer as any);
  return wb;
}

/**
 * 上传并导入一份目录。
 * Body（multipart/form-data）：
 *   file  — .xlsx 文件
 *   band  — 高中 | 小初
 *   dryRun — 传 '1' 时只解析不落库，返回将要导入的明细，供前端预览
 */
router.post('/import', (req: AuthenticatedRequest, res) => {
  upload.single('file')(req, res, async (err) => {
    try {
      if (err) return res.status(400).json({ error: '文件读取失败', message: err.message });
      const file = req.file;
      if (!file) return res.status(400).json({ error: '请上传 Excel 文件' });
      const filename = safeFilename(file.originalname);
      if (!/\.xlsx$/i.test(filename)) {
        return res.status(400).json({ error: '仅支持 .xlsx 格式' });
      }

      const userId = req.userId!;
      const band = (req.body?.band as string) || '';
      if (!BANDS.includes(band as Band)) {
        return res.status(400).json({ error: '请选择学段（高中 / 小初）' });
      }
      const dryRun = req.body?.dryRun === '1' || req.body?.dryRun === 1;

      const buffer = file.buffer;
      const digest = sha256(buffer);
      const parsed = await parseCatalogWorkbook(new Uint8Array(buffer), band as Band, loadWorkbook);

      const preview = parsed.sheets.map((s) => ({
        sheet: s.sheet,
        grade: s.grade,
        subject: s.subject,
        courses: s.courses,
        error: s.error,
      }));

      if (dryRun) {
        return res.json({
          dryRun: true,
          filename,
          band,
          coursesTotal: parsed.courses.length,
          failedSheets: parsed.failedSheets,
          sheets: preview,
        });
      }

      if (!parsed.courses.length) {
        return res.status(422).json({
          error: '没有解析出任何课程',
          message: '请确认上传的是「全年课程体系目录」工作簿',
          failedSheets: parsed.failedSheets,
          sheets: preview,
        });
      }

      const importId = db
        .prepare(
          `INSERT INTO catalog_imports (user_id, band, filename, file_sha256, courses_total, courses_imported, courses_duplicated, failed_sheets)
           VALUES (?, ?, ?, ?, ?, 0, 0, ?)`,
        )
        .run(userId, band, filename, digest, parsed.courses.length, JSON.stringify(parsed.failedSheets))
        .lastInsertRowid as number;

      const findExisting = db.prepare(`
        SELECT id FROM course_catalog
        WHERE band = ? AND grade = ? AND subject = ? AND track = ? AND term = ? AND seq = ?
          AND TRIM(content) = TRIM(?)
      `);

      let imported = 0;
      let duplicated = 0;
      // 语句在请求时才 prepare：模块加载时数据库可能还没初始化
      const insertCourse = db.prepare(`
        INSERT INTO course_catalog
          (user_id, import_id, band, term, grade, subject, track, seq, content,
           type, score, difficulty, impact, textbook, section, sheet, source_row)
        VALUES
          (@user_id, @import_id, @band, @term, @grade, @subject, @track, @seq, @content,
           @type, @score, @difficulty, @impact, @textbook, @section, @sheet, @source_row)
      `);
      const tx = db.transaction(() => {
        for (const c of parsed.courses) {
          const exists = findExisting.get(c.band, c.grade, c.subject, c.track, c.term, c.seq, c.content) as { id: number } | undefined;
          if (exists) {
            duplicated++;
            continue;
          }
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
          imported++;
        }
      });
      tx();

      db.prepare('UPDATE catalog_imports SET courses_imported = ?, courses_duplicated = ? WHERE id = ?')
        .run(imported, duplicated, importId);

      res.json({
        importId,
        filename,
        band,
        sha256: digest,
        coursesTotal: parsed.courses.length,
        coursesImported: imported,
        coursesDuplicated: duplicated,
        failedSheets: parsed.failedSheets,
        sheets: preview,
      });
    } catch (error: any) {
      res.status(500).json({ error: '导入失败', message: error.message });
    }
  });
});

function clean(v: unknown): string {
  return v == null ? '' : String(v);
}

/**
 * /courses 和 /xlsx 共用一套筛选口径。
 *
 * 目录页在前端本地过滤，导出走服务端；两边各写一份筛选逻辑，迟早会出现
 * 「导出的比页面上多 / 少几门」。所以收敛成这一个函数。
 *
 * 目录全局共享，不按 user_id 圈范围：任何账号看到的都是全量目录。
 */
function courseFilter(req: AuthenticatedRequest) {
  // 1=1 兜底：一个筛选都不传时 where 数组是空的，直接拼 WHERE 会变成非法 SQL
  const where: string[] = ['1=1'];
  const params: unknown[] = [];

  for (const key of ['grade', 'subject', 'term', 'type', 'track', 'textbook', 'sheet'] as const) {
    const v = clean(req.query[key]).trim();
    if (v) {
      where.push(`${key} = ?`);
      params.push(v);
    }
  }
  const q = clean(req.query.q).trim();
  if (q) {
    // 5 个字段跟前端 filtered 完全一致，教材版本和难度以前搜不到
    where.push('(content LIKE ? OR section LIKE ? OR textbook LIKE ? OR type LIKE ? OR difficulty LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  return { clause: where.join(' AND '), params };
}

router.get('/courses', (req: AuthenticatedRequest, res) => {
  try {
    const { clause, params } = courseFilter(req);
    const limit = Math.min(Math.max(Number(req.query.limit) || 5000, 1), 20000);
    const sql = `SELECT * FROM course_catalog WHERE ${clause} ${COURSE_ORDER} LIMIT ?`;
    params.push(limit);

    const rows = db.prepare(sql).all(...params) as any[];
    res.json({ courses: rows.map(mapCourse), total: rows.length });
  } catch (error: any) {
    res.status(500).json({ error: '查询课程目录失败', message: error.message });
  }
});

/**
 * 导出当前筛选范围的课程目录为 Excel。
 *
 * 老师要给家长 / 校区留一份「这学期上哪些课」的清单，以前只能整本拖下来自己删，
 * 现在筛完直接导出就是那一屏。没有筛选条件时导出全部。
 */
router.get('/xlsx', async (req: AuthenticatedRequest, res) => {
  try {
    const { clause, params } = courseFilter(req);
    const rows = db
      .prepare(`SELECT * FROM course_catalog WHERE ${clause} ${COURSE_ORDER}`)
      .all(...params) as any[];

    const input: CatalogExcelInput = {
      title: `课程目录 · 共 ${rows.length} 课`,
      courses: rows.map((r) => ({
        grade: r.grade,
        subject: r.subject,
        term: r.term,
        track: r.track,
        seq: r.seq,
        content: r.content,
        type: r.type,
        score: r.score,
        difficulty: r.difficulty,
        textbook: r.textbook,
      })),
    };

    const buf = await buildCatalogXlsx(input);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(buildCatalogFilename(input))}`
    );
    res.setHeader('Cache-Control', 'no-store');
    res.send(buf);
  } catch (error: any) {
    res.status(500).json({ error: '导出课程目录失败', message: error.message });
  }
});

/**
 * 目录 ↔ 报告 / 听评课打通：每门目录课程被用过几次。
 *
 * 明细行的 kind='summary' 记在「已上的课」，'plan' 记在「下月要上的课」，
 * 听评课记录整条算一次「上过这门课」（老师旁听了这节课）。
 * 于是目录里能看出「已经给几个学生上过了 / 计划给几个 / 被听过几节课」。
 * 一次性返回全量映射，前端按 course_id 自己 join —— 几百门课不需要 N 次请求。
 *
 * 传 ?student_id= 时只返回这个学生的：目录页「按学生看进度」模式用，
 * 聚合口径从「全校区」收窄到「一个人」，数据量和数字含义都跟着变。
 * 听评课没有学生外键（学生只是记个姓名），没法归到某个学生头上，
 * 所以收窄到单学生口径时把听评课整块拿掉，避免进度数字被旁听记录污染。
 */
router.get('/usage', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const studentParam = Number(req.query.student_id);
    const onlyStudent = Number.isInteger(studentParam) && studentParam > 0;
    const rows = db
      .prepare(
        `SELECT course_id, kind, source, ref_id, year_month, student_id, student_name FROM (
           SELECT ri.course_id AS course_id, ri.kind AS kind, 'report' AS source, ri.id AS ref_id,
                  mr.year_month AS year_month, mr.student_id AS student_id,
                  s.name AS student_name
           FROM report_items ri
           JOIN monthly_reports mr ON mr.id = ri.report_id AND mr.user_id = ri.user_id
           LEFT JOIN students s ON s.id = mr.student_id
           WHERE ri.user_id = ? AND ri.course_id IS NOT NULL AND ri.kind IN ('summary', 'plan')
                 ${onlyStudent ? 'AND mr.student_id = ?' : ''}
           ${onlyStudent ? '' : `UNION ALL
           SELECT o.course_id AS course_id, 'summary' AS kind, 'observation' AS source, o.id AS ref_id,
                  substr(o.observed_at, 1, 7) AS year_month, NULL AS student_id,
                  o.student_name AS student_name
           FROM observations o
           WHERE o.user_id = ? AND o.course_id IS NOT NULL`}
         ) ORDER BY course_id, year_month DESC, student_name`
      )
      .all(...(onlyStudent ? [userId, studentParam] : [userId, userId])) as any[];

    const usage: Record<string, unknown> = {};
    for (const r of rows) {
      const key = String(r.course_id);
      const entry =
        (usage[key] as any) ||
        (usage[key] = { course_id: r.course_id, taught: 0, planned: 0, observed: 0, entries: [] });
      if (r.kind === 'plan') entry.planned++;
      else if (r.source === 'observation') entry.observed++;
      else entry.taught++;
      entry.entries.push({
        report_id: r.ref_id,
        student_id: r.student_id,
        student_name: r.student_name ?? '',
        year_month: r.year_month,
        kind: r.kind,
        source: r.source,
      });
    }
    res.json({ usage });
  } catch (error: any) {
    res.status(500).json({ error: '查询课程使用情况失败', message: error.message });
  }
});

/**
 * AI 批量定掌握星级（SSE）。
 *
 * 老师手点几百门课定档不现实，让模型先给一档，回来照表改。
 * 按当前筛选范围取未定档的课程，分批送模型，每批落库一次——
 * 中途断了再点一次只补剩下的，不会重复定档。
 *
 * 事件：start → progress × N → done | error
 */
router.post('/courses/suggest-stars', (req: AuthenticatedRequest, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  let clientGone = false;
  res.on('close', () => {
    if (!res.writableEnded) clientGone = true;
  });
  const send = (event: string, data: unknown) => {
    if (clientGone || res.writableEnded) return;
    try {
      res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n');
    } catch {
      clientGone = true;
    }
  };

  (async () => {
    try {
      const body = req.body || {};
      // 默认只补未定档的：老师手改过的不会被 AI 覆盖
      const onlyEmpty = body.onlyEmpty !== false;
      const limit = Math.min(
        Math.max(Math.floor(Number(body.limit) || STAR_SCOPE_LIMIT), 1),
        STAR_SCOPE_LIMIT
      );

      // 目录全局共享，定档范围也是全量目录，不按 user_id 圈
      // 1=1 兜底：一个筛选都不传时 where 是空的，直接拼 WHERE 会变成非法 SQL
      const where: string[] = ['1=1'];
      const params: unknown[] = [];
      for (const key of ['grade', 'subject', 'term', 'track', 'type'] as const) {
        const v = clean(body[key]).trim();
        if (v) {
          where.push(key + ' = ?');
          params.push(v);
        }
      }
      if (onlyEmpty) where.push('mastery_star IS NULL');

      const rows = db
        .prepare(
          `SELECT id, content, type, score, difficulty, impact, section, grade, subject, term, track
           FROM course_catalog
           WHERE ${where.join(' AND ')}
           ${COURSE_ORDER}
           LIMIT ?`
        )
        .all(...params, limit) as any[];

      send('start', { total: rows.length, limit, onlyEmpty });
      if (!rows.length) {
        send('done', { total: 0, batches: 0, updated: 0, model: '' });
        return;
      }

      // onlyEmpty 时加 IS NULL 守卫：老师手改过的不被 AI 覆盖；
      // 关了就重定全部，连已定档的一起换。
      const updateStar = db.prepare(
        `UPDATE course_catalog SET mastery_star = ?, updated_at = datetime('now', '+8 hours')
         WHERE id = ?` +
          (onlyEmpty ? ' AND mastery_star IS NULL' : '')
      );

      let updated = 0;
      const result = await suggestMasteryStars(
        rows.map((r) => ({
          id: Number(r.id),
          content: String(r.content || ''),
          type: String(r.type || ''),
          score: String(r.score || ''),
          difficulty: String(r.difficulty || ''),
          impact: String(r.impact || ''),
          section: String(r.section || ''),
        })),
        (batch, totalBatches, decisions) => {
          if (clientGone) throw new Error('客户端已断开');
          const written = db.transaction(() => {
            let n = 0;
            for (const d of decisions) {
              n += updateStar.run(d.star, d.id).changes;
            }
            return n;
          })();
          updated += written;
          send('progress', { batch, totalBatches, updated, total: rows.length });
        },
        {
          grade: clean(body.grade).trim() || undefined,
          subject: clean(body.subject).trim() || undefined,
          term: clean(body.term).trim() || undefined,
          track: clean(body.track).trim() || undefined,
        }
      );

      send('done', result);
    } catch (error: any) {
      send('error', { error: String(error?.message || 'AI 定档失败'), batch: error?.batch || null });
    } finally {
      if (!res.writableEnded) res.end();
    }
  })();
});

export function mapCourse(row: any) {
  return {
    id: row.id,
    import_id: row.import_id,
    band: row.band,
    term: row.term,
    grade: row.grade,
    subject: row.subject,
    track: row.track,
    seq: row.seq,
    content: row.content,
    type: row.type,
    score: row.score,
    difficulty: row.difficulty,
    impact: row.impact,
    textbook: row.textbook,
    section: row.section,
    sheet: row.sheet,
    source_row: row.source_row,
    mastery_star: row.mastery_star == null ? null : Number(row.mastery_star),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * 筛选项取值：给前端的下拉框用。
 *
 * 年级 / 学科 / 学期 / 轨 按教学口径排（不是字典序——字典序会把初一排到四年级前面），
 * 其余按中文本地序。前端直接按返回顺序渲染，不用自己再排一遍。
 */
router.get('/facets', (req: AuthenticatedRequest, res) => {
  try {
    const values = (col: string) =>
      (db.prepare(`SELECT DISTINCT ${col} AS v FROM course_catalog`).all() as any[])
        .map((r) => String(r.v ?? ''));

    const distinct = (col: string, cmp: (a: string, b: string) => number) =>
      values(col).filter((v) => v !== '').sort(cmp);

    res.json({
      grades: distinct('grade', compareGrade),
      subjects: distinct('subject', compareSubject),
      terms: distinct('term', compareTerm),
      types: distinct('type', compareZh),
      tracks: distinct('track', compareTrack),
      textbooks: distinct('textbook', compareZh),
      sheets: values('sheet').filter((v) => v !== '').sort(compareZh),
    });
  } catch (error: any) {
    res.status(500).json({ error: '查询筛选项失败', message: error.message });
  }
});

/**
 * 导入历史。目录全局共享，所以这里列的是**所有人**的导入记录，
 * 带上导入人账号，好知道哪份是谁传的。
 */
router.get('/imports', (req: AuthenticatedRequest, res) => {
  try {
    const rows = db
      .prepare(
        `SELECT i.*, u.username AS importer
         FROM catalog_imports i
         LEFT JOIN users u ON u.id = i.user_id
         ORDER BY i.id DESC`
      )
      .all() as any[];
    res.json({
      imports: rows.map((r) => ({
        ...r,
        is_builtin: Number(r.is_builtin) === 1,
        failed_sheets: safeParse(r.failed_sheets),
      })),
    });
  } catch (error: any) {
    res.status(500).json({ error: '查询导入历史失败', message: error.message });
  }
});

function safeParse(s: unknown): string[] {
  try {
    const v = JSON.parse(String(s || '[]'));
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * 合并重复课程（同一门课被灌进库里两次）。
 *
 * 启动时已经自动跑过一次并写 schema_migrations 留痕，这里再给一个手工入口：
 * 用户自己又导了一份跟内置重复的目录时，不用重启容器就能收敛。
 */
router.post('/dedupe', (_req: AuthenticatedRequest, res) => {
  try {
    res.json(dedupeCourseCatalog({ force: true }));
  } catch (error: any) {
    res.status(500).json({ error: '清理重复课程失败', message: error.message });
  }
});

/**
 * 只保留系统内置的课程目录：账号自己导入的导入记录和课程整批清掉。
 *
 * 去重合不掉「导的是一套不一样的课表」——那种情况下目录只会越堆越多、去重永远
 * 收不拢。所以给一把更彻底的刀。删之前会把月度总结 / 课堂观察里指向被删课程
 * 的引用改指到内置同名课（有同名课才改指），已经写过的总结、观察不变孤儿。
 * 收尾会再跑一轮去重，内置那份内部的历史重复也顺手收掉。
 */
router.post('/reset-to-builtin', (_req: AuthenticatedRequest, res) => {
  try {
    res.json(resetCatalogToBuiltIn());
  } catch (error: any) {
    res.status(500).json({ error: '清理已导入课程失败', message: error.message });
  }
});

/** 掌握星级等字段的手改。目录全局共享，所以改的是共享数据 */
router.patch('/courses/:id', (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: '非法的课程 id' });

    const sets: string[] = [];
    const params: unknown[] = [];

    if (req.body?.mastery_star !== undefined) {
      const star = req.body.mastery_star === null ? null : Number(req.body.mastery_star);
      if (star !== null && (!Number.isInteger(star) || star < 1 || star > 5)) {
        return res.status(400).json({ error: '掌握星级必须在 1-5 之间' });
      }
      sets.push('mastery_star = ?');
      params.push(star);
    }
    if (typeof req.body?.section === 'string') {
      sets.push('section = ?');
      params.push(req.body.section.trim());
    }
    if (!sets.length) return res.status(400).json({ error: '没有可更新的字段' });

    sets.push("updated_at = datetime('now', '+8 hours')");
    params.push(id);
    const r = db.prepare(`UPDATE course_catalog SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    if (!r.changes) return res.status(404).json({ error: '课程不存在' });

    res.json({ course: mapCourse(db.prepare('SELECT * FROM course_catalog WHERE id = ?').get(id) as any) });
  } catch (error: any) {
    res.status(500).json({ error: '更新失败', message: error.message });
  }
});

/**
 * 批量删除若干次导入及其全部课程。
 *
 * 必须声明在 DELETE /imports/:id 之前 —— 否则 "batch" 会被当成 :id 吃掉。
 * 内置目录（is_builtin）和已经不存在的 id 一律跳过并在 skipped 里报回来，
 * 绝不静默吞掉，否则用户以为删掉了其实还在。
 */
router.delete('/imports/batch', (req: AuthenticatedRequest, res) => {
  try {
    const raw = req.body?.ids;
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > 200) {
      return res.status(400).json({ error: '请传 1-200 个导入 id 的数组' });
    }
    const ids = [
      ...new Set(
        raw
          .map((v) => Number(v))
          .filter((v) => Number.isInteger(v) && v > 0),
      ),
    ];
    if (ids.length === 0) return res.status(400).json({ error: '没有有效的导入 id' });

    const skipped: { id: number; reason: string }[] = [];
    const removedIds: number[] = [];
    for (const id of ids) {
      const row = db
        .prepare('SELECT is_builtin FROM catalog_imports WHERE id = ?')
        .get(id) as { is_builtin: number } | undefined;
      if (!row) {
        skipped.push({ id, reason: '已不存在' });
        continue;
      }
      if (Number(row.is_builtin) === 1) {
        skipped.push({ id, reason: '内置目录不能删除' });
        continue;
      }
      removedIds.push(id);
    }

    let deleted = 0;
    db.transaction(() => {
      for (const id of removedIds) {
        deleted += db.prepare('DELETE FROM course_catalog WHERE import_id = ?').run(id).changes;
      }
      if (removedIds.length > 0) {
        db.prepare(
          'DELETE FROM catalog_imports WHERE id IN (' + removedIds.map(() => '?').join(',') + ')',
        ).run(...removedIds);
      }
    })();

    res.json({ deleted, removed: removedIds, skipped });
  } catch (error: any) {
    res.status(500).json({ error: '批量删除失败', message: error.message });
  }
});

/**
 * 删除一次导入及其全部课程。
 *
 * 内置课程目录是随镜像发版的机构级数据，删了就得重新灌库，直接禁止。
 */
router.delete('/imports/:id', (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: '非法的导入 id' });

    const imp = db
      .prepare('SELECT is_builtin FROM catalog_imports WHERE id = ?')
      .get(id) as { is_builtin: number } | undefined;
    if (imp && Number(imp.is_builtin) === 1) {
      return res.status(403).json({ error: '内置课程目录随镜像发版，不能删除' });
    }

    const removed = db.transaction(() => {
      const n = db.prepare('DELETE FROM course_catalog WHERE import_id = ?').run(id).changes;
      db.prepare('DELETE FROM catalog_imports WHERE id = ?').run(id);
      return n;
    })();
    res.json({ deleted: removed });
  } catch (error: any) {
    res.status(500).json({ error: '删除失败', message: error.message });
  }
});

export default router;
