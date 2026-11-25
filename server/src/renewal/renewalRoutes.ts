import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { AuthenticatedRequest } from '../types/index.js';
import { log } from '../utils/logger.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { renewalDb, RENEWAL_UPLOAD_DIR } from './db.js';
import {
  importRenewalFile,
  listReports,
  deleteReport,
  latestReportId,
  ownsReport,
} from './renewalService.js';
import {
  getTeacherStats,
  getGroupComparison,
  getManagerPerf,
  getFunnel,
  getRiskStudentsPage,
  getStudentStatusSummary,
  getMentorMatrix,
  getTeacherGradeMatrix,
  getGroupGradeMatrix,
  getRateOverview,
} from './analytics.js';

/**
 * 续费看板路由。
 *
 * 上传只收一份 xlsx（用户在 Excel 里已做好的续费统计表），解析入库后
 * 看板页按 tab / 指标取数出图。
 */
const router = Router();

// 上传是重 I/O：15 分钟窗口内最多 10 次
const renewalUploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: '报表上传过于频繁，请稍后再试',
});

const renewalStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, RENEWAL_UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    // multer 1.x 的 originalname 按 latin-1 解码，中文文件名会变 mojibake，统一转回 utf8
    const originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
    file.originalname = originalname;
    cb(null, `renewal-${unique}${path.extname(originalname)}`);
  },
});

const renewalUpload = multer({
  storage: renewalStorage,
  limits: { fileSize: 60 * 1024 * 1024 },   // 60MB（汇总表 16 sheet 约 1.5MB，留足余量）
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.xlsx', '.xls'].includes(ext)) cb(null, true);
    else cb(new Error('仅支持 xlsx / xls 格式'));
  },
});

/** 拼出 multer 落地文件的绝对路径：优先用 file.path，否则按目录 + 文件名拼。 */
function fileAbsolutePath(file: Express.Multer.File): string {
  return file.path || path.join(RENEWAL_UPLOAD_DIR, file.filename);
}

/** 上传并解析续费统计表 */
router.post('/upload', renewalUploadLimiter, (req: AuthenticatedRequest, res, next) => {
  renewalUpload.single('file')(req, res, async (err) => {
    const uploadedPath = req.file ? fileAbsolutePath(req.file) : null;
    const cleanup = () => { if (uploadedPath) { try { fs.rmSync(uploadedPath, { force: true }); } catch { /* 忽略清理失败 */ } } };

    try {
      // multer 自身的错误（扩展名不过滤、超过体积上限、磁盘写入失败）统一转 400。
      // 不能交给 errorHandler：那会变成一个 500，用户只能看到「服务器内部错误」。
      if (err) {
        const message = err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE'
          ? '文件超过 60MB 上限'
          : err.message === '仅支持 xlsx / xls 格式' ? err.message : '文件读取失败，请检查文件格式后重试';
        return res.status(400).json({ error: message });
      }
      if (!req.file) return res.status(400).json({ error: '未收到文件（表单字段名应为 file）' });

      const file = req.file;
      // 上传文件入库成功后即删：数据已在库里，磁盘不留副本
      const report = await importRenewalFile(file.path, file.originalname, file.size, req.userId!);
      cleanup();
      const deduplicated = report.deduplicated === true;
      const httpStatus = report.status === 'rejected'
        ? 422
        : report.status === 'failed' ? 400 : deduplicated ? 200 : 201;
      res.status(httpStatus).json({
        report,
        deduplicated,
        ...(report.status === 'rejected'
          ? { error: '导入数据存在阻断性质量问题，请查看错误明细' }
          : report.status === 'failed' ? { error: 'xlsx 解析失败' } : {}),
      });
    } catch (e) {
      cleanup();
      const msg = e instanceof Error ? e.message : String(e);
      log.error({ err: msg }, '续费统计表上传失败');
      res.status(400).json({ error: '解析失败，请确认文件为有效的 xlsx 工作簿后重试' });
    }
  });
});

