import './setup.js';
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, req, createUser, createStudent, createFollowUp } from './helpers.js';

let token = '';

before(async () => {
  await startServer();
  token = await createUser('teacher');
});
after(async () => {
  await stopServer();
});

const DATETIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

describe('学生 CRUD', () => {
  test('创建学生返回完整字段', async () => {
    const s = await createStudent(token, { name: '张三' });
    assert.equal(s.name, '张三');
    assert.equal(s.grade, '小学五年级');
    assert.ok(s.createdAt, 'createdAt 应为 camelCase');
    assert.ok(s.updatedAt, 'updatedAt 应为 camelCase');
    assert.equal(s.created_at, undefined, '不应返回 snake_case 字段');
  });

  test('缺少必填项返回 400', async () => {
    const res = await req('POST', '/api/students', { token, body: { name: '只有名字' } });
    assert.equal(res.status, 400);
  });

  test('获取列表', async () => {
    const res = await req('GET', '/api/students', { token });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.students));
    assert.ok(res.body.students.length >= 1);
  });

  test('获取单个学生', async () => {
    const s = await createStudent(token, { name: '李四' });
    const res = await req('GET', '/api/students/' + s.id, { token });
    assert.equal(res.status, 200);
    assert.equal(res.body.student.name, '李四');
  });

  test('获取不存在的学生返回 404', async () => {
    const res = await req('GET', '/api/students/999999', { token });
    assert.equal(res.status, 404);
  });

  // ===== 回归测试：SQLite datetime 双引号导致 UPDATE 500 =====
  test('更新学生应成功（回归：datetime 引号 bug 曾导致 500）', async () => {
    const s = await createStudent(token, { name: '王五' });
    const res = await req('PUT', '/api/students/' + s.id, {
      token,
      body: { name: '王五', grade: '小学六年级', subject: '数学', phone: '13800138000', notes: '已升年级' },
    });
    assert.equal(res.status, 200, '更新必须成功，不能是 500');
    assert.equal(res.body.student.grade, '小学六年级');
    assert.equal(res.body.student.notes, '已升年级');
    assert.match(res.body.student.updatedAt, DATETIME_RE, 'updatedAt 应为合法时间戳');
  });

  test('部分更新不应清空未传字段', async () => {
    const s = await createStudent(token, { name: '赵六', phone: '13111111111' });
    const res = await req('PUT', '/api/students/' + s.id, { token, body: { notes: '只改备注' } });
    assert.equal(res.status, 200);
    assert.equal(res.body.student.name, '赵六', 'name 不应丢失');
    assert.equal(res.body.student.phone, '13111111111', 'phone 不应丢失');
    assert.equal(res.body.student.notes, '只改备注');
  });

  test('删除学生', async () => {
    const s = await createStudent(token, { name: '待删除' });
    const del = await req('DELETE', '/api/students/' + s.id, { token });
    assert.equal(del.status, 200);
    const after = await req('GET', '/api/students/' + s.id, { token });
    assert.equal(after.status, 404);
  });

  test('删除不存在的学生返回 404', async () => {
    const res = await req('DELETE', '/api/students/999999', { token });
    assert.equal(res.status, 404);
  });

  test('搜索学生', async () => {
    await createStudent(token, { name: '搜索目标A', subject: '英语' });
    const res = await req('GET', '/api/students/search?keyword=' + encodeURIComponent('搜索目标'), { token });
    assert.equal(res.status, 200);
    assert.ok(res.body.students.length >= 1);
    assert.ok(res.body.students.every((s: any) => s.name.includes('搜索目标') || s.subject.includes('搜索目标')));
  });

  test('搜索空关键字返回空数组', async () => {
    const res = await req('GET', '/api/students/search', { token });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.students, []);
  });
});

describe('学生档案', () => {
  test('档案返回学生 + 回访记录 + 统计', async () => {
    const s = await createStudent(token, { name: '档案测试' });
    await createFollowUp(token, { studentId: s.id, studentName: '档案测试', images: ['1/a.png', '1/b.png'] });
    await createFollowUp(token, { studentId: s.id, studentName: '档案测试', topic: '第二节课' });

    const res = await req('GET', '/api/students/' + s.id + '/profile', { token });
    assert.equal(res.status, 200);
    assert.equal(res.body.student.name, '档案测试');
    assert.equal(res.body.followups.length, 2);
    assert.equal(res.body.stats.totalFollowups, 2);
    assert.equal(res.body.stats.totalImages, 2, '图片数应被正确统计');
    assert.ok(res.body.stats.totalWords > 0);
    assert.ok(Array.isArray(res.body.followups[0].images), 'images 应为数组而非 JSON 字符串');
  });

  test('不存在的学生档案返回 404', async () => {
    const res = await req('GET', '/api/students/999999/profile', { token });
    assert.equal(res.status, 404);
  });
});

describe('数据隔离', () => {
  test('看不到他人的学生', async () => {
    const other = await createUser('other-teacher');
    const mine = await createStudent(token, { name: '我的学生' });

    const list = await req('GET', '/api/students', { token: other });
    assert.ok(!list.body.students.some((s: any) => s.id === mine.id), '不应看到他人学生');

    const single = await req('GET', '/api/students/' + mine.id, { token: other });
    assert.equal(single.status, 404);
  });

  test('无法修改或删除他人的学生', async () => {
    const other = await createUser('other-teacher-2');
    const mine = await createStudent(token, { name: '受保护的学生' });

    const put = await req('PUT', '/api/students/' + mine.id, { token: other, body: { name: '被篡改' } });
    assert.equal(put.status, 404);

    const del = await req('DELETE', '/api/students/' + mine.id, { token: other });
    assert.equal(del.status, 404);

    const check = await req('GET', '/api/students/' + mine.id, { token });
    assert.equal(check.body.student.name, '受保护的学生', '数据不应被他人改动');
  });

  test('无法查看他人的学生档案', async () => {
    const other = await createUser('other-teacher-3');
    const mine = await createStudent(token, { name: '私密学生' });
    const res = await req('GET', '/api/students/' + mine.id + '/profile', { token: other });
    assert.equal(res.status, 404);
  });
});
