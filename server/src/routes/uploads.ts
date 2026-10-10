import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { env } from '../config/env.js';
import { AuthenticatedRequest } from '../types/index.js';
import {
  stagingDirFor,
  discardStagedImage,
  STAGING_DIR_NAME,
} from '../services/imageLifecycle.js';

const router = Router();

// 支持的类型（与 AI 多模态输入能力对齐）
const ALLOWED_EXT = ['.jpg', '.jpeg', '.png', '.webp'];
const ALLOWED_LABEL = 'JPG、PNG、WebP';

/**
 * 按文件头（magic bytes）判断真实图片类型。
 *
 * 为什么不信任客户端给的 mimetype：
 * macOS 微信拖拽出来的文件 mimetype 是空字符串，按 MIME 白名单会被全部拒绝；
 * 反过来，伪造 mimetype 也很容易。只有文件内容骗不了人。
 */
export function sniffImageType(filePath: string): { ext: string; mime: string } | null {
  let fd: number | undefined;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(16);
    fs.readSync(fd, buf, 0, 16, 0);

    // JPEG: FF D8 FF
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
      return { ext: '.jpg', mime: 'image/jpeg' };
    }
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (buf.subarray(0, 8).equals(PNG_SIG)) {
      return { ext: '.png', mime: 'image/png' };
    }
    // WebP: "RIFF" .... "WEBP"
    if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') {
      return { ext: '.webp', mime: 'image/webp' };
    }
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

// Multer 存储：先落到【暂存区】（按账户名分目录），保存回访时才提交到正式归档。
// 没保存的暂存图由 GC 定期清理 —— 避免放弃的草稿在磁盘上留下孤儿文件。
// 仍先写临时名，校验通过后再按真实类型改名。
const storage = multer.diskStorage({
  destination: (req: AuthenticatedRequest, file, cb) => {
    const uploadPath = stagingDirFor(req.userId || 0);
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req: AuthenticatedRequest, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    // 临时扩展名，稍后依据文件内容改成真实类型，避免用户文件名带来的注入风险
    cb(null, uniqueSuffix + '.upload');
  },
});

const upload = multer({
  storage,
  // 这里不再按 mimetype 拦截（微信等应用会给出空 mimetype），
  // 真正的把关放在写入后按文件内容判定。
  // 前端已会在上传前压缩（长边 2048），这里放宽只是兜底：
  // 压缩失败或关闭时仍能容纳大图。注意 Base64 后体积还会涨约 33%，
  // 过大的图会让 AI 请求被平台拒绝，所以不鼓励依赖这个上限。
  limits: { fileSize: 40 * 1024 * 1024 }, // 40MB
});

/**
 * 上传图片（支持多张）
 * 返回【暂存】相对路径 "_staging/<账户名>/<filename>"。
 * 前端用 "/uploads/<relativePath>" 访问，AI 生成也据此定位文件；
 * 保存回访时后端会把暂存图提交到正式归档目录（uploads/<账户名>/）。
 */
router.post('/upload', (req: AuthenticatedRequest, res) => {
  upload.array('images', 5)(req, res, (err) => {
    if (err) {
      const message =
        err.code === 'LIMIT_FILE_SIZE' ? '图片过大，单张不能超过 40MB' : err.message;
      return res.status(400).json({ error: message });
    }
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: '请选择要上传的图片' });
    }

    const userId = req.userId || 0;
    const files = req.files as Express.Multer.File[];
    const paths: string[] = [];
    let rejected = 0;

    for (const file of files) {
      const kind = sniffImageType(file.path);

      if (!kind) {
        // 不是有效图片：删除临时文件，不计入结果
        try {
          fs.unlinkSync(file.path);
        } catch {
          /* 删除失败不影响主流程 */
        }
        rejected++;
        continue;
      }

      const finalName = file.filename.replace(/\.upload$/, '') + kind.ext;
      const finalPath = path.join(path.dirname(file.path), finalName);

      // 相对路径带上暂存目录前缀（前端预览/AI 生成都据此定位）
      const relPrefix = STAGING_DIR_NAME + '/' + path.basename(path.dirname(file.path)) + '/';

      try {
        fs.renameSync(file.path, finalPath);
      } catch {
        // 改名失败（极少见）：保留临时文件并原样返回，不让用户白等
        paths.push(relPrefix + file.filename);
        continue;
      }

      file.filename = finalName;
      paths.push(relPrefix + finalName);
    }

    if (paths.length === 0) {
      return res.status(400).json({
        error: '仅支持 ' + ALLOWED_LABEL + ' 格式的图片，收到的文件不是有效图片',
      });
    }

    res.json({
      paths,
      count: paths.length,
      // 部分成功时告知前端，避免用户以为全都传上去了
      ...(rejected > 0 ? { rejected } : {}),
    });
  });
});

/**
 * 删除一张暂存图（回访表单里点 X 移除时调用）。
 * 只允许删【暂存区里属于该用户】的文件；
 * 正式归档（已保存回访的图片）一律不可通过此入口删除。
 */
router.delete('/upload', (req: AuthenticatedRequest, res) => {
  try {
    const ok = discardStagedImage(req.userId || 0, req.body?.path || '');
    if (!ok) {
      return res.status(400).json({ error: '只能删除自己未保存的暂存图片' });
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: '删除图片失败', message: error.message });
  }
});

/**
 * 兼容旧的图片读取接口（带路径穿越防护）
 * 注意：常规图片访问走 index.ts 里的 /uploads 静态服务，此接口仅作兜底。
 */
router.get('/images/:userId/:filename', (req, res) => {
  const { userId, filename } = req.params;
  const baseDir = path.resolve(env.UPLOAD_DIR);
  const target = path.resolve(baseDir, userId, filename);

  // 防止 ../ 路径穿越
  if (!target.startsWith(baseDir + path.sep)) {
    return res.status(400).json({ error: '非法路径' });
  }
  if (!fs.existsSync(target)) {
    return res.status(404).json({ error: '图片不存在' });
  }
  res.sendFile(target);
});

export { ALLOWED_EXT };
export default router;
