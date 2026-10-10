import './setup.js';
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { startServer, stopServer, req, url, createUserSession, tinyPngBuffer } from './helpers.js';
import { env } from '../config/env.js';
import {
  gcStagedImages,
  migrateLegacyFolders,
  cleanupOrphanImages,
  ownerFolderFor,
  stagingDirFor,
  STAGING_DIR_NAME,
} from '../services/imageLifecycle.js';

let token = '';
let mediaCookie = '';

before(async () => {
  await startServer();
  const session = await createUserSession('lifecycle-teacher');
  token = session.token;
  mediaCookie = session.cookie;
});
after(async () => {
  await stopServer();
});

function pngForm(name = 'photo.png', type = 'image/png') {
  const fd = new FormData();
  fd.append('images', new Blob([tinyPngBuffer()], { type }), name);
  return fd;
}

async function upload(): Promise<string> {
  const res = await req('POST', '/api/upload', { token, raw: pngForm() });
  assert.equal(res.status, 200, '上传失败: ' + JSON.stringify(res.body));
  return res.body.paths[0] as string;
}

async function saveFollowUp(images: string[]): Promise<any> {
  const res = await req('POST', '/api/followups', {
    token,
    body: {
      studentId: null,
      studentName: '生命周期学生',
      grade: '小学五年级',
      subject: '数学',
      topic: '生命周期课程-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      performance: '专注',
      mastery: 'good',
      sessionCount: 1,
      images,
      content: '【课堂内容】测试内容。',
    },
  });
  assert.equal(res.status, 200, '保存失败: ' + JSON.stringify(res.body));
  return res.body.followup;
}

describe('图片生命周期 · 暂存与提交', () => {
  test('上传先落暂存区，目录按账户名命名', async () => {
    const p = await upload();

    // 路径形如 _staging/<账户名>/<文件>
    const parts = p.split('/');
    assert.equal(parts[0], STAGING_DIR_NAME);
    assert.equal(parts[1], ownerFolderFor((await req('GET', '/api/auth/me', { token })).body.user.id));
    assert.ok(parts[2].endsWith('.png'));

    // 文件真实存在于暂存目录
    const abs = path.join(env.UPLOAD_DIR, p);
    assert.ok(fs.existsSync(abs), '暂存文件应存在: ' + abs);
  });

  test('【核心】保存回访时提交：暂存图挪到正式归档，路径同步改写', async () => {
    const staged = await upload();

    const followup = await saveFollowUp([staged]);
    const committed = followup.images[0] as string;

    // 记录里存的是正式路径
    assert.ok(!committed.startsWith(STAGING_DIR_NAME + '/'), '提交后不应再是暂存路径: ' + committed);
    const [folder, file] = committed.split('/');
    assert.equal(folder, ownerFolderFor(followup.userId), '正式归档应按账户名分目录');

    // 暂存文件已挪走，正式文件已存在
    assert.ok(!fs.existsSync(path.join(env.UPLOAD_DIR, staged)), '暂存文件应已被移走');
    assert.ok(fs.existsSync(path.join(env.UPLOAD_DIR, committed)), '正式文件应存在');

    // 提交后的图片可通过正式路由访问
    const res = await fetch(url('/uploads/' + committed), { headers: { Cookie: mediaCookie } });
    assert.equal(res.status, 200, '正式归档图片应可访问');
  });

  test('已是正式路径的引用原样保留（二次编辑不重复移动）', async () => {
    const staged = await upload();
    const followup = await saveFollowUp([staged]);
    const committed = followup.images[0] as string;

    // 用已提交的路径再次保存（模拟编辑）
    const again = await saveFollowUp([committed]);
    assert.equal(again.images[0], committed, '正式路径应原样保留');
    assert.ok(fs.existsSync(path.join(env.UPLOAD_DIR, committed)), '文件不应被动过');
  });

  test('暂存图缺失时不阻塞保存（如已被清理）', async () => {
    const staged = await upload();
    // 手动删掉暂存文件，模拟被 GC
    fs.unlinkSync(path.join(env.UPLOAD_DIR, staged));

    const followup = await saveFollowUp([staged]);
    assert.equal(followup.images.length, 0, '缺失的图应被跳过而不是报错');
  });
});

describe('图片生命周期 · 删除暂存图（表单点 X）', () => {
  test('可删除自己的暂存图', async () => {
    const staged = await upload();
    assert.ok(fs.existsSync(path.join(env.UPLOAD_DIR, staged)));

    const res = await req('DELETE', '/api/upload', { token, body: { path: staged } });
    assert.equal(res.status, 200);
    assert.ok(!fs.existsSync(path.join(env.UPLOAD_DIR, staged)), '暂存文件应被删除');
  });

  test('不能删别人的暂存图', async () => {
    const other = await createUserSession('lifecycle-other');
    const up = await req('POST', '/api/upload', { token: other.token, raw: pngForm() });
    const theirs = up.body.paths[0] as string;

    const res = await req('DELETE', '/api/upload', { token, body: { path: theirs } });
    assert.equal(res.status, 400, '不应能删他人的暂存图');
    assert.ok(fs.existsSync(path.join(env.UPLOAD_DIR, theirs)), '文件不应被删');
  });

  test('不能通过该接口删正式归档（已保存回访的图）', async () => {
    const staged = await upload();
    const followup = await saveFollowUp([staged]);
    const committed = followup.images[0] as string;

    const res = await req('DELETE', '/api/upload', { token, body: { path: committed } });
    assert.equal(res.status, 400, '正式归档不可通过此入口删除');
    assert.ok(fs.existsSync(path.join(env.UPLOAD_DIR, committed)), '正式文件应保留');
  });

  test('路径穿越被拒绝', async () => {
    const res = await req('DELETE', '/api/upload', {
      token,
      body: { path: STAGING_DIR_NAME + '/../' + ownerFolderFor(1) + '/x.png' },
    });
    assert.equal(res.status, 400);
  });
});

