/**
 * 上传前压缩图片。
 *
 * 为什么必须在浏览器里压：
 *  1. 手机照片（尤其 5000 万像素）动辄 20-40MB，上传慢且容易撞反向代理/平台的体积限制
 *  2. 服务端会把图片转成 Base64 发给多模态模型，体积再涨约 33%
 *  3. **它毫无收益** —— 模型最终会把图缩到 1024~2048px 再理解，
 *     传 30MB 原图与传 500KB 缩图，模型看到的内容一样
 *
 * 因此策略：长边超过阈值就缩到阈值，并转成 JPEG 重编码。
 * 缩小画质损失极小，但换来的上传速度与成功率提升巨大。
 */

/** 长边上限。2048 足够模型看清作业上的字，也是多数多模态模型的输入上限附近 */
export const MAX_EDGE = 2048;
/** 小于这个体积且尺寸不超标，就完全不折腾 */
export const SMALL_BYTES = 1.5 * 1024 * 1024;
const JPEG_QUALITY = 0.85;
/** 解码兜底的超时上限：宁可跳过压缩，也不能让上传卡住 */
export const DECODE_TIMEOUT_MS = 10000;

export interface PrepareResult {
  file: File;
  /** 是否发生了压缩 */
  compressed: boolean;
  originalSize: number;
  finalSize: number;
  originalEdge?: number;
}

/** 尽量按 EXIF 方向解码（手机竖拍照片常带旋转信息） */
async function decode(file: File): Promise<ImageBitmap | HTMLImageElement | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      /* 继续尝试 img 兜底 */
    }
  }

  // 兜底：<img> 解码（老浏览器或某些格式）。
  // 必须加超时：极端情况下浏览器既不触发 load 也不触发 error，
  // 没有兜底就会让上传流程永远卡住。宁可放弃压缩，也不能卡住用户。
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    let settled = false;

    const finish = (value: ImageBitmap | HTMLImageElement | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(value);
    };

    const timer = setTimeout(() => finish(null), DECODE_TIMEOUT_MS);

    const img = new Image();
    img.onload = () => finish(img);
    img.onerror = () => finish(null);
    img.src = url;
  });
}

function edgeOf(src: ImageBitmap | HTMLImageElement): { width: number; height: number } {
  const width = 'width' in src ? src.width : (src as HTMLImageElement).naturalWidth;
  const height = 'height' in src ? src.height : (src as HTMLImageElement).naturalHeight;
  return { width, height };
}

function toJpegName(name: string): string {
  const base = (name || 'image').replace(/\.[^.]+$/, '') || 'image';
  return base + '.jpg';
}

/**
 * 需要时压缩，否则原样返回。
 * 任何一步失败都退回原文件 —— 压缩只是优化，不该成为上传的阻碍。
 */
export async function prepareImageForUpload(file: File): Promise<PrepareResult> {
  const passthrough: PrepareResult = {
    file,
    compressed: false,
    originalSize: file.size,
    finalSize: file.size,
  };

  // 明显不是图片的交给服务端判定（例如 HEIC 在 Chrome 下解不开）
  const src = await decode(file);
  if (!src) return passthrough;

  const { width, height } = edgeOf(src);
  const longEdge = Math.max(width, height);
  const needsResize = longEdge > MAX_EDGE;
  const needsShrink = file.size > SMALL_BYTES;

  // 尺寸与体积都达标 → 不动它（避免无谓的重编码损失）
  if (!needsResize && !needsShrink) return passthrough;

  const scale = needsResize ? MAX_EDGE / longEdge : 1;
  const targetW = Math.max(1, Math.round(width * scale));
  const targetH = Math.max(1, Math.round(height * scale));

  try {
    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;

    const ctx = canvas.getContext('2d');
    if (!ctx) return passthrough;

    // 转 JPEG 会丢掉透明通道，先铺白底，否则透明区域会变黑
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetW, targetH);
    ctx.drawImage(src as any, 0, 0, targetW, targetH);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY)
    );

    // 没压小就别换（例如原本就是小尺寸高质量 JPEG）
    if (!blob || blob.size >= file.size) return passthrough;

    return {
      file: new File([blob], toJpegName(file.name), { type: 'image/jpeg' }),
      compressed: true,
      originalSize: file.size,
      finalSize: blob.size,
      originalEdge: longEdge,
    };
  } catch {
    return passthrough;
  }
}

/** 人类可读的体积 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}
