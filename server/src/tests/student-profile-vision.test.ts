import './setup.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { env } from '../config/env.js';
import { buildProfileUserContent } from '../services/ai/studentProfile.js';
import { saveOcrResults } from '../services/ocr.js';
import { startServer, stopServer, createUser, userIdOf } from './helpers.js';

let userId = 0;
let otherUserId = 0;
let ownImage = '';
let otherImage = '';

before(async () => {
  await startServer();
  userId = userIdOf(await createUser('profile-vision-owner'));
  otherUserId = userIdOf(await createUser('profile-vision-other'));
  ownImage = `${userId}/profile-evidence.jpg`;
  otherImage = `${otherUserId}/private-evidence.jpg`;
  for (const relative of [ownImage, otherImage]) {
    const absolute = path.join(env.UPLOAD_DIR, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    await sharp({ create: { width: 4, height: 4, channels: 3, background: '#ffffff' } }).jpeg().toFile(absolute);
  }
});

after(async () => { await stopServer(); });

test('学生画像请求包含真实图片、OCR 和证据边界，并限制最多六张', async () => {
  await saveOcrResults(userId, [{ path: ownImage, text: '第 3 题通分时漏乘分子' }]);
  const content = await buildProfileUserContent(userId, '请生成画像', Array(8).fill(ownImage));
  const images = content.filter((block) => block.type === 'image_url');
  assert.equal(images.length, 6);
  assert.ok(images.every((block) => block.image_url.url.startsWith('data:image/jpeg;base64,')));
  const text = content.filter((block) => block.type === 'text').map((block) => block.text).join('\n');
  assert.match(text, /请生成画像/);
  assert.match(text, /第 3 题通分时漏乘分子/);
  assert.match(text, /不要把单次表现泛化为稳定结论/);
});

test('跨用户图片及其 OCR 不进入画像请求，失效图片不阻断文字生成', async () => {
  await saveOcrResults(otherUserId, [{ path: otherImage, text: '另一用户的私密 OCR' }]);
  const content = await buildProfileUserContent(userId, '仅使用本人文字证据', [otherImage, `${userId}/missing.jpg`]);
  assert.equal(content.filter((block) => block.type === 'image_url').length, 0);
  const text = content.filter((block) => block.type === 'text').map((block) => block.text).join('\n');
  assert.match(text, /仅使用本人文字证据/);
  assert.doesNotMatch(text, /另一用户的私密 OCR/);
});
