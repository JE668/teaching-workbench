import './setup.js';
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, req, createUser, createStudent } from './helpers.js';

let token = '';

before(async () => {
  await startServer();
  token = await createUser('group-teacher');
});
after(async () => {
  await stopServer();
});

async function makeStudents(n: number) {
  const list = [];
  for (let i = 0; i < n; i++) {
    list.push(await createStudent(token, { name: '组员' + i + '-' + Date.now() + '-' + i }));
  }
  return list;
}

describe('分组 · 增删改查', () => {
  test('初始没有分组', async () => {
    const fresh = await createUser('group-fresh');
    const res = await req('GET', '/api/groups', { token: fresh });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.groups, []);
  });

  test('创建后可列出，带成员数', async () => {
    const s = await makeStudents(3);

    const created = await req('POST', '/api/groups', {
      token,
      body: { name: '周六三年级班', studentIds: s.map((x) => x.id) },
    });
    assert.equal(created.status, 200);
    assert.equal(created.body.group.memberCount, 3);

    const list = await req('GET', '/api/groups', { token });
    const found = list.body.groups.find((g: any) => g.id === created.body.group.id);
    assert.ok(found);
    assert.equal(found.name, '周六三年级班');
    assert.equal(found.studentIds.length, 3);
  });

  test('可改名与替换成员', async () => {
    const s = await makeStudents(3);
    const created = await req('POST', '/api/groups', {
      token,
      body: { name: '临时班', studentIds: [s[0].id, s[1].id] },
    });

    const updated = await req('PUT', '/api/groups/' + created.body.group.id, {
      token,
      body: { name: '改后的班', studentIds: [s[2].id] },
    });

    assert.equal(updated.status, 200);
    assert.equal(updated.body.group.name, '改后的班');
    assert.deepEqual(updated.body.group.studentIds, [s[2].id]);
  });

  test('可删除', async () => {
    const s = await makeStudents(1);
    const created = await req('POST', '/api/groups', {
      token,
      body: { name: '待删除', studentIds: [s[0].id] },
    });

    const del = await req('DELETE', '/api/groups/' + created.body.group.id, { token });
    assert.equal(del.status, 200);

    const list = await req('GET', '/api/groups', { token });
    assert.ok(!list.body.groups.some((g: any) => g.id === created.body.group.id));
  });

  test('删除不存在的分组返回 404', async () => {
    const res = await req('DELETE', '/api/groups/999999', { token });
    assert.equal(res.status, 404);
  });
});

describe('分组 · 校验', () => {
  test('名称为空被拒绝', async () => {
    const s = await makeStudents(1);
    const res = await req('POST', '/api/groups', { token, body: { name: '  ', studentIds: [s[0].id] } });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /名称/);
  });

  test('成员为空被拒绝', async () => {
    const res = await req('POST', '/api/groups', { token, body: { name: '空分组', studentIds: [] } });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /至少选择/);
  });

  test('包含他人的学生时整批拒绝', async () => {
    const other = await createUser('group-other');
    const mine = await createStudent(token, { name: '我的组员' + Date.now() });
    const theirs = await createStudent(other, { name: '他的组员' + Date.now() });

    const res = await req('POST', '/api/groups', {
      token,
      body: { name: '越权分组', studentIds: [mine.id, theirs.id] },
    });

    assert.equal(res.status, 400);
    assert.match(res.body.error, /不存在或无权访问/);
  });

  test('同名分组被拒绝', async () => {
    const s = await makeStudents(1);
    const name = '重名测试' + Date.now();

    await req('POST', '/api/groups', { token, body: { name, studentIds: [s[0].id] } });
    const dup = await req('POST', '/api/groups', { token, body: { name, studentIds: [s[0].id] } });

    assert.equal(dup.status, 409);
    assert.match(dup.body.error, /同名/);
  });

  test('重复的学生 id 自动去重', async () => {
    const s = await makeStudents(1);
    const res = await req('POST', '/api/groups', {
      token,
      body: { name: '去重测试' + Date.now(), studentIds: [s[0].id, s[0].id, s[0].id] },
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.group.memberCount, 1);
  });

  test('名称过长被拒绝', async () => {
    const s = await makeStudents(1);
    const res = await req('POST', '/api/groups', {
      token,
      body: { name: 'x'.repeat(50), studentIds: [s[0].id] },
    });
    assert.equal(res.status, 400);
  });
});

