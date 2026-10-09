import './setup.js';
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, req, url, createUserSession, tinyPngBuffer } from './helpers.js';
import { env } from '../config/env.js';

let token = '';
let mediaCookie = '';

before(async () => {
  await startServer();
  const session = await createUserSession('upload-teacher');
  token = session.token;
  mediaCookie = session.cookie;
});
after(async () => {
  await stopServer();
});

function pngForm(name = 'homework.png', type = 'image/png') {
  const fd = new FormData();
  fd.append('images', new Blob([tinyPngBuffer()], { type }), name);
  return fd;
}

describe('图片上传', () => {
  test('上传 PNG 成功并返回相对路径', async () => {
    const res = await req('POST', '/api/upload', { token, raw: pngForm() });
    assert.equal(res.status, 200);
    assert.equal(res.body.count, 1);
    assert.equal(res.body.paths.length, 1);

    const p = res.body.paths[0] as string;
    // 关键回归点：路径必须含 userId 前缀，否则静态服务按 /uploads/<filename> 找不到文件
    assert.match(p, /^\d+\//, '返回路径应形如 "<userId>/<filename>"，实际: ' + p);
    assert.ok(!p.startsWith('/'), '不应返回绝对路径');
    assert.ok(!p.includes('..'), '不应包含路径穿越片段');
  });

  test('返回的路径可通过 /uploads 访问（回归：曾因路径不一致 404）', async () => {
    const up = await req('POST', '/api/upload', { token, raw: pngForm() });
    const p = up.body.paths[0] as string;

    // 图片接口需要图片访问 cookie（<img src> 带不了 Authorization 头）
    const res = await fetch(url('/uploads/' + p), { headers: { Cookie: mediaCookie } });
    assert.equal(res.status, 200, '上传后应能直接访问图片');
    assert.equal(res.headers.get('content-type'), 'image/png');

    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 0, '图片内容不应为空');
  });

  test('非图片类型被拒绝', async () => {
    const fd = new FormData();
    fd.append('images', new Blob(['not an image'], { type: 'text/plain' }), 'note.txt');
    const res = await req('POST', '/api/upload', { token, raw: fd });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /仅支持/);
  });

  test('未选择文件返回 400', async () => {
    const res = await req('POST', '/api/upload', { token, raw: new FormData() });
    assert.equal(res.status, 400);
  });

  test('未登录不能上传', async () => {
    const res = await req('POST', '/api/upload', { raw: pngForm() });
    assert.equal(res.status, 401);
  });

  test('不同用户的图片分目录隔离', async () => {
    const other = await createUserSession('upload-other');
    const mine = await req('POST', '/api/upload', { token, raw: pngForm() });
    const theirs = await req('POST', '/api/upload', { token: other.token, raw: pngForm() });

    const myPrefix = (mine.body.paths[0] as string).split('/')[0];
    const theirPrefix = (theirs.body.paths[0] as string).split('/')[0];
    assert.notEqual(myPrefix, theirPrefix, '不同用户应落在不同目录');
  });

  test('文件名被规范化（忽略客户端文件名，防注入）', async () => {
    const res = await req('POST', '/api/upload', {
      token,
      raw: pngForm('../../evil<script>.png'),
    });
    assert.equal(res.status, 200);
    const p = res.body.paths[0] as string;
    assert.ok(!p.includes('..'), '不得保留穿越片段');
    assert.ok(!p.includes('<') && !p.includes('>'), '不得保留危险字符');
    assert.match(p, /\.png$/, '应保留安全扩展名');
  });

  test('图片读取接口正常返回已上传图片', async () => {
    const up = await req('POST', '/api/upload', { token, raw: pngForm() });
    const [uid, filename] = (up.body.paths[0] as string).split('/');
    const res = await req('GET', '/api/images/' + uid + '/' + filename, { token });
    assert.equal(res.status, 200);
  });

  test('图片读取接口拒绝路径穿越', async () => {
    const dir = await ownUploadDir();
    for (const attempt of [
      '/api/images/..%2F..%2Fetc/passwd',
      '/api/images/' + dir + '/..%2F..%2F..%2Fetc%2Fpasswd',
    ]) {
      const res = await req('GET', attempt, { token });
      assert.ok([400, 404].includes(res.status), '路径穿越必须被拒绝: ' + attempt + ' -> ' + res.status);
      assert.ok(!String(JSON.stringify(res.body)).includes('root:'), '不得泄露系统文件');
    }
  });

  test('读取不存在的图片返回 404', async () => {
    const res = await req('GET', '/api/images/1/definitely-missing.png', { token });
    assert.equal(res.status, 404);
  });
});