describe('图片生命周期 · 过期清理', () => {
  test('GC 清理过期的暂存图（未保存的）', async () => {
    const staged = await upload();

    // 把暂存文件的修改时间改到 8 天前（超过 7 天保留期）
    const abs = path.join(env.UPLOAD_DIR, staged);
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    fs.utimesSync(abs, old, old);

    const removed = gcStagedImages();
    assert.ok(removed >= 1, '应至少清掉 1 个过期暂存图');
    assert.ok(!fs.existsSync(abs), '过期暂存图应被删除');
  });

  test('保留期内的暂存图不会被误删', async () => {
    const staged = await upload();
    gcStagedImages();
    assert.ok(fs.existsSync(path.join(env.UPLOAD_DIR, staged)), '刚上传的暂存图不应被清理');
  });

  test('孤儿清理：无引用的过期正式文件被回收，有引用的保留', async () => {
    // 1) 有引用：正常保存一张
    const staged = await upload();
    const followup = await saveFollowUp([staged]);
    const committed = followup.images[0] as string;

    // 2) 无引用：直接往正式目录塞一个"孤儿"文件
    const orphanRel = ownerFolderFor(followup.userId) + '/orphan-' + Date.now() + '.png';
    const orphanAbs = path.join(env.UPLOAD_DIR, orphanRel);
    fs.mkdirSync(path.dirname(orphanAbs), { recursive: true });
    fs.writeFileSync(orphanAbs, tinyPngBuffer());
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    fs.utimesSync(orphanAbs, old, old);

    const removed = cleanupOrphanImages();
    assert.ok(removed >= 1, '应至少回收 1 个孤儿文件');
    assert.ok(!fs.existsSync(orphanAbs), '孤儿文件应被删除');
    assert.ok(fs.existsSync(path.join(env.UPLOAD_DIR, committed)), '有引用的文件应保留');
  });
});

describe('图片生命周期 · 历史目录迁移（数字ID -> 账户名）', () => {
  test('迁移旧目录并改写回访与草稿里的引用', async () => {
    const me = (await req('GET', '/api/auth/me', { token })).body.user;
    const folder = ownerFolderFor(me.id);

    // 造旧结构：uploads/<uid>/legacy.png + 一条引用它的回访 + 一份引用它的草稿
    const legacyDir = path.join(env.UPLOAD_DIR, String(me.id));
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, 'legacy.png'), tinyPngBuffer());

    const saved = await req('POST', '/api/followups', {
      token,
      body: {
        studentId: null,
        studentName: '迁移学生',
        grade: '小学五年级',
        subject: '数学',
        topic: '迁移引用-' + Date.now(),
        performance: '专注',
        mastery: 'good',
        sessionCount: 1,
        images: [me.id + '/legacy.png'], // 旧式引用：提交时原样保留（非 _staging 前缀）
        content: '【课堂内容】迁移。',
      },
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.followup.images[0], me.id + '/legacy.png');

    await req('PUT', '/api/draft', {
      token,
      body: { clientId: 'migrate-test', payload: { images: [me.id + '/legacy.png'], form: {}, selectedIds: [], content: '', draft: '' } },
    });

    // 执行迁移
    const result = migrateLegacyFolders();
    assert.ok(result.movedFiles >= 1, '应至少移动 1 个文件');

    // 旧目录应已清空移除，新目录应有该文件
    assert.ok(!fs.existsSync(path.join(legacyDir, 'legacy.png')), '旧位置的文件应已移走');
    assert.ok(fs.existsSync(path.join(env.UPLOAD_DIR, folder, 'legacy.png')), '新位置应有该文件');

    // 回访里的引用已改写
    const row = (await import('../config/database.js')).db
      .prepare('SELECT images FROM followups WHERE id = ?')
      .get(saved.body.followup.id) as any;
    const imgs = JSON.parse(row.images);
    assert.equal(imgs[0], folder + '/legacy.png', '回访引用应改写为账户名路径');

    // 草稿里的引用也已改写
    const draft = (await import('../config/database.js')).db
      .prepare('SELECT payload FROM drafts WHERE user_id = ?')
      .get(me.id) as any;
    const payload = JSON.parse(draft.payload);
    assert.ok(
      payload.images.includes(folder + '/legacy.png'),
      '草稿引用应改写为账户名路径'
    );
  });

  test('迁移是幂等的：再跑一次不重复移动', async () => {
    const again = migrateLegacyFolders();
    // 旧目录已不存在，不应再报告移动
    assert.equal(again.movedFiles, 0);
  });
});

describe('图片生命周期 · 账户名安全', () => {
  test('unsafe 账户名回落数字 ID 目录', async () => {
    const { safeFolderName } = await import('../services/imageLifecycle.js');
    assert.equal(safeFolderName('../evil'), '', '穿越形态应被拒绝');
    assert.equal(safeFolderName('a/b'), '', '含斜杠应被拒绝');
    assert.equal(safeFolderName('.'), '', '点应被拒绝');
    assert.equal(safeFolderName(STAGING_DIR_NAME), '', '保留名应被拒绝');
    assert.equal(safeFolderName('正常名字'), '正常名字', '常规名字应通过');
    assert.equal(safeFolderName('je'), 'je', '字母名应通过');
  });

  test('注册时拦截不可作用户名的账户', async () => {
    const res = await req('POST', '/api/auth/register', {
      body: { username: '../evil', password: 'pass123456' },
    });
    assert.equal(res.status, 400, '危险用户名应被拒绝');
    assert.match(res.body.error, /用户名/);
  });
});