/** 报表批次列表 */
router.get('/reports', (req: AuthenticatedRequest, res) => {
  res.json({ reports: listReports(req.userId!) });
});

/** 删除一批（整批回滚） */
router.delete('/reports/:id', (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: '无效的报表 id' });
    return;
  }
  const ok = deleteReport(id, req.userId!);
  if (!ok) {
    res.status(404).json({ error: '报表不存在' });
    return;
  }
  res.json({ deleted: id });
});

/** 解析错误明细 */
router.get('/reports/:id/errors', (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0 || !ownsReport(id, req.userId!)) {
    return res.status(404).json({ error: '报表不存在' });
  }
  const rows = renewalDb.prepare(`
    SELECT sheet_name, row_number, column_number, field_name,
           error_type, severity, error_message, details_json
    FROM renewal_import_error
    WHERE report_id = ?
    ORDER BY COALESCE(row_number, 0), COALESCE(column_number, 0), id
  `).all(id) as Array<{ severity: 'error' | 'warning'; error_type: string }>;
  const groupMap = new Map<string, { severity: string; errorType: string; count: number }>();
  let errorCount = 0;
  let warningCount = 0;
  for (const row of rows) {
    if (row.severity === 'error') errorCount += 1;
    if (row.severity === 'warning') warningCount += 1;
    const key = `${row.severity}\0${row.error_type}`;
    const group = groupMap.get(key);
    if (group) group.count += 1;
    else groupMap.set(key, { severity: row.severity, errorType: row.error_type, count: 1 });
  }
  const groups = [...groupMap.values()].sort((a, b) => {
    if (a.severity !== b.severity) {
      if (a.severity === 'error') return -1;
      if (b.severity === 'error') return 1;
    }
    return b.count - a.count
      || a.errorType.localeCompare(b.errorType)
      || a.severity.localeCompare(b.severity);
  });
  res.json({
    summary: { total: rows.length, errorCount, warningCount, groups },
    errors: rows,
  });
});


/**
 * 教师统计明细（含学生网格 + 颜色状态）。tab: incentive | stage | mentor | hours
 * 不传 reportId 时用最新一份。
 */
router.get('/dashboard/teacher-stats', (req: AuthenticatedRequest, res) => {
  const tab = String(req.query.tab || 'incentive');
  const reportId = resolveReportId(req.query.reportId, req.userId!);
  if (!reportId) {
    res.status(404).json({ error: '还没有上传任何续费统计表' });
    return;
  }
  try {
    const rows = getTeacherStats(reportId, tab);
    res.json({ tab, reportId, rows });
  } catch (err) {
    log.error({ err }, '续费教师统计读取失败');
    res.status(400).json({ error: '教师统计读取失败，请检查 tab 参数或稍后重试' });
  }
});

/** 学管矩阵（仅 mentor tab） */
router.get('/analytics/mentor-matrix', (req: AuthenticatedRequest, res) => {
  const reportId = resolveReportId(req.query.reportId, req.userId!);
  if (!reportId) {
    res.status(404).json({ error: '还没有上传任何续费统计表' });
    return;
  }
  try {
    const matrix = getMentorMatrix(reportId);
    res.json({ matrix }); // 返回 { matrix: ... } 以兼容前端
  } catch (err) {
    log.error({ err }, '续费学管矩阵读取失败');
    res.status(400).json({ error: '学管矩阵读取失败，请稍后重试' });
  }
});

/** 教师 × 年级 矩阵（仅 mentor tab） */
router.get('/analytics/teacher-grade-matrix', asyncHandler(async (req: AuthenticatedRequest, res) => {
  const reportId = Number(req.query.reportId);
  if (!Number.isFinite(reportId)) return res.status(400).json({ error: 'reportId 必填' });
  if (!ownsReport(reportId, req.userId!)) return res.status(404).json({ error: '报表不存在' });
  const matrix = getTeacherGradeMatrix(reportId);
  res.json({ matrix });
}));