/** 取当前用户的上传目录前缀，用于构造穿越尝试 */
describe('图片访问鉴权（多用户隔离）', () => {
  test('未携带凭证时拒绝访问（回归：曾用 express.static 完全裸奔）', async () => {
    const up = await req('POST', '/api/upload', { token, raw: pngForm() });
    const p = up.body.paths[0] as string;

    const res = await fetch(url('/uploads/' + p));
    assert.equal(res.status, 401, '没有凭证不应能拿到图片');
  });

  test('伪造签名被拒绝', async () => {
    const up = await req('POST', '/api/upload', { token, raw: pngForm() });
    const p = up.body.paths[0] as string;
    const owner = p.split('/')[0];

    const res = await fetch(url('/uploads/' + p), {
      headers: { Cookie: 'tw_media=' + owner + '.9999999999999.forged' },
    });
    assert.equal(res.status, 401);
  });

  test('过期令牌被拒绝', async () => {
    const up = await req('POST', '/api/upload', { token, raw: pngForm() });
    const p = up.body.paths[0] as string;
    const owner = p.split('/')[0];

    // 用真实签名但把过期时间改到过去
    const { createMediaToken, MEDIA_COOKIE } = await import('../middleware/mediaAuth.js');
    const real = createMediaToken(Number(owner));
    const [, , sig] = real.split('.');
    const expired = owner + '.' + (Date.now() - 1000) + '.' + sig;

    const res = await fetch(url('/uploads/' + p), {
      headers: { Cookie: MEDIA_COOKIE + '=' + expired },
    });
    assert.equal(res.status, 401, '过期令牌不应通过');
  });

  test('【核心】用户 B 不能访问用户 A 的图片', async () => {
    // A 上传一张图
    const aSession = await createUserSession('media-user-a');
    const aUp = await req('POST', '/api/upload', { token: aSession.token, raw: pngForm() });
    const aPath = aUp.body.paths[0] as string;

    // B 用自己的合法 cookie 去访问 A 的图片 → 必须 403
    const bSession = await createUserSession('media-user-b');
    const cross = await fetch(url('/uploads/' + aPath), {
      headers: { Cookie: bSession.cookie },
    });
    assert.equal(cross.status, 403, 'B 不应能读 A 的图片');

    // A 用自己的 cookie 访问自己的图片 → 200
    const own = await fetch(url('/uploads/' + aPath), {
      headers: { Cookie: aSession.cookie },
    });
    assert.equal(own.status, 200, 'A 应能读自己的图片');
  });

  test('登录返回的 cookie 可用于取图', async () => {
    const session = await createUserSession('media-login-user');
    const up = await req('POST', '/api/upload', { token: session.token, raw: pngForm() });
    const p = up.body.paths[0] as string;

    assert.ok(session.cookie.startsWith('tw_media='), '应下发图片访问 cookie');

    const res = await fetch(url('/uploads/' + p), { headers: { Cookie: session.cookie } });
    assert.equal(res.status, 200);
  });

  test('登出后 cookie 失效', async () => {
    const session = await createUserSession('media-logout-user');
    const up = await req('POST', '/api/upload', { token: session.token, raw: pngForm() });
    const p = up.body.paths[0] as string;

    const out = await req('POST', '/api/auth/logout', { token: session.token });
    assert.equal(out.status, 200);

    // 服务端通过 Set-Cookie 清空；即使旧 cookie 仍在本地，也应随有效期结束失效。
    // 这里断言的是接口确实下发了清除指令。
    const cleared = out.headers.getSetCookie?.().find((c) => c.startsWith('tw_media='));
    assert.ok(cleared, '登出应下发清除 cookie 的指令');
    assert.match(cleared!, /tw_media=;|Expires=Thu, 01 Jan 1970/);
  });

  test('跨用户目录的路径穿越被拒绝', async () => {
    const res = await fetch(url('/uploads/1/..%2F..%2F..%2Fetc%2Fpasswd'), {
      headers: { Cookie: mediaCookie },
    });
    // 归属校验(403) 或路径校验(400) 或路由未命中(404) 都算拒绝
    assert.ok([400, 403, 404].includes(res.status), '不应返回文件内容，实际: ' + res.status);
    const text = await res.text();
    assert.ok(!text.includes('root:'), '绝不能泄露文件内容');
  });

  test('自己目录内的路径穿越被拒绝', async () => {
    // 用自己的合法 cookie，但试图跳出自己的目录
    const myId = mediaCookie ? (await req('GET', '/api/auth/me', { token })).body.user.id : 0;

    const res = await fetch(url('/uploads/' + myId + '/..%2F..%2F..%2Fetc%2Fpasswd'), {
      headers: { Cookie: mediaCookie },
    });
    assert.ok([400, 403, 404].includes(res.status), '实际: ' + res.status);

    const text = await res.text();
    assert.ok(!text.includes('root:'), '绝不能泄露文件内容');
  });
});

