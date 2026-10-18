import { Router } from 'express';
import fs from 'node:fs';
import crypto from 'node:crypto';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { db } from '../config/database.js';
import { AuthenticatedRequest } from '../types/index.js';
import { parseCatalogWorkbook, type Band } from '../utils/catalogParse.js';

/**
 * 全年课程体系目录。
 *
 * 老师自己维护两份 Excel（高中 / 小初），列布局 6 种、合并单元格、分区标题行都很多，
 * 手工搬运到工作台不现实。这里做一次批量导入落库，后面「课程总结」「课程规划」
 * 都从 course_catalog 取数。
 *
 * 导入是可重复的：同一个文件重复上传不会重复灌库，按
 * (user, band, grade, subject, track, term, seq, content) 判重。
 */
const router = Router();

const BANDS: Band[] = ['高中', '小初'];

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

function sha256(buffer: Uint8Array): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
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
      if (!/\.xlsx$/i.test(file.originalname)) {
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
          filename: file.originalname,
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
        .run(userId, band, file.originalname, digest, parsed.courses.length, JSON.stringify(parsed.failedSheets))
        .lastInsertRowid as number;

      const findExisting = db.prepare(`
        SELECT id FROM course_catalog
        WHERE user_id = ? AND band = ? AND grade = ? AND subject = ? AND track = ? AND term = ? AND seq = ? AND content = ?
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
          const exists = findExisting.get(userId, c.band, c.grade, c.subject, c.track, c.term, c.seq, c.content) as { id: number } | undefined;
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
        filename: file.originalname,
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

/** 课程目录查询。筛选都是可选的，不传就按用户全量返回。 */
router.get('/courses', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const where: string[] = ['user_id = ?'];
    const params: unknown[] = [userId];

    for (const key of ['grade', 'subject', 'term', 'type', 'track', 'textbook', 'sheet'] as const) {
      const v = clean(req.query[key]).trim();
      if (v) {
        where.push(`${key} = ?`);
        params.push(v);
      }
    }
    const q = clean(req.query.q).trim();
    if (q) {
      where.push('(content LIKE ? OR section LIKE ?)');
      params.push(`%${q}%`, `%${q}%`);
    }

    const limit = Math.min(Math.max(Number(req.query.limit) || 5000, 1), 20000);
    const sql = `SELECT * FROM course_catalog WHERE ${where.join(' AND ')} ORDER BY grade, subject, term, track, seq, id LIMIT ?`;
    params.push(limit);

    const rows = db.prepare(sql).all(...params) as any[];
    res.json({ courses: rows.map(mapCourse), total: rows.length });
  } catch (error: any) {
    res.status(500).json({ error: '查询课程目录失败', message: error.message });
  }
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

/** 筛选项取值：给前端的下拉框用 */
router.get('/facets', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const one = (col: string) =>
      (db.prepare(`SELECT DISTINCT ${col} AS v FROM course_catalog WHERE user_id = ? AND ${col} != '' ORDER BY v`).all(userId) as any[])
        .map((r) => r.v);
    res.json({
      grades: one('grade'),
      subjects: one('subject'),
      terms: one('term'),
      types: one('type'),
      tracks: one('track'),
      textbooks: one('textbook'),
      sheets: (db.prepare(`SELECT DISTINCT sheet AS v FROM course_catalog WHERE user_id = ? ORDER BY sheet`).all(userId) as any[]).map((r) => r.v),
    });
  } catch (error: any) {
    res.status(500).json({ error: '查询筛选项失败', message: error.message });
  }
});

/** 导入历史 */
router.get('/imports', (req: AuthenticatedRequest, res) => {
  try {
    const rows = db
      .prepare('SELECT * FROM catalog_imports WHERE user_id = ? ORDER BY id DESC')
      .all(req.userId!) as any[];
    res.json({
      imports: rows.map((r) => ({
        ...r,
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

/** 掌握星级等字段的手改 */
router.patch('/courses/:id', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
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
    params.push(id, userId);
    const r = db.prepare(`UPDATE course_catalog SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).run(...params);
    if (!r.changes) return res.status(404).json({ error: '课程不存在' });

    res.json({ course: mapCourse(db.prepare('SELECT * FROM course_catalog WHERE id = ?').get(id) as any) });
  } catch (error: any) {
    res.status(500).json({ error: '更新失败', message: error.message });
  }
});

/** 删除一次导入及其全部课程 */
router.delete('/imports/:id', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: '非法的导入 id' });

    const removed = db.transaction(() => {
      const n = db.prepare('DELETE FROM course_catalog WHERE import_id = ? AND user_id = ?').run(id, userId).changes;
      db.prepare('DELETE FROM catalog_imports WHERE id = ? AND user_id = ?').run(id, userId);
      return n;
    })();
    res.json({ deleted: removed });
  } catch (error: any) {
    res.status(500).json({ error: '删除失败', message: error.message });
  }
});

export default router;
