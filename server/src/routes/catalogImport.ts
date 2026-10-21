/**
 * 目录导入：批量上传解析 + 导入历史 + 删除。
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
import { Router } from 'express';
import crypto from 'node:crypto';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { db } from '../config/database.js';
import { AuthenticatedRequest } from '../types/index.js';
import { parseCatalogWorkbook, type Band } from '../utils/catalogParse.js';

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