describe('图片上传 · 按内容判定类型（回归：微信拖拽）', () => {
  function formOf(buffer: Buffer | Uint8Array, name: string, type: string) {
    const fd = new FormData();
    fd.append('images', new Blob([new Uint8Array(buffer)], { type }), name);
    return fd;
  }

  /** 带 JPEG 文件头的最小数据 */
  function jpegBuffer() {
    return Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
      Buffer.from('JFIF\0', 'ascii'),
      Buffer.from([0xff, 0xd9]),
    ]);
  }

  test('无 MIME 类型、无扩展名的图片也能上传（微信拖拽的典型形态）', async () => {
    const fd = formOf(tinyPngBuffer(), 'wechat-image', '');

    const res = await req('POST', '/api/upload', { token, raw: fd });

    assert.equal(res.status, 200, '不应因缺少 MIME 类型而拒绝：' + JSON.stringify(res.body));
    assert.equal(res.body.count, 1);
    // 扩展名应由文件内容推导出来
    assert.match(res.body.paths[0], /\.png$/);
  });

  test('客户端伪造的 MIME 不影响判定：PNG 声明成 image/jpeg 仍存为 .png', async () => {
    const fd = formOf(tinyPngBuffer(), 'fake.jpg', 'image/jpeg');

    const res = await req('POST', '/api/upload', { token, raw: fd });

    assert.equal(res.status, 200);
    assert.match(res.body.paths[0], /\.png$/, '应以实际内容（PNG）为准');
  });

  test('JPEG 内容被识别为 .jpg', async () => {
    const fd = formOf(jpegBuffer(), 'photo', '');

    const res = await req('POST', '/api/upload', { token, raw: fd });

    assert.equal(res.status, 200);
    assert.match(res.body.paths[0], /\.jpg$/);
  });

  test('伪装成图片的文本被拒绝（扩展名与 MIME 都造假也没用）', async () => {
    const fd = formOf(Buffer.from('这根本不是图片'), 'fake.png', 'image/png');

    const res = await req('POST', '/api/upload', { token, raw: fd });

    assert.equal(res.status, 400);
    assert.match(res.body.error, /不是有效图片/);
  });

  /** 当前用户上传目录的绝对路径 */
  async function ownUploadPathAbs(): Promise<string> {
    const fs = await import('fs');
    const path = await import('path');
    const abs = path.join(env.UPLOAD_DIR, await ownUploadDir());
    if (!fs.existsSync(abs)) fs.mkdirSync(abs, { recursive: true });
    return abs;
  }

  test('上传目录里不会留下被拒绝的临时文件', async () => {
    const fs = await import('fs');
    const dir = await ownUploadPathAbs();
    const beforeCount = fs.readdirSync(dir).length;

    await req('POST', '/api/upload', { token, raw: formOf(Buffer.from('not an image'), 'x.png', 'image/png') });

    const afterCount = fs.readdirSync(dir).length;
    assert.equal(afterCount, beforeCount, '被拒绝的文件应被清理，不应残留临时文件');
  });

  test('上传目录里不应残留 .upload 临时文件', async () => {
    const fs = await import('fs');
    const leftovers = fs.readdirSync(await ownUploadPathAbs()).filter((f) => f.endsWith('.upload'));
    assert.deepEqual(leftovers, [], '所有临时文件都应被改名或清理');
  });
});

async function ownUploadDir(): Promise<string> {
  const up = await req('POST', '/api/upload', { token, raw: pngForm() });
  return (up.body.paths[0] as string).split('/')[0];
}
