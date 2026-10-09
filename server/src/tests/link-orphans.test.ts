import './setup.js';
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, req, createUser, createStudent } from './helpers.js';
import { linkOrphansByName, repairAllUsers } from '../services/linkOrphans.js';

let token = '';

before(async () => {
  await startServer();
  token = await createUser('orphan-teacher');
});
after(async () => {
  await stopServer();
});

/**
 * 直接造一条「未关联学生」的回访，模拟老版本留下的历史数据
 * （老版本手输姓名时不会自动建档，student_id 为 NULL）
 */
async function seedOrphan(userId: number, studentName: string, topic = '历史回访') {
  const { db } = await import('../config/database.js');
  db.prepare(
    `INSERT INTO followups
       (user_id, student_id, student_name, grade, subject, topic, performance, mastery, session_count, course_type, images, content, word_count)
     VALUES (?, NULL, ?, ?, ?, ?, ?, ?, 1, 'one_on_one', '[]', ?, ?)`
  ).run(userId, studentName, '小学五年级', '数学', topic, '专注', 'good', '【课堂内容】历史内容。', 20);

  return db
    .prepare('SELECT id FROM followups WHERE user_id = ? AND topic = ? ORDER BY id DESC LIMIT 1')
    .get(userId, topic) as any;
}

async function userIdOf(t: string): Promise<number> {
  return (await req('GET', '/api/auth/me', { token: t })).body.user.id;
}

describe('孤儿回访归位 · 建立档案时', () => {
  test('【用户场景】先有回访、后建档案 → 建档时自动归位', async () => {
    const t = await createUser('orphan-scenario');
    const uid = await userIdOf(t);

    // 老版本留下的两条未关联回访
    await seedOrphan(uid, '李一一', '第一次课');
    await seedOrphan(uid, '李一一', '第二次课');

    // 之后才在「学生管理」里建档案
    const created = await req('POST', '/api/students', {
      token: t,
      body: { name: '李一一', grade: '小学五年级', subject: '数学' },
    });

    assert.equal(created.status, 200);
    assert.equal(created.body.linkedFollowUps, 2, '建档时应归位 2 条历史回访');

    // 档案页应能看到这两条
    const profile = await req('GET', '/api/students/' + created.body.student.id + '/profile', { token: t });
    assert.equal(profile.body.followups.length, 2);
    const topics = profile.body.followups.map((f: any) => f.topic).sort();
    // 按 UTF-16 码位排序：一(U+4E00) < 二(U+4E8C)
    assert.deepEqual(topics, ['第一次课', '第二次课']);
  });

  test('没有同名历史回访时归位 0 条', async () => {
    const t = await createUser('orphan-none');
    const created = await req('POST', '/api/students', {
      token: t,
      body: { name: '全新学生', grade: '小学五年级', subject: '数学' },
    });

    assert.equal(created.body.linkedFollowUps, 0);
  });

  test('同名歧义时绝不猜（避免挂错档案）', async () => {
    const t = await createUser('orphan-ambiguous');
    const uid = await userIdOf(t);

    // 先存在两个同名学生（不同年级的同名孩子）
    await createStudent(t, { name: '张伟' });
    await createStudent(t, { name: '张伟', grade: '初三', subject: '物理' });

    // 之后才出现一条未关联的同名回访
    await seedOrphan(uid, '张伟', '歧义回访');

    // 触发归位：候选有 2 个 → 不猜
    const result = linkOrphansByName(uid);
    assert.equal(result.linked, 0, '同名两人时不应归位');
    assert.equal(result.skippedNames, 1, '应报告跳过了 1 个歧义姓名');

    // 那条回访仍保持未关联
    const { db } = await import('../config/database.js');
    const row = db
      .prepare('SELECT student_id FROM followups WHERE user_id = ? AND topic = ?')
      .get(uid, '歧义回访') as any;
    assert.equal(row.student_id, null, '歧义时不应擅自关联');
  });
});

