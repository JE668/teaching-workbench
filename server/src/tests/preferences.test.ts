import './setup.js';
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, req, createUser } from './helpers.js';

let token = '';

before(async () => {
  await startServer();
  token = await createUser('prefs-teacher');
});
after(async () => {
  await stopServer();
});

describe('用户偏好', () => {
  test('初始返回默认值', async () => {
    const fresh = await createUser('prefs-fresh');
    const res = await req('GET', '/api/auth/preferences', { token: fresh });

    assert.equal(res.status, 200);
    assert.equal(res.body.preferences.phraseMode, 'mixed');
    // 一周一次课的节奏：7 天刚到期就提醒
    assert.equal(res.body.preferences.pendingDays, 7);
  });

  test('可保存并读回', async () => {
    const res = await req('PUT', '/api/auth/preferences', {
      token,
      body: { phraseMode: 'history_only', pendingDays: 14 },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.preferences.phraseMode, 'history_only');
    assert.equal(res.body.preferences.pendingDays, 14);

    const read = await req('GET', '/api/auth/preferences', { token });
    assert.equal(read.body.preferences.phraseMode, 'history_only');
    assert.equal(read.body.preferences.pendingDays, 14);
  });

  test('部分更新不会重置另一个字段', async () => {
    await req('PUT', '/api/auth/preferences', {
      token,
      body: { phraseMode: 'history_only', pendingDays: 30 },
    });

    // 只改天数
    await req('PUT', '/api/auth/preferences', { token, body: { pendingDays: 3 } });

    const read = await req('GET', '/api/auth/preferences', { token });
    assert.equal(read.body.preferences.pendingDays, 3);
    assert.equal(read.body.preferences.phraseMode, 'history_only', '未被提及的字段应保持');
  });

  test('非法值被收敛到安全范围', async () => {
    const cases: [any, number][] = [
      [0, 7],
      [-5, 7],
      [9999, 365],
      ['abc', 7],
      [null, 7],
      ['14', 14],
    ];

    for (const [input, expected] of cases) {
      await req('PUT', '/api/auth/preferences', { token, body: { pendingDays: input } });
      const read = await req('GET', '/api/auth/preferences', { token });
      assert.equal(
        read.body.preferences.pendingDays,
        expected,
        '输入 ' + String(input) + ' 应归一为 ' + expected
      );
    }
  });

  test('非法 phraseMode 不会写入奇怪的值', async () => {
    await req('PUT', '/api/auth/preferences', { token, body: { phraseMode: 'history_only' } });
    const res = await req('PUT', '/api/auth/preferences', { token, body: { phraseMode: 'DROP TABLE' } });

    assert.equal(res.body.preferences.phraseMode, 'history_only', '非法值不应覆盖原值');
  });

  test('只接受已知字段，任意内容不会被写入', async () => {
    await req('PUT', '/api/auth/preferences', {
      token,
      body: { phraseMode: 'mixed', injected: 'hacked', __proto__: { polluted: true } },
    });

    const read = await req('GET', '/api/auth/preferences', { token });
    assert.deepEqual(Object.keys(read.body.preferences).sort(), ['pendingDays', 'phraseMode']);
    assert.equal(({} as any).polluted, undefined, '不应污染原型');
  });

  test('脏数据回落到默认值', async () => {
    const fresh = await createUser('prefs-dirty');
    const uid = (await req('GET', '/api/auth/me', { token: fresh })).body.user.id;

    const { db } = await import('../config/database.js');
    db.prepare("UPDATE users SET preferences = '这不是 json' WHERE id = ?").run(uid);

    const res = await req('GET', '/api/auth/preferences', { token: fresh });
    assert.equal(res.status, 200);
    assert.equal(res.body.preferences.phraseMode, 'mixed');
    assert.equal(res.body.preferences.pendingDays, 7);
  });

  test('多用户隔离', async () => {
    const a = await createUser('prefs-user-a');
    const b = await createUser('prefs-user-b');

    await req('PUT', '/api/auth/preferences', {
      token: a,
      body: { phraseMode: 'history_only', pendingDays: 30 },
    });

    const rb = await req('GET', '/api/auth/preferences', { token: b });
    assert.equal(rb.body.preferences.phraseMode, 'mixed', '不应看到他人偏好');
    assert.equal(rb.body.preferences.pendingDays, 7);
  });

  test('未登录返回 401', async () => {
    assert.equal((await req('GET', '/api/auth/preferences')).status, 401);
    assert.equal((await req('PUT', '/api/auth/preferences', { body: {} })).status, 401);
  });
});
