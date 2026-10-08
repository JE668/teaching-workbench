import './setup.js';
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, req, url, createUser, tinyPngBuffer } from './helpers.js';

let token = '';

before(async () => {
  await startServer();
  token = await createUser('upload-teacher');
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

    const res = await fetch(url('/uploads/' + p));
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
    const other = await createUser('upload-other');
    const mine = await req('POST', '/api/upload', { token, raw: pngForm() });
    const theirs = await req('POST', '/api/upload', { token: other, raw: pngForm() });

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
async function ownUploadDir(): Promise<string> {
  const up = await req('POST', '/api/upload', { token, raw: pngForm() });
  return (up.body.paths[0] as string).split('/')[0];
}
