import './setup.js';
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { startServer, stopServer } from './helpers.js';
import { env } from '../config/env.js';
import { imageToBase64DataUrl } from '../services/ai.js';

/**
 * 第 4 项：AI 请求前压缩图片。
 * 目标不是"压缩率有多高"，而是验证三件会影响生成质量与可用性的事：
 * ① 大图画小（省请求体、省生成时间）；② 小图不放大（不虚化）；③ 失败降级不阻断生成。
 */

let uploadSubDir: string;

before(async () => {
  await startServer();
  uploadSubDir = path.join(env.UPLOAD_DIR, 'u', '1');
  fs.mkdirSync(uploadSubDir, { recursive: true });
});
after(async () => {
  await stopServer();
});

/** 造一张带细节纹理的大图，模拟手机拍下的作业本（纯色图会被 JPEG 压成几 KB，不真实） */
async function makePhoto(width: number, height: number, file: string): Promise<{ path: string; bytes: number }> {
  const full = path.join(uploadSubDir, file);
  const buf = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const line = y % 48 === 0 ? 55 : 0;
      const n = (x * 7 + y * 13) % 41;
      buf[i] = Math.min(255, 246 - line - n);
      buf[i + 1] = Math.min(255, 244 - line - n);
      buf[i + 2] = Math.min(255, 240 - line - n);
    }
  }
  await sharp(buf, { raw: { width, height, channels: 3 } }).jpeg({ quality: 96 }).toFile(full);
  return { path: full, bytes: fs.statSync(full).size };
}

/** 造一张 PNG，验证非 JPEG 原图也能正确转成 image/jpeg */
async function makePng(file: string): Promise<string> {
  const full = path.join(uploadSubDir, file);
  const buf = Buffer.alloc(300 * 200 * 4);
  for (let i = 0; i < buf.length; i += 4) {
    buf[i] = 30;
    buf[i + 1] = 60;
    buf[i + 2] = 200;
    buf[i + 3] = 255;
  }
  await sharp(buf, { raw: { width: 300, height: 200, channels: 4 } }).png().toFile(full);
  return full;
}

describe('AI 图片压缩（第 4 项）', () => {
  test('大图被降采样到长边 1600px，体积大幅下降', async () => {
    const { path: full, bytes } = await makePhoto(4032, 3024, 'big.jpg');

    const url = await imageToBase64DataUrl(path.relative(env.UPLOAD_DIR, full).split(path.sep).join('/'));
    const dataUrl = url.slice('data:image/jpeg;base64,'.length);
    const decoded = Buffer.from(dataUrl, 'base64');

    // 原图远大于压缩结果
    assert.ok(decoded.length < bytes / 4, `压缩后 ${(decoded.length / 1024).toFixed(0)}KB 应远小于原图 ${(bytes / 1024).toFixed(0)}KB`);

    // 降采样后的分辨率：长边应为 1600，短边等比
    const meta = await sharp(Buffer.from(decoded)).metadata();
    assert.equal(meta.width, 1600, '长边应为 1600');
    assert.equal(meta.height, 1200, '短边应等比为 1200');
  });

  test('小图不放大（withoutEnlargement），避免把清晰小图虚化', async () => {
    const buf = Buffer.alloc(640 * 480 * 3);
    for (let i = 0; i < buf.length; i += 3) {
      buf[i] = 100;
      buf[i + 1] = 140;
      buf[i + 2] = 180;
    }
    const full = path.join(uploadSubDir, 'small.jpg');
    await sharp(buf, { raw: { width: 640, height: 480, channels: 3 } }).jpeg({ quality: 90 }).toFile(full);

    const url = await imageToBase64DataUrl('u/1/small.jpg');
    const meta = await sharp(Buffer.from(url.slice('data:image/jpeg;base64,'.length), 'base64')).metadata();
    assert.equal(meta.width, 640, '小图应保持原分辨率');
    assert.equal(meta.height, 480);
  });

  test('原图为 PNG 时输出仍是 image/jpeg 前缀（sharp 重编码后按实际格式走）', async () => {
    await makePng('icon.png');
    const url = await imageToBase64DataUrl('u/1/icon.png');
    assert.ok(url.startsWith('data:image/jpeg;base64,'), '应为 jpeg 前缀');
  });

  test('文件不存在时抛错（由调用方决定是否降级）', async () => {
    await assert.rejects(() => imageToBase64DataUrl('u/1/no-such.jpg'), /图片文件不存在/);
  });

  test('路径越出上传目录被拒绝', async () => {
    await assert.rejects(() => imageToBase64DataUrl('../../etc/passwd'), /非法的图片路径/);
    await assert.rejects(() => imageToBase64DataUrl('/etc/hosts'), /非法的图片路径/);
  });

  test('非图片文件（伪造扩展名）降级为原图直读，不阻断生成', async () => {
    // sharp 解不开 → 走 legacyBase64 兜底。这是刻意的容错：
    // 一张坏图不该让整个 AI 生成请求失败。
    const full = path.join(uploadSubDir, 'broken.jpg');
    fs.writeFileSync(full, 'this is not a real jpeg image at all');

    const url = await imageToBase64DataUrl('u/1/broken.jpg');
    assert.ok(url.startsWith('data:image/jpeg;base64,'));
    // 兜底路径按原文件内容编码，不丢字
    assert.equal(Buffer.from(url.slice('data:image/jpeg;base64,'.length), 'base64').toString('utf8'), 'this is not a real jpeg image at all');
  });
});
