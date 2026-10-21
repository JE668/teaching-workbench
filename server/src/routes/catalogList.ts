import { Router } from 'express';
import type { Response } from 'express';
import { db } from '../config/database.js';
import { AuthenticatedRequest } from '../types/index.js';
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

const router = Router();

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
    // 默认一把全给：目录页的筛选 / 排序 / 分组都在前端做（老师要看的是全貌），
    // 拆成真正的分页要连带前端整套重写，收益配不上风险。上限 20000 只是兜底。
    const limit = Math.min(Math.max(Number(req.query.limit) || 5000, 1), 20000);
    const sql = `SELECT * FROM course_catalog WHERE ${clause} ${COURSE_ORDER} LIMIT ?`;
    const countSql = `SELECT COUNT(*) AS n FROM course_catalog WHERE ${clause}`;

    const total = (db.prepare(countSql).get(...params) as { n: number }).n;
    const rows = db.prepare(sql).all(...params, limit) as any[];
    // total 是**未截断**的匹配条数，rows.length 才是实际返回的。
    // 以前直接写 rows.length，一旦超过 limit 就会把「少了几千条」报成「就这么点」。
    res.json({ courses: rows.map(mapCourse), total, rows: rows.length });
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

export default router;
