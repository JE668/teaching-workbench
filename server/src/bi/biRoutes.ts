import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { env } from '../config/env.js';
import { AuthenticatedRequest } from '../types/index.js';
import { log } from '../utils/logger.js';
import { rateLimit } from '../middleware/rateLimit.js';
import {
  FILE_TYPES,
  type FileType,
} from './fileRegistry.js';
import {
  importBiFile,
  deleteBatch,
  listBatches,
  getBatchDetail,
} from './importService.js';
import { biDb } from './db.js';
import { computeXukeRates, computeXushengRates, computePreSale, availableMonths, computeIncentive } from './metrics.js';
import biConfigRoutes from './biConfigRoutes.js';

const router = Router();

// BI 上传是磁盘 I/O 密集操作：15 分钟窗口内最多 20 次
const biUploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: '报表上传过于频繁，请稍后再试',
});

// Multer：BI 报表临时存放目录
const BI_UPLOAD_DIR = path.join(env.DATA_DIR, 'bi_uploads');
if (!fs.existsSync(BI_UPLOAD_DIR)) {
  fs.mkdirSync(BI_UPLOAD_DIR, { recursive: true });
}

const biStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, BI_UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, `bi-${unique}${ext}`);
  },
});

const biUpload = multer({
  storage: biStorage,
  limits: { fileSize: 50 * 1024 * 1024 },  // 50MB 上限（预排课程文件较大）
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.xlsx', '.xls'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('仅支持 xlsx / xls 格式'));
    }
  },
});

// ===== 获取文件类型列表（前端下拉框用） =====
router.get('/file-types', (req: AuthenticatedRequest, res) => {
  const rows = biDb.prepare('SELECT * FROM file_registry ORDER BY display_name').all();
  res.json({ fileTypes: rows });
});

// ===== 上传并解析 xlsx =====
router.post(
  '/upload/:fileType',
  biUploadLimiter,
  biUpload.single('file'),
  async (req: AuthenticatedRequest, res) => {
    const { fileType } = req.params;
    const userId = req.userId!;

    // 验证文件类型是否已注册
    const registry = biDb.prepare('SELECT * FROM file_registry WHERE file_type = ?').get(fileType) as { enabled: number; display_name: string } | undefined;
    if (!registry) {
      return res.status(400).json({ error: `未知的文件类型: ${fileType}` });
    }
    if (!registry.enabled) {
      return res.status(400).json({ error: `文件类型 "${registry.display_name}" 暂未启用` });
    }

    if (!req.file) {
      return res.status(400).json({ error: '请选择要上传的文件' });
    }

    const note = typeof req.body.note === 'string' ? req.body.note : undefined;

    try {
      const result = await importBiFile({
        fileType: fileType as FileType,
        filePath: req.file.path,
        fileName: req.file.originalname,
        fileSize: req.file.size,
        uploadedBy: userId,
        note,
      });

      // 清理临时文件
      fs.unlink(req.file.path, () => {});

      if (result.status === 'failed') {
        return res.status(422).json({
          error: '解析失败',
          detail: result.errors,
          batchId: result.batchId,
        });
      }

      return res.json({
        message: `导入成功：${result.successRows} 行${result.errorRows > 0 ? `，${result.errorRows} 行跳过` : ''}`,
        batchId: result.batchId,
        successRows: result.successRows,
        errorRows: result.errorRows,
        errors: result.errors.slice(0, 20),  // 最多返回前 20 条错误
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ fileType, error: msg }, 'BI 上传处理失败');

      // 清理临时文件
      if (req.file) {
        fs.unlink(req.file.path, () => {});
      }

      return res.status(500).json({ error: '导入失败: ' + msg });
    }
  }
);

// ===== 批次列表 =====
router.get('/batches', (req: AuthenticatedRequest, res) => {
  const fileType = typeof req.query.file_type === 'string' ? req.query.file_type : undefined;
  const limit = parseInt(String(req.query.limit ?? '50'), 10);
  const offset = parseInt(String(req.query.offset ?? '0'), 10);

  const batches = listBatches({ fileType, limit, offset });
  res.json({ batches });
});

// ===== 批次详情 =====
router.get('/batches/:id', (req: AuthenticatedRequest, res) => {
  const batchId = parseInt(req.params.id, 10);
  if (isNaN(batchId)) {
    return res.status(400).json({ error: '无效的 batch ID' });
  }

  try {
    const { batch, errors } = getBatchDetail(batchId);
    res.json({ batch, errors });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(404).json({ error: msg });
  }
});

// ===== 删除批次 =====
router.delete('/batches/:id', (req: AuthenticatedRequest, res) => {
  const batchId = parseInt(req.params.id, 10);
  if (isNaN(batchId)) {
    return res.status(400).json({ error: '无效的 batch ID' });
  }

  try {
    deleteBatch(batchId);
    res.json({ message: `批次 ${batchId} 已删除` });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(404).json({ error: msg });
  }
});


// ===== 配置表 CRUD（挂子路由）=====
router.use('/', biConfigRoutes);

// ===== 指标计算 =====

// 续科率（老师维度）
router.get('/metrics/xuke-rates', (req: AuthenticatedRequest, res) => {
  const statMonth = typeof req.query.month === 'string' ? req.query.month : undefined;
  const groupBy = req.query.groupBy === 'subject_group' ? 'subject_group' : 'teacher';

  try {
    const rows = computeXukeRates({ statMonth, groupBy });
    res.json({ rows });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// 续生率（学管维度）
router.get('/metrics/xusheng-rates', (req: AuthenticatedRequest, res) => {
  const statMonth = typeof req.query.month === 'string' ? req.query.month : undefined;
  const crossDedup = req.query.crossDedup !== 'false';

  try {
    const rows = computeXushengRates({ statMonth, crossDedup });
    res.json({ rows });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// 预存推断（定金券聚合）
router.get('/metrics/presale', (req: AuthenticatedRequest, res) => {
  const batchId = req.query.batchId ? parseInt(String(req.query.batchId), 10) : undefined;

  try {
    const rows = computePreSale({ batchId });
    res.json({ rows });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// 激励差额（分公司/校区/学管维度）
router.get('/metrics/incentive', (req: AuthenticatedRequest, res) => {
  const statMonth = typeof req.query.month === 'string' ? req.query.month : undefined;

  try {
    const rows = computeIncentive({ statMonth });
    res.json({ rows });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// 可用月份（前端下拉框用）
router.get('/metrics/months/:fileType', (req: AuthenticatedRequest, res) => {
  const { fileType } = req.params;

  try {
    const months = availableMonths(fileType);
    res.json({ months });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

export default router;

