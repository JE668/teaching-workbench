import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { env } from '../config/env.js';
import { AuthenticatedRequest } from '../types/index.js';

const router = Router();

// Multer 存储：按用户分目录存放
const storage = multer.diskStorage({
  destination: (req: AuthenticatedRequest, file, cb) => {
    const userId = req.userId || 0;
    const uploadPath = path.join(env.UPLOAD_DIR, String(userId));
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req: AuthenticatedRequest, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    // 统一扩展名，避免用户文件名带来的注入风险
    const extMap: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
    };
    const ext = extMap[file.mimetype] || '.png';
    cb(null, uniqueSuffix + ext);
  },
});

const fileFilter = (req: AuthenticatedRequest, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('仅支持 JPG、PNG、WebP 格式的图片'));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

/**
 * 上传图片（支持多张）
 * 返回相对路径 "<userId>/<filename>"，与静态服务 /uploads 的目录结构一致，
 * 前端使用 "/uploads/<relativePath>" 即可访问，AI 服务也据此定位文件。
 */
router.post('/upload', (req: AuthenticatedRequest, res) => {
  upload.array('images', 5)(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: '请选择要上传的图片' });
    }
    const userId = req.userId || 0;
    const files = req.files as Express.Multer.File[];
    const paths = files.map((f) => userId + '/' + f.filename);
    res.json({ paths, count: files.length });
  });
});

/**
 * 兼容旧的图片读取接口（带路径穿越防护）
 * 注意：常规图片访问走 index.ts 里的 /uploads 静态服务，此接口仅作兜底。
 */
router.get('/images/:userId/:filename', (req, res) => {
  const { userId, filename } = req.params;
  const base = path.resolve(env.UPLOAD_DIR);
  const target = path.resolve(base, userId, filename);

  // 防止 ../ 路径穿越
  if (!target.startsWith(base + path.sep)) {
    return res.status(400).json({ error: '非法路径' });
  }
  if (!fs.existsSync(target)) {
    return res.status(404).json({ error: '图片不存在' });
  }
  res.sendFile(target);
});

export default router;
