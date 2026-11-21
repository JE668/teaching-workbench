import './setup.js';
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { db } from '../config/database.js';
import {
  cloneLessonPlan,
  createFallbackLessonPlan,
  getLessonPlanById,
  saveGeneratedLessonPlan,
  type LessonPlanDocument,
} from '../services/ai/lessonPlanner.js';
import { createStudent, createUser, req, startServer, stopServer, userIdOf } from './helpers.js';

let ownerToken = '';
let peerToken = '';
let differentGroupToken = '';
let noGroupToken = '';
let ownerId = 0;
let peerId = 0;
let ownerStudentId = 0;
let peerStudentId = 0;
let ownerCourseId = 0;
let sourceId = 0;
let sourceDocument: LessonPlanDocument;
let sourceSnapshot: Record<string, unknown>;

function addGroup(name: string, subjectGroup: string, creatorId: number, memberIds: number[] = []) {
  const groupId = Number(db.prepare(
    'INSERT INTO knowledge_groups (name, subject_group, created_by) VALUES (?, ?, ?)',
  ).run(name, subjectGroup, creatorId).lastInsertRowid);
  const addMember = db.prepare(
    "INSERT INTO knowledge_group_members (group_id, user_id, role) VALUES (?, ?, ?)",
  );
  addMember.run(groupId, creatorId, 'owner');
  for (const memberId of memberIds) addMember.run(groupId, memberId, 'member');
  return groupId;
}

function addCourse(userId: number, content: string): number {
  return Number(db.prepare(`INSERT INTO course_catalog
    (user_id, band, term, grade, subject, track, seq, content, type, textbook, section, sheet)
    VALUES (?, '初中', '2026春季', '初二', '数学', '同步', 1, ?, '新授课', '人教版', '函数', '函数')`)
    .run(userId, content).lastInsertRowid);
}

function addLessonPlanFixture(userId: number, title: string, status: 'draft' | 'confirmed'): number {
  const input = { month: '2026-05', weekCount: 1, durationMinutes: 45, requirements: title };
  const plan = createFallbackLessonPlan({}, input);
  const saved = saveGeneratedLessonPlan(userId, input, {
    plan,
    modelMetadata: {
      provider: 'test', model: 'group-list-fixture', promptVersion: 'test', usedFallback: false, latencyMs: 0,
    },
  });
  db.prepare(`UPDATE lesson_plans SET title = ?, status = ?,
    confirmed_at = CASE WHEN ? = 'confirmed' THEN '2026-05-03 08:00:00' ELSE NULL END WHERE id = ?`)
    .run(title, status, status, saved.id);
  return saved.id;
}

function lessonPlanCount(): number {
  return (db.prepare('SELECT COUNT(*) AS count FROM lesson_plans').get() as { count: number }).count;
}

