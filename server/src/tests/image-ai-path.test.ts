import './setup.js';
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { startServer, stopServer, req, createUserSession, tinyPngBuffer } from './helpers.js';
import { env } from '../config/env.js';
import { db } from '../config/database.js';
import { imageToBase64DataUrl, resolveOwnedUploadRelPath } from '../services/ai/utils.js';
import { getOcrText } from '../services/ocr.js';

/**
 * 图片 → AI/OCR 数据通路回归（2026-11 修复批 1）。
 *
 * 修复前这条链路整体哑火：
 * ① imageToBase64DataUrl 把 _staging/ 前缀剥掉再找文件——而 AI 生成发生在保存之前，
 *    文件还在暂存区，剥前缀的路径不存在 → vision 输入永远为空（错误被 catch 吞掉）；
 * ② 上传路由的 OCR 对剥前缀后的不存在路径识别，结果恒为空；
 * ③ OCR 入库键是绝对路径、读取键是相对路径，键形态永不对称，文本进不了提示词。
 * 这些测试用真函数、真库把「上传返回的路径 → AI 可用 / OCR 可查」整条通路锁住。
 */

let token = '';
let userId = 0;

before(async () => {
  await startServer();
  const session = await createUserSession('img-path-teacher');
  token = session.token;
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf-8'));
  userId = payload.userId as number;
});
after(async () => {
  await stopServer();
});

function pngForm() {
  const fd = new FormData();
  fd.append('images', new Blob([tinyPngBuffer()], { type: 'image/png' }), 'photo.png');
  return fd;
}

describe('图片通路：上传路径 → AI vision 输入', () => {
  test('上传返回的暂存路径可直接被 imageToBase64DataUrl 读取（不剥 _staging 前缀）', async () => {
    const res = await req('POST', '/api/upload', { token, raw: pngForm() });
    assert.equal(res.status, 200, '上传失败: ' + JSON.stringify(res.body));
    const staged = res.body.paths[0] as string;

    // 修复前：剥掉 _staging/ 后路径不存在 → 抛「图片文件不存在」→ 被 AI 调用方吞掉，图片块静默丢失
    const url = await imageToBase64DataUrl(staged, userId);
    assert.ok(url.startsWith('data:image/jpeg;base64,'), '暂存图应能转成 Data URL');
  });

  test('归属校验：不能读别人目录下的图', async () => {
    const other = await createUserSession('img-path-other');
    const otherRes = await req('POST', '/api/upload', { token: other.token, raw: pngForm() });
    const otherPath = otherRes.body.paths[0] as string;

    await assert.rejects(async () => imageToBase64DataUrl(otherPath, userId), /无权访问该图片/);
    await assert.rejects(async () => resolveOwnedUploadRelPath(otherPath, userId), /无权访问该图片/);
  });

  test('归属校验：数字 ID 目录（历史路径形态）与自己的账户名目录都放行', async () => {
    // 数字 ID 形态是历史路径，账户名形态是当前上传返回的形态，两者都必须可用
    assert.equal(resolveOwnedUploadRelPath(String(userId) + '/x.jpg', userId), String(userId) + '/x.jpg');
  });

  test('路径穿越与绝对路径依旧被拒绝', async () => {
    await assert.rejects(async () => resolveOwnedUploadRelPath('../../etc/passwd', userId), /非法的图片路径|无权访问该图片/);
    await assert.rejects(async () => resolveOwnedUploadRelPath('/etc/hosts', userId), /非法的图片路径|无权访问该图片/);
  });
});

describe('图片通路：OCR 写读键形态一致', () => {
  test('上传触发 OCR 后，getOcrText 用上传返回的相对路径能查到记录（键同形态）', async () => {
    const res = await req('POST', '/api/upload', { token, raw: pngForm() });
    assert.equal(res.status, 200);
    const staged = res.body.paths[0] as string;

    // 上传路由异步 OCR：轮询等入库（NODE_ENV=test 识别短路为空串，但入库键形态必须对）
    let found = false;
    for (let i = 0; i < 40 && !found; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const rows = db
        .prepare('SELECT image_path FROM image_ocr WHERE user_id = ?')
        .all(userId) as Array<{ image_path: string }>;
      found = rows.some((r) => r.image_path === staged);
    }
    assert.ok(found, `image_ocr 里应有与上传返回路径同形态的键：${staged}`);

    // getOcrText 用 params.images（上传返回的相对路径）查询必须命中
    const map = getOcrText(userId, [staged]);
    assert.ok(Object.prototype.hasOwnProperty.call(map, staged), '读取键与写入键必须同形态');
  });

  test('历史脏数据（绝对路径键）不再产生：新写入的键一律是相对路径', () => {
    const rows = db
      .prepare("SELECT image_path FROM image_ocr WHERE user_id = ? AND image_path LIKE '/%'")
      .all(userId) as Array<{ image_path: string }>;
    assert.equal(rows.length, 0, '不应再有绝对路径形态的 OCR 键');
  });
});
