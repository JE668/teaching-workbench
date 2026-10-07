import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { env } from '../config/env.js';
import { AuthenticatedRequest } from '../types/index.js';

const router = Router();

// Multer 配置
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
    const ext = path.extname(file.originalname);
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
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
});

// 上传图片（支持多张）
router.post('/upload', (req: AuthenticatedRequest, res) => {
  upload.array('images', 5)(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: '请选择要上传的图片' });
    }
    const files = req.files as Express.Multer.File[];
    const paths = files.map((f) => f.filename);
    res.json({ paths, count: files.length });
  });
});

// 预览图片
router.get('/images/:userId/:filename', (req, res) => {
  const { userId, filename } = req.params;
  const filePath = path.join(env.UPLOAD_DIR, userId, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: '图片不存在' });
  }
  res.sendFile(filePath);
});

export default router;
