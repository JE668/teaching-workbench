import { Router, Response } from 'express';
import { db } from '../config/database.js';
import { AuthenticatedRequest } from '../types/index.js';
import { mapFollowUp, mapFollowUps, parseImages,    normalizeSessionCount, normalizeCourseType, normalizeFollowUpModule,
    normalizeFollowUpModules, FOLLOWUP_TYPES, WEEKLY_FOLLOWUP_QUOTA
  } from '../utils/mappers.js';

/**
 * 只读查询路由：列表 / 统计 / 历史建议 / 单条。
 * 固定路径（/stats、/suggestions）必须先于参数化路径（/:id）注册，
 * 否则 'stats' 会被当成 id。
 */
const router = Router();

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/** 获取回访列表（支持按学生/学科/年级过滤 + 分页） */
router.get('/', (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { studentId, subject, grade, page, pageSize } = req.query as Record<string, string>;

    let where = 'WHERE user_id = ?';
    const params: any[] = [userId];

    if (studentId) {
      where += ' AND student_id = ?';
      params.push(parseInt(studentId, 10));
    }
    if (subject) {
      where += ' AND subject = ?';
      params.push(subject);
    }
    if (grade) {
      where += ' AND grade = ?';
      params.push(grade);
    }

    // 分页参数带边界保护，防止非法入参
    const p = Math.max(1, parseInt(page, 10) || 1);
    const ps = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(pageSize, 10) || DEFAULT_PAGE_SIZE));

    const total = (db.prepare('SELECT COUNT(*) AS n FROM followups ' + where).get(...params) as any).n;
    const totalPages = Math.max(1, Math.ceil(total / ps));
    const offset = (p - 1) * ps;

    // 注意：created_at 仅精确到秒，同秒记录顺序不稳定会导致分页重复/漏项，
    // 因此必须追加 id 作为稳定排序键。
    const rows = db
      .prepare('SELECT * FROM followups ' + where + ' ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?')
      .all(...params, ps, offset) as any[];

    res.json({
      followups: mapFollowUps(rows),
      pagination: { page: p, pageSize: ps, total, totalPages },
    });
  } catch (error: any) {
    res.status(500).json({ error: '获取回访列表失败', message: error.message });
  }
});

/** 汇总统计（供仪表盘使用） */
router.get('/stats', (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;

    // 仅取需要的列，避免把全文都拉出来
    const rows = db
      .prepare('SELECT images, subject, module, created_at FROM followups WHERE user_id = ?')
      .all(userId) as any[];

    const totalImages = rows.reduce((sum, r) => sum + parseImages(r.images).length, 0);

    const recent = db
      .prepare('SELECT * FROM followups WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 5')
      .all(userId) as any[];

    res.json({
      totalFollowUps: rows.length,
      totalImages,
      subjects: [...new Set(rows.map((r) => r.subject))].length,
      weekly: weeklyModuleProgress(rows),
      recent: mapFollowUps(recent),
    });
  } catch (error: any) {
    res.status(500).json({ error: '获取统计失败', message: error.message });
  }
});

/**
 * 本周流程打卡进度。
 *
 * 学校要求「每周完成不少于 5 项流程打卡」。一次回访的内容本身就要覆盖 5 个以上
 * 流程环节，所以「覆盖的种类数」不再适合当达标口径——只要回访过一次就必然 ≥5。
 * 看板改用**板块服务总次数**（totalModuleHits）：本周所有回访里板块被覆盖的总次数，
 * 反映这周的教学服务量；回访条数 records 与覆盖种类数 covered 仍然返回做副指标。
 * 每条回访覆盖几个板块就计几次。
 *
 * 周界：北京周一 00:00 到周日 24:00。数据库时间列存的是北京时间串
 * （datetime('now', '+8 hours')），直接拼「周一 00:00:00」做字符串比较即可。
 */
function weeklyModuleProgress(rows: any[]): {
  weekStart: string;
  weekEnd: string;
  quota: number;
  covered: number;
  records: number;
  totalModuleHits: number;
  types: { value: string; label: string; group: string; count: number }[];
} {
  const pad = (n: number) => String(n).padStart(2, '0');
  const today = new Date();
  // JS getDay(): 周日=0，故「到周一的天数」为 (d + 6) % 7
  const sinceMonday = (today.getDay() + 6) % 7;
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - sinceMonday);
  const nextMonday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7);
  const sunday = new Date(nextMonday.getFullYear(), nextMonday.getMonth(), nextMonday.getDate() - 1);
  const iso = (d: Date) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const startStr = iso(monday) + ' 00:00:00';
  const endStr = iso(nextMonday) + ' 00:00:00';

  const inWeek = rows.filter((r) => {
    const ts = String(r.created_at || '');
    return ts.length >= 10 && ts >= startStr && ts < endStr;
  });

  const counts = new Map<string, number>();
  for (const r of inWeek) {
    // 一条回访可以覆盖多个板块，每个板块都各计 1 次
    for (const key of normalizeFollowUpModules(r.module)) {
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }

  const types = FOLLOWUP_TYPES.map((t) => ({
    value: t.value,
    label: t.label,
    group: t.group,
    count: counts.get(t.value) || 0,
  }));

  return {
    weekStart: iso(monday),
    weekEnd: iso(sunday),
    quota: WEEKLY_FOLLOWUP_QUOTA,
    covered: types.filter((t) => t.count > 0).length,
    records: inWeek.length,
    // 本周板块被覆盖的总次数，看板主指标
    totalModuleHits: types.reduce((sum, t) => sum + t.count, 0),
    types,
  };
}