describe('lesson plan group clone', () => {
  before(async () => {
    await startServer();
    ownerToken = await createUser('lesson-clone-owner');
    peerToken = await createUser('lesson-clone-peer');
    differentGroupToken = await createUser('lesson-clone-different-group');
    noGroupToken = await createUser('lesson-clone-no-group');
    ownerId = userIdOf(ownerToken);
    peerId = userIdOf(peerToken);
    const differentGroupId = userIdOf(differentGroupToken);

    ownerStudentId = (await createStudent(ownerToken, { name: '源教师学生' })).id;
    peerStudentId = (await createStudent(peerToken, { name: '同组教师学生' })).id;
    ownerCourseId = addCourse(ownerId, '一次函数（源教师教材）');
    addCourse(peerId, '一次函数（同组教师教材）');

    // 两组使用完全相同的 subject_group：授权仍只能来自显式共同成员关系。
    addGroup('共同数学教研组', '数学', ownerId, [peerId]);
    addGroup('另一数学教研组', '数学', differentGroupId);

    const input = {
      studentId: ownerStudentId,
      courseId: ownerCourseId,
      month: '2026-05',
      weekCount: 1,
      durationMinutes: 45,
      requirements: '保留这份源教案要求',
    };
    sourceDocument = createFallbackLessonPlan({}, input);
    const saved = saveGeneratedLessonPlan(ownerId, input, {
      plan: sourceDocument,
      modelMetadata: {
        provider: 'test', model: 'clone-fixture', promptVersion: 'test', usedFallback: false, latencyMs: 0,
      },
    });
    sourceId = saved.id;
    db.prepare(`UPDATE lesson_plans
      SET title = '函数备课原稿', status = 'confirmed', confirmed_at = '2026-05-02 08:00:00'
      WHERE id = ?`).run(sourceId);
    sourceSnapshot = db.prepare('SELECT * FROM lesson_plans WHERE id = ?').get(sourceId) as Record<string, unknown>;
  });

  after(async () => {
    await stopServer();
  });

  test('本人克隆：默认不绑定学生，保留本人教材并生成 draft', async () => {
    const response = await req('POST', `/api/lesson-plans/${sourceId}/clone`, {
      token: ownerToken, body: {},
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.deepEqual(Object.keys(response.body), ['plan']);
    const cloned = response.body.plan;
    assert.notEqual(cloned.id, sourceId);
    assert.equal(cloned.userId, ownerId);
    assert.equal(cloned.studentId, null, '缺省 studentId 不应复用源教案学生');
    assert.equal(cloned.courseId, ownerCourseId);
    assert.equal(cloned.status, 'draft');
    assert.equal(cloned.confirmedAt, null);
    assert.match(cloned.title, /克隆/);
    assert.deepEqual(cloned.plan, sourceDocument);

    // 返回值与持久化 JSON 不共享引用；源教案也不会受后续内存修改影响。
    cloned.plan.weekly_lesson_plans[0].title = '只修改响应对象';
    assert.equal(getLessonPlanById(ownerId, cloned.id)!.plan.weekly_lesson_plans[0].title,
      sourceDocument.weekly_lesson_plans[0].title);
  });

  test('同组成员可克隆到自己名下，可绑定本人学生，跨账号教材置空', async () => {
    const targeted = await req('POST', `/api/lesson-plans/${sourceId}/clone`, {
      token: peerToken, body: { studentId: peerStudentId },
    });
    assert.equal(targeted.status, 201, JSON.stringify(targeted.body));
    assert.equal(targeted.body.plan.userId, peerId);
    assert.equal(targeted.body.plan.studentId, peerStudentId);
    assert.equal(targeted.body.plan.studentName, '同组教师学生');
    assert.equal(targeted.body.plan.courseId, null, '源教材属于 owner，同组身份不能保留跨账号 courseId');
    assert.equal(targeted.body.plan.courseTitle, null);
    assert.equal(targeted.body.plan.status, 'draft');
    assert.equal(targeted.body.plan.confirmedAt, null);
    assert.deepEqual(targeted.body.plan.plan, sourceDocument);

    const unbound = await req('POST', `/api/lesson-plans/${sourceId}/clone`, {
      token: peerToken, body: { studentId: null },
    });
    assert.equal(unbound.status, 201, JSON.stringify(unbound.body));
    assert.equal(unbound.body.plan.userId, peerId);
    assert.equal(unbound.body.plan.studentId, null, '同组克隆缺省/显式 null 都不能引用源 owner 的学生');
    assert.equal(unbound.body.plan.courseId, null);
  });

  test('同组成员不能通过猜测 ID 克隆他人未发布草稿', async () => {
    const draftId = addLessonPlanFixture(ownerId, '尚未共享的私密草稿', 'draft');
    const beforeCount = lessonPlanCount();
    const response = await req('POST', `/api/lesson-plans/${draftId}/clone`, {
      token: peerToken, body: { studentId: peerStudentId },
    });
    assert.equal(response.status, 404, JSON.stringify(response.body));
    assert.equal(lessonPlanCount(), beforeCount);
    const ownerClone = await req('POST', `/api/lesson-plans/${draftId}/clone`, {
      token: ownerToken, body: {},
    });
    assert.equal(ownerClone.status, 201, '本人仍可克隆自己的草稿');
  });

  test('不同组和无组用户即使同学科也统一 404，且不产生记录', async () => {
    const beforeCount = lessonPlanCount();
    const different = await req('POST', `/api/lesson-plans/${sourceId}/clone`, {
      token: differentGroupToken, body: {},
    });
    const noGroup = await req('POST', `/api/lesson-plans/${sourceId}/clone`, {
      token: noGroupToken, body: {},
    });
    const missing = await req('POST', '/api/lesson-plans/99999999/clone', {
      token: ownerToken, body: {},
    });
    assert.equal(different.status, 404);
    assert.equal(noGroup.status, 404);
    assert.equal(missing.status, 404);
    assert.deepEqual(different.body, missing.body);
    assert.deepEqual(noGroup.body, missing.body);
    assert.equal(lessonPlanCount(), beforeCount);
  });

  test('目标学生跨账号统一 404，无论本人还是同组克隆均不落库', async () => {
    const beforeCount = lessonPlanCount();
    const ownerUsingPeerStudent = await req('POST', `/api/lesson-plans/${sourceId}/clone`, {
      token: ownerToken, body: { studentId: peerStudentId },
    });
    const peerUsingOwnerStudent = await req('POST', `/api/lesson-plans/${sourceId}/clone`, {
      token: peerToken, body: { studentId: ownerStudentId },
    });
    assert.equal(ownerUsingPeerStudent.status, 404);
    assert.equal(peerUsingOwnerStudent.status, 404);
    assert.deepEqual(ownerUsingPeerStudent.body, peerUsingOwnerStudent.body);
    assert.equal(lessonPlanCount(), beforeCount);
  });

  test('请求体 strict，拒绝额外字段及非正整数 studentId', async () => {
    const beforeCount = lessonPlanCount();
    for (const body of [
      { studentId: 0 }, { studentId: -1 }, { studentId: 1.5 }, { studentId: '1' },
      { studentId: ownerStudentId, courseId: ownerCourseId }, { unexpected: true },
    ]) {
      const response = await req('POST', `/api/lesson-plans/${sourceId}/clone`, { token: ownerToken, body });
      assert.equal(response.status, 400, JSON.stringify({ body, response: response.body }));
    }
    assert.equal(lessonPlanCount(), beforeCount);
  });

  test('scope=group 只共享同组 confirmed，本人教案不受状态限制', async () => {
    const ownerDraftId = addLessonPlanFixture(ownerId, '同组他人草稿不可见', 'draft');
    const peerConfirmedId = addLessonPlanFixture(peerId, '本人 confirmed 可见', 'confirmed');
    const peerDraftId = addLessonPlanFixture(peerId, '本人 draft 仍可见', 'draft');
    const differentGroupConfirmedId = addLessonPlanFixture(
      userIdOf(differentGroupToken), '组外 confirmed 不可见', 'confirmed');
    const noGroupId = userIdOf(noGroupToken);
    const noGroupConfirmedId = addLessonPlanFixture(noGroupId, '未入组本人 confirmed', 'confirmed');
    const noGroupDraftId = addLessonPlanFixture(noGroupId, '未入组本人 draft', 'draft');

    const peerResponse = await req('GET', '/api/lesson-plans?scope=group&limit=100', { token: peerToken });
    assert.equal(peerResponse.status, 200, JSON.stringify(peerResponse.body));
    assert.deepEqual(Object.keys(peerResponse.body), ['plans', 'total']);
    assert.equal(peerResponse.body.total, peerResponse.body.plans.length);
    const peerVisibleIds = new Set(peerResponse.body.plans.map((plan: { id: number }) => plan.id));
    assert.ok(peerVisibleIds.has(sourceId), '同组 owner 的 confirmed 教案应可见');
    assert.ok(peerVisibleIds.has(peerConfirmedId));
    assert.ok(peerVisibleIds.has(peerDraftId), '本人 draft 不应被 group scope 过滤');
    assert.ok(!peerVisibleIds.has(ownerDraftId), '同组其他成员的 draft 不应共享');
    assert.ok(!peerVisibleIds.has(differentGroupConfirmedId), '同学科但不同组也不能发现');
    assert.ok(!peerVisibleIds.has(noGroupConfirmedId));
    assert.ok(peerResponse.body.plans.every((plan: { userId: number; status: string; isMine: boolean }) =>
      plan.userId === peerId || plan.status === 'confirmed'));
    assert.ok(peerResponse.body.plans.every((plan: { userId: number; isMine: boolean }) =>
      plan.isMine === (plan.userId === peerId)), '前端只能编辑本人教案，他人教案须先克隆');

    const differentGroupResponse = await req('GET', '/api/lesson-plans?scope=group&limit=100', {
      token: differentGroupToken,
    });
    assert.equal(differentGroupResponse.status, 200);
    const differentGroupIds = differentGroupResponse.body.plans.map((plan: { id: number }) => plan.id);
    assert.deepEqual(differentGroupIds, [differentGroupConfirmedId]);
    assert.equal(differentGroupResponse.body.total, 1);

    const noGroupResponse = await req('GET', '/api/lesson-plans?scope=group&limit=100', { token: noGroupToken });
    assert.equal(noGroupResponse.status, 200);
    assert.deepEqual(
      noGroupResponse.body.plans.map((plan: { id: number }) => plan.id).sort((a: number, b: number) => a - b),
      [noGroupConfirmedId, noGroupDraftId].sort((a, b) => a - b),
      '未入组用户只能看到自己的 confirmed 和 draft',
    );
    assert.equal(noGroupResponse.body.total, 2);
  });

  test('scope=mine 与默认列表保持一致，非法 scope 返回 400', async () => {
    const defaultResponse = await req('GET', '/api/lesson-plans?limit=100', { token: peerToken });
    const mineResponse = await req('GET', '/api/lesson-plans?scope=mine&limit=100', { token: peerToken });
    assert.equal(defaultResponse.status, 200);
    assert.equal(mineResponse.status, 200);
    assert.deepEqual(mineResponse.body, defaultResponse.body);
    assert.ok(mineResponse.body.plans.every((plan: { userId: number }) => plan.userId === peerId));
    assert.ok(!mineResponse.body.plans.some((plan: { id: number }) => plan.id === sourceId));

    for (const scope of ['all', 'GROUP', '']) {
      const response = await req('GET', `/api/lesson-plans?scope=${encodeURIComponent(scope)}`, { token: peerToken });
      assert.equal(response.status, 400, JSON.stringify({ scope, body: response.body }));
    }
  });

  test('服务层深拷贝且所有克隆操作完成后源教案逐字段不变', () => {
    const cloned = cloneLessonPlan(ownerId, sourceId)!;
    cloned.plan.weekly_lesson_plans[0].objectives[0] = '不应写回源教案或数据库';
    const persistedClone = getLessonPlanById(ownerId, cloned.id)!;
    assert.equal(persistedClone.plan.weekly_lesson_plans[0].objectives[0],
      sourceDocument.weekly_lesson_plans[0].objectives[0]);
    assert.deepEqual(cloneLessonPlan(peerId, sourceId)!.plan, sourceDocument);
    const currentSource = db.prepare('SELECT * FROM lesson_plans WHERE id = ?').get(sourceId);
    assert.deepEqual(currentSource, sourceSnapshot);
    assert.equal((currentSource as { status: string }).status, 'confirmed');
    assert.equal((currentSource as { confirmed_at: string }).confirmed_at, '2026-05-02 08:00:00');
  });
});