describe('孤儿回访归位 · 改名与存量修复', () => {
  test('改名后按新名字归位（老师一开始名字打错了）', async () => {
    const t = await createUser('orphan-rename');
    const uid = await userIdOf(t);

    await seedOrphan(uid, '正确姓名', '改名回访');
    const s = await createStudent(t, { name: '写错的名字' });

    const updated = await req('PUT', '/api/students/' + s.id, {
      token: t,
      body: {
        name: '正确姓名',
        grade: '小学五年级',
        subject: '数学',
        phone: '',
        notes: '',
      },
    });

    assert.equal(updated.status, 200);
    assert.equal(updated.body.linkedFollowUps, 1, '改名后应归位 1 条');

    const profile = await req('GET', '/api/students/' + s.id + '/profile', { token: t });
    assert.equal(profile.body.followups.length, 1);
  });

  test('改名但新旧名字相同 → 不做多余扫描', async () => {
    const t = await createUser('orphan-same-name');
    const s = await createStudent(t, { name: '不变的名字' });

    const updated = await req('PUT', '/api/students/' + s.id, {
      token: t,
      body: { name: '不变的名字', grade: '小学五年级', subject: '数学', phone: '', notes: '' },
    });

    assert.equal(updated.body.linkedFollowUps, 0);
  });

  test('repairAllUsers 一次性修复所有用户的存量数据', async () => {
    const a = await createUser('repair-a');
    const b = await createUser('repair-b');
    const uidA = await userIdOf(a);
    const uidB = await userIdOf(b);

    await seedOrphan(uidA, '甲学生', 'A的历史');
    await seedOrphan(uidB, '乙学生', 'B的历史');

    await createStudent(a, { name: '甲学生' });
    await createStudent(b, { name: '乙学生' });

    // 再各造一条新的孤儿，然后跑全局修复
    await seedOrphan(uidA, '甲学生', 'A的新孤儿');
    await seedOrphan(uidB, '乙学生', 'B的新孤儿');

    const total = repairAllUsers();
    assert.ok(total >= 2, '应至少修复 2 条，实际 ' + total);

    const { db } = await import('../config/database.js');
    for (const [uid, topic] of [
      [uidA, 'A的新孤儿'],
      [uidB, 'B的新孤儿'],
    ] as [number, string][]) {
      const row = db.prepare('SELECT student_id FROM followups WHERE user_id = ? AND topic = ?').get(uid, topic) as any;
      assert.ok(row.student_id, '「' + topic + '」应已关联');
    }
  });

  test('修复是幂等的，重复执行不会再改数据', async () => {
    const t = await createUser('orphan-idempotent');
    const uid = await userIdOf(t);

    await seedOrphan(uid, '幂等学生', '幂等回访');
    await createStudent(t, { name: '幂等学生' });

    const again = linkOrphansByName(uid);
    assert.equal(again.linked, 0, '已归位的记录不应被重复处理');
  });

  test('学生被删除后，其回访回到未关联状态并可再次归位', async () => {
    const t = await createUser('orphan-recreate');
    const uid = await userIdOf(t);

    // 建档并挂上回访
    await seedOrphan(uid, '重建学生', '重建回访');
    const s = await createStudent(t, { name: '重建学生' });

    // 删掉学生（ON DELETE SET NULL）
    await req('DELETE', '/api/students/' + s.id, { token: t });

    const { db } = await import('../config/database.js');
    let row = db.prepare('SELECT student_id FROM followups WHERE user_id = ? AND topic = ?').get(uid, '重建回访') as any;
    assert.equal(row.student_id, null, '学生删除后回访应变为未关联');

    // 重新建档 → 应再次归位
    const recreated = await req('POST', '/api/students', {
      token: t,
      body: { name: '重建学生', grade: '小学五年级', subject: '数学' },
    });
    assert.equal(recreated.body.linkedFollowUps, 1);

    row = db.prepare('SELECT student_id FROM followups WHERE user_id = ? AND topic = ?').get(uid, '重建回访') as any;
    assert.equal(row.student_id, recreated.body.student.id);
  });
});

describe('孤儿回访归位 · 隔离', () => {
  test('不会把他人同名学生的回访挂过来', async () => {
    const a = await createUser('orphan-user-a');
    const b = await createUser('orphan-user-b');
    const uidB = await userIdOf(b);

    // B 有一条未关联回访
    await seedOrphan(uidB, '同名同学', 'B的回访');

    // A 建一个同名学生 → 不应影响 B 的记录
    const createdA = await req('POST', '/api/students', {
      token: a,
      body: { name: '同名同学', grade: '小学五年级', subject: '数学' },
    });

    assert.equal(createdA.body.linkedFollowUps, 0, 'A 的操作不应动到 B 的数据');

    const { db } = await import('../config/database.js');
    const row = db.prepare('SELECT student_id FROM followups WHERE user_id = ? AND topic = ?').get(uidB, 'B的回访') as any;
    assert.equal(row.student_id, null, 'B 的记录应保持原样');
  });
});