/** 历史联想：从该用户自己的历史记录里提取常用主题与高频表现短语 */
router.get('/suggestions', (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const studentId = req.query.studentId ? parseInt(req.query.studentId as string, 10) : null;

    // 指定学生时优先用该学生的历史，同时掺入全局（新学生也有词可用）
    const scoped = studentId
      ? (db
          .prepare(
            'SELECT topic, performance FROM followups WHERE user_id = ? AND student_id = ? ORDER BY created_at DESC LIMIT 100'
          )
          .all(userId, studentId) as any[])
      : [];

    const global = db
      .prepare('SELECT topic, performance FROM followups WHERE user_id = ? ORDER BY created_at DESC LIMIT 300')
      .all(userId) as any[];

    const topicCount = new Map<string, number>();
    for (const row of [...scoped, ...global]) {
      const t = String(row.topic || '').trim();
      if (t && t.length <= 40) topicCount.set(t, (topicCount.get(t) || 0) + 1);
    }

    // 短语：把课堂表现按标点拆成短句，统计高频片段
    const phraseCount = new Map<string, number>();
    for (const row of [...scoped, ...global]) {
      for (const piece of String(row.performance || '').split(/[，,、；;。\n]/)) {
        const p = piece.trim();
        // 太短没意义，太长不适合做快捷按钮
        if (p.length < 2 || p.length > 14) continue;
        phraseCount.set(p, (phraseCount.get(p) || 0) + 1);
      }
    }

    const rank = (m: Map<string, number>, limit: number) =>
      [...m.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, limit)
        .map(([text, count]) => ({ text, count }));

    res.json({
      topics: rank(topicCount, 12),
      phrases: rank(phraseCount, 12),
    });
  } catch (error: any) {
    res.status(500).json({ error: '获取历史建议失败', message: error.message });
  }
});

/**
 * 取某学生最近一条回访，供「上次内容一键带入」使用。
 * 只回传写表单真正需要的字段，避免把 content 全文拖出来。
 * 必须先于参数化路径 /:id 注册（'last' 会被当成 id）。
 */
router.get('/last', (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const studentId = parseInt(String(req.query.studentId), 10);
    if (!Number.isFinite(studentId) || studentId <= 0) {
      return res.status(400).json({ error: '缺少 studentId' });
    }

    const row = db
      .prepare(
        `SELECT id, topic, performance, mastery, session_count, course_type, module, subject, grade, word_count, created_at
         FROM followups WHERE user_id = ? AND student_id = ?
         ORDER BY created_at DESC, id DESC LIMIT 1`
      )
      .get(userId, studentId) as any;

    if (!row) {
      return res.json({ followup: null });
    }

    res.json({
      followup: {
        id: row.id,
        topic: row.topic,
        performance: row.performance,
        mastery: row.mastery,
        sessionCount: normalizeSessionCount(row.session_count),
        courseType: normalizeCourseType(row.course_type),
        module: normalizeFollowUpModule(row.module),
        subject: row.subject,
        grade: row.grade,
        wordCount: row.word_count,
        createdAt: row.created_at,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: '获取最近回访失败', message: error.message });
  }
});

/**
 * 取某条回访所属的小组课批次（整批 N 条成员）。
 * 1对1 或无批次返回 batch: null；前端据此显示「N 人小组课」徽标。
 */
router.get('/:id/batch', (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const followupId = parseInt(req.params.id, 10);
    const f = db
      .prepare('SELECT id, batch_id FROM followups WHERE id = ? AND user_id = ?')
      .get(followupId, userId) as any;

    if (!f) {
      return res.status(404).json({ error: '回访记录不存在' });
    }
    if (!f.batch_id) {
      return res.json({ batch: null });
    }

    const members = db
      .prepare('SELECT * FROM followups WHERE user_id = ? AND batch_id = ? ORDER BY student_id ASC')
      .all(userId, f.batch_id) as any[];

    res.json({
      batch: {
        id: f.batch_id,
        size: members.length,
        followups: mapFollowUps(members),
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: '获取批次信息失败', message: error.message });
  }
});

/** 获取单条回访 */
router.get('/:id', (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const followupId = parseInt(req.params.id, 10);
    const row = db.prepare('SELECT * FROM followups WHERE id = ? AND user_id = ?').get(followupId, userId) as any;
    if (!row) {
      return res.status(404).json({ error: '回访记录不存在' });
    }
    res.json({ followup: mapFollowUp(row) });
  } catch (error: any) {
    res.status(500).json({ error: '获取回访信息失败', message: error.message });
  }
});

export default router;
