import { Router, type Response } from 'express';
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
  getMultiPeriodComparison,
  getAvailableStatMonths,
  getAvailableCenters,
  getCellDetail,
} from './analytics.js';
import { buildExport, type ExportOptions } from './exportService.js';
import { generateExportBuffer } from './excelExport.js';
import { refreshManager } from './refreshManager.js';
import { ManagerTargetError, saveManagerTargets } from './managerTargetService.js';

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
    log.error({ err: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined }, '续费学管矩阵读取失败');
    res.status(400).json({ error: '学管矩阵读取失败: ' + (err instanceof Error ? err.message : String(err)) });
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

/** 整体续费概览（支持指定 tab，默认 mentor） */
router.get('/analytics/rate-overview', asyncHandler(async (req: AuthenticatedRequest, res) => {
  const reportId = Number(req.query.reportId);
  if (!Number.isFinite(reportId)) return res.status(400).json({ error: 'reportId 必填' });
  if (!ownsReport(reportId, req.userId!)) return res.status(404).json({ error: '报表不存在' });
  const tab = String(req.query.tab || 'mentor');
  const overview = getRateOverview(reportId, tab);
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

type ManagerTargetHandler = (req: AuthenticatedRequest, res: Response) => void;

/** 已知输入错误可读；数据库等未知异常只记录日志并返回固定文案。 */
function handleManagerTargets(publicError: string, handler: ManagerTargetHandler) {
  return (req: AuthenticatedRequest, res: Response) => {
    try {
      handler(req, res);
    } catch (error) {
      if (error instanceof ManagerTargetError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }
      log.error({ err: error, path: req.path, method: req.method }, publicError);
      res.status(500).json({ error: publicError });
    }
  };
}

function managerTargetUserId(req: AuthenticatedRequest): number {
  const userId = req.userId;
  if (typeof userId !== 'number' || !Number.isSafeInteger(userId) || userId <= 0) {
    throw new ManagerTargetError('用户身份无效', 401);
  }
  return userId;
}

function managerPerfResponse(req: AuthenticatedRequest, res: Response): void {
  const userId = managerTargetUserId(req);
  const reportId = resolveReportId(req.query.reportId, userId);
  if (!reportId) {
    res.status(404).json({ error: '还没有上传任何续费统计表' });
    return;
  }
  res.json({ reportId, rows: getManagerPerf(reportId, userId) });
}

/** 学管业绩（含有效任务与四产品现金流） */
router.get('/analytics/manager-perf', handleManagerTargets('获取学管业绩失败', managerPerfResponse));

/** 读取目标任务时与学管业绩使用同一合并视图，避免两套 effective 口径。 */
router.get('/analytics/manager-targets', handleManagerTargets('获取学管任务失败', managerPerfResponse));

/** 批量按字段保存覆盖；null 清除覆盖，未传字段保持原值。 */
router.put('/analytics/manager-targets', handleManagerTargets('保存学管任务失败', (req, res) => {
  const userId = managerTargetUserId(req);
  const reportId = saveManagerTargets(req.body, userId);
  res.json({ reportId, rows: getManagerPerf(reportId, userId) });
}));

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


/** 矩阵单元格学生明细（分页、筛选、排序） */
router.get('/analytics/cell-detail', asyncHandler(async (req: AuthenticatedRequest, res) => {
  const reportId = Number(req.query.reportId);
  if (!Number.isFinite(reportId)) return res.status(400).json({ error: 'reportId 必填' });
  if (!ownsReport(reportId, req.userId!)) return res.status(404).json({ error: '报表不存在' });

  const type = String(req.query.type || '');
  if (!['mentor', 'grade', 'group'].includes(type)) {
    return res.status(400).json({ error: 'type 必须是 mentor、grade 或 group' });
  }

  const rowKey = String(req.query.rowKey || '');
  const colKey = String(req.query.colKey || '');
  if (!rowKey || !colKey) {
    return res.status(400).json({ error: 'rowKey 和 colKey 必填' });
  }

  const page = Number(req.query.page) || 1;
  const pageSize = Math.min(200, Number(req.query.pageSize) || 50);
  const sortBy = String(req.query.sortBy || 'name');
  const sortDir = String(req.query.sortDir || 'asc');
  const statusFilter = req.query.statusFilter ? String(req.query.statusFilter) : undefined;

  const result = getCellDetail({ reportId, type: type as any, rowKey, colKey, page, pageSize, sortBy: sortBy as any, sortDir: sortDir as any, statusFilter });
  res.json({ reportId, ...result });
}));

/** 学生网格状态分布 */
router.get('/analytics/student-status', (req: AuthenticatedRequest, res) => {
  const reportId = resolveReportId(req.query.reportId, req.userId!);
  if (!reportId) {
    res.status(404).json({ error: '还没有上传任何续费统计表' });
    return;
  }
  res.json({ reportId, rows: getStudentStatusSummary(reportId) });
});

/** 多期对比：趋势数据（支持按校区、月份筛选） */
router.get('/analytics/multi-period', asyncHandler(async (req: AuthenticatedRequest, res) => {
  const userId = req.userId!;
  const centerName = req.query.centerName ? String(req.query.centerName) : undefined;
  const limit = Number(req.query.limit) || 12;
  const months = req.query.months ? String(req.query.months).split(',').map(s => s.trim()).filter(Boolean) : undefined;

  try {
    const comparison = getMultiPeriodComparison({ userId, centerName, limit, months });
    res.json({ comparison });
  } catch (err) {
    log.error({ err }, '多期对比读取失败');
    res.status(400).json({ error: '多期对比读取失败，请稍后重试' });
  }
}));

/** 可用统计月份列表（供前端下拉选择） */
router.get('/analytics/stat-months', (req: AuthenticatedRequest, res) => {
  const months = getAvailableStatMonths(req.userId!);
  res.json({ months });
});

/** 可用校区列表（供前端下拉选择） */
router.get('/analytics/centers', (req: AuthenticatedRequest, res) => {
  const centers = getAvailableCenters(req.userId!);
  res.json({ centers });
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


/**
 * 导出续费看板数据
 * 支持多种模板：standard、detailed、matrix、funnel、risk、executive、multi-period
 */
router.get('/export', asyncHandler(async (req: AuthenticatedRequest, res) => {
  const userId = req.userId!;
  
  const template = String(req.query.template || 'standard');
  const reportId = Number(req.query.reportId);
  const centerName = req.query.centerName ? String(req.query.centerName) : undefined;
  const months = req.query.months ? String(req.query.months).split(',').map(s => s.trim()).filter(Boolean) : undefined;

  // For multi-period, reportId is not required
  if (template !== 'multi-period') {
    if (!Number.isFinite(reportId)) return res.status(400).json({ error: 'reportId 必填' });
    if (!ownsReport(reportId, userId)) return res.status(404).json({ error: '报表不存在' });
  }

  const options: ExportOptions = {
    reportId: template === 'multi-period' ? 0 : reportId,
    userId,
    template: template as any,
    centerName,
    months,
  };

  try {
    const buffer = await generateExportBuffer(options);
    const fileName = `renewal-${template}-${reportId || 'multi'}-${new Date().toISOString().slice(0, 10)}.xlsx`;
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (error) {
    log.error({ err: error, template, reportId }, '导出失败');
    res.status(500).json({ error: '导出生成失败，请稍后重试' });
  }
}));

/**
 * 获取可用的导出模板列表
 */

/**
 * 实时数据刷新 - SSE (Server-Sent Events) 端点
 * 前端通过 EventSource 连接获取实时更新
 */
router.get('/refresh/stream', (req: AuthenticatedRequest, res) => {
  const userId = req.userId!;
  const reportId = Number(req.query.reportId);

  if (!Number.isFinite(reportId)) {
    return res.status(400).json({ error: 'reportId 必填' });
  }

  if (!ownsReport(reportId, userId)) {
    return res.status(404).json({ error: '报表不存在' });
  }

  // 设置 SSE 头部
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  // 发送初始连接确认
  res.write('data: ' + JSON.stringify({ type: 'connected', reportId, timestamp: new Date().toISOString() }) + '\n\n');

  // 订阅刷新事件
  const unsubscribe = refreshManager.subscribe(reportId, (event) => {
    if (event.userId === userId || event.type === 'data_changed') {
      res.write('data: ' + JSON.stringify(event) + '\n\n');
    }
  });

  // 定期发送心跳保持连接
  const heartbeat = setInterval(() => {
    res.write('data: ' + JSON.stringify({ type: 'heartbeat', timestamp: new Date().toISOString() }) + '\n\n');
  }, 30000);

  // 客户端断开时清理
  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

/**
 * 手动触发数据刷新（供导入完成后调用）
 */
router.post('/refresh/trigger', asyncHandler(async (req: AuthenticatedRequest, res) => {
  const userId = req.userId!;
  const { reportId, type = 'data_changed' } = req.body as { reportId: number; type?: string };

  if (!Number.isFinite(reportId)) {
    return res.status(400).json({ error: 'reportId 必填' });
  }

  if (!ownsReport(reportId, userId)) {
    return res.status(404).json({ error: '报表不存在' });
  }

  refreshManager.triggerRefresh(reportId, userId, type as any);
  
  res.json({ success: true, message: '刷新已触发' });
}));

/**
 * 获取刷新状态
 */
router.get('/refresh/status', (req: AuthenticatedRequest, res) => {
  const userId = req.userId!;
  const reportId = Number(req.query.reportId);

  if (!Number.isFinite(reportId)) {
    return res.status(400).json({ error: 'reportId 必填' });
  }

  if (!ownsReport(reportId, userId)) {
    return res.status(404).json({ error: '报表不存在' });
  }

  res.json({
    reportId,
    subscriberCount: refreshManager.getSubscriberCount(reportId),
    isPolling: false,
  });
});

router.get('/export/templates', (req: AuthenticatedRequest, res) => {
  res.json({
    templates: [
      { id: 'standard', name: '标准导出', description: '概览 + 4个Tab教师统计 + 科组对比 + 学管业绩 + 漏斗' },
      { id: 'detailed', name: '详细导出', description: '标准导出 + 所有学生明细 + 矩阵数据' },
      { id: 'matrix', name: '矩阵导出', description: '教师×学管、教师×年级、科组×年级 三种矩阵完整导出' },
      { id: 'funnel', name: '漏斗导出', description: '整体漏斗 + 学生状态分布' },
      { id: 'risk', name: '风险导出', description: '风险学生清单（含课消、在读天数、系数等）' },
      { id: 'executive', name: '高管视图', description: '精简版：概览 + 学管业绩 + 多期对比趋势' },
      { id: 'multi-period', name: '多期对比', description: '跨月份/校区的趋势对比（不需要 reportId）' },
    ],
  });
});

export default router;