describe('分组 · 成员被删除后的自愈', () => {
  test('学生被删除后，分组里不再返回该 id 并给出 staleCount', async () => {
    const s = await makeStudents(3);
    const created = await req('POST', '/api/groups', {
      token,
      body: { name: '自愈测试' + Date.now(), studentIds: s.map((x) => x.id) },
    });

    // 删掉其中一个学生
    await req('DELETE', '/api/students/' + s[0].id, { token });

    const list = await req('GET', '/api/groups', { token });
    const g = list.body.groups.find((x: any) => x.id === created.body.group.id);

    assert.equal(g.memberCount, 2, '只剩 2 个有效成员');
    assert.equal(g.staleCount, 1, '应告知有 1 个失效成员');
    assert.ok(!g.studentIds.includes(s[0].id), '不应返回已删除的学生');
  });

  test('点分组全选时拿到的都是有效学生', async () => {
    const s = await makeStudents(2);
    const created = await req('POST', '/api/groups', {
      token,
      body: { name: '有效性' + Date.now(), studentIds: s.map((x) => x.id) },
    });

    await req('DELETE', '/api/students/' + s[1].id, { token });

    const list = await req('GET', '/api/groups', { token });
    const g = list.body.groups.find((x: any) => x.id === created.body.group.id);

    // 前端直接 setSelectedIds(g.studentIds)，因此这里返回的必须都是真实存在的
    const all = await req('GET', '/api/students', { token });
    const validIds = new Set(all.body.students.map((x: any) => x.id));
    for (const id of g.studentIds) {
      assert.ok(validIds.has(id), '分组里的 id ' + id + ' 应仍存在');
    }

    // 并存的学生仍在分组里
    assert.deepEqual(g.studentIds, [s[0].id]);
    assert.equal(g.staleCount, 1);
  });
});

describe('分组 · 多用户隔离', () => {
  test('看不到他人的分组', async () => {
    const a = await createUser('group-user-a');
    const b = await createUser('group-user-b');
    const sa = await createStudent(a, { name: 'A组员' + Date.now() });

    await req('POST', '/api/groups', {
      token: a,
      body: { name: 'A的班' + Date.now(), studentIds: [sa.id] },
    });

    const res = await req('GET', '/api/groups', { token: b });
    assert.ok(!res.body.groups.some((g: any) => g.name.startsWith('A的班')));
  });

  test('不能修改或删除他人的分组', async () => {
    const a = await createUser('group-owner');
    const b = await createUser('group-intruder');
    const sa = await createStudent(a, { name: '归属组员' + Date.now() });

    const created = await req('POST', '/api/groups', {
      token: a,
      body: { name: '归属班' + Date.now(), studentIds: [sa.id] },
    });
    const gid = created.body.group.id;

    assert.equal((await req('PUT', '/api/groups/' + gid, { token: b, body: { name: '篡改' } })).status, 404);
    assert.equal((await req('DELETE', '/api/groups/' + gid, { token: b })).status, 404);

    // A 的分组仍完好
    const list = await req('GET', '/api/groups', { token: a });
    assert.ok(list.body.groups.some((g: any) => g.id === gid));
  });

  test('未登录返回 401', async () => {
    assert.equal((await req('GET', '/api/groups')).status, 401);
    assert.equal((await req('POST', '/api/groups', { body: { name: 'x', studentIds: [1] } })).status, 401);
  });
});