/** 科组 × 年级 矩阵（仅 mentor tab） */
router.get('/analytics/group-grade-matrix', asyncHandler(async (req: AuthenticatedRequest, res) => {
  const reportId = Number(req.query.reportId);
  if (!Number.isFinite(reportId)) return res.status(400).json({ error: 'reportId 必填' });
  if (!ownsReport(reportId, req.userId!)) return res.status(404).json({ error: '报表不存在' });
  const matrix = getGroupGradeMatrix(reportId);
  res.json({ matrix });
}));

/** 整体续费概览（仅 mentor tab） */
router.get('/analytics/rate-overview', asyncHandler(async (req: AuthenticatedRequest, res) => {
  const reportId = Number(req.query.reportId);
  if (!Number.isFinite(reportId)) return res.status(400).json({ error: 'reportId 必填' });
  if (!ownsReport(reportId, req.userId!)) return res.status(404).json({ error: '报表不存在' });
  const overview = getRateOverview(reportId);
  res.json({ overview });
}));

/** 科组对比 */
router.get('/analytics/group-compare', (req: AuthenticatedRequest, res) => {
  const tab = String(req.query.tab || 'incentive');
  const reportId = resolveReportId(req.query.reportId, req.userId!);
  if (!reportId) {
    res.status(404).json({ error: '还没有上传任何续费统计表' });
    return;
  }
  try {
    const rows = getGroupComparison(reportId, tab);
    res.json({ tab, reportId, rows });
  } catch (err) {
    log.error({ err }, '续费科组对比读取失败');
    res.status(400).json({ error: '科组对比读取失败，请检查 tab 参数或稍后重试' });
  }
});

/** 学管业绩 */
router.get('/analytics/manager-perf', (req: AuthenticatedRequest, res) => {
  const reportId = resolveReportId(req.query.reportId, req.userId!);
  if (!reportId) {
    res.status(404).json({ error: '还没有上传任何续费统计表' });
    return;
  }
  res.json({ reportId, rows: getManagerPerf(reportId) });
});

/** 续生漏斗 */
router.get('/analytics/funnel', (req: AuthenticatedRequest, res) => {
  const reportId = resolveReportId(req.query.reportId, req.userId!);
  if (!reportId) {
    res.status(404).json({ error: '还没有上传任何续费统计表' });
    return;
  }
  res.json({ reportId, rows: getFunnel(reportId) });
});

/** 风险学生清单 */
router.get('/analytics/risk-list', (req: AuthenticatedRequest, res) => {
  const reportId = resolveReportId(req.query.reportId, req.userId!);
  if (!reportId) {
    res.status(404).json({ error: '还没有上传任何续费统计表' });
    return;
  }
  const rawPage = Number(req.query.page);
  const rawPageSize = Number(req.query.pageSize || req.query.limit);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;
  const pageSize = Number.isFinite(rawPageSize) && rawPageSize > 0
    ? Math.min(200, Math.floor(rawPageSize))
    : 50;
  res.json({ reportId, ...getRiskStudentsPage(reportId, page, pageSize) });
});

/** 学生网格状态分布 */
router.get('/analytics/student-status', (req: AuthenticatedRequest, res) => {
  const reportId = resolveReportId(req.query.reportId, req.userId!);
  if (!reportId) {
    res.status(404).json({ error: '还没有上传任何续费统计表' });
    return;
  }
  res.json({ reportId, rows: getStudentStatusSummary(reportId) });
});

/** 解析报表 id：显式传则用它，否则取最新一份 */
function resolveReportId(raw: unknown, userId: number): number | null {
  let reportId: number | null = null;
  if (typeof raw === 'string' && raw.trim()) {
    const n = Number(raw);
    reportId = Number.isInteger(n) && n > 0 ? n : null;
  } else {
    reportId = latestReportId(userId);
  }
  return reportId && ownsReport(reportId, userId) ? reportId : null;
}

export default router;
