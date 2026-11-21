import './setup.js';
import assert from 'node:assert/strict';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { after, afterEach, before, describe, test } from 'node:test';
import express from 'express';
import { db } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.js';
import lessonPlannerRouter from '../routes/lessonPlanner.js';
import { resetChatGenerator, setChatGenerator } from '../services/ai/index.js';
import {
  LessonPlanDocument,
  collectLessonPlannerContext,
  createFallbackLessonPlan,
  generateLessonPlan,
  parseLessonPlanResponse,
  saveGeneratedLessonPlan,
  validateLessonPlanRules,
} from '../services/ai/lessonPlanner.js';
import { createStudent, createUser, startServer, stopServer, userIdOf } from './helpers.js';

let token = '';
let otherToken = '';
let userId = 0;
let studentId = 0;
let courseId = 0;
let generatedId = 0;
let lessonServer: http.Server;
let lessonBaseUrl = '';
let validDocument: LessonPlanDocument;

async function lessonRequest(method: string, path: string, auth = token, body?: unknown) {
  const response = await fetch(lessonBaseUrl + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + auth,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

describe('AI lesson planner', () => {
  before(async () => {
    await startServer();
    token = await createUser('lesson-planner-owner');
    otherToken = await createUser('lesson-planner-other');
    userId = userIdOf(token);
    const student = await createStudent(token, { name: '备课测试生', grade: '初二', subject: '数学' });
    studentId = student.id;

    courseId = Number(db.prepare("INSERT INTO course_catalog (user_id, band, term, grade, subject, track, seq, content, type, textbook, section, sheet) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      userId, '初中', '2026春季', '初二', '数学', '同步', 3,
      '一次函数图象与性质', '新授课', '人教版', '第十九章第二节', '函数',
    ).lastInsertRowid);

    db.prepare('INSERT INTO student_profiles (user_id, student_id, profile_json) VALUES (?, ?, ?)').run(
      userId, studentId, JSON.stringify({ learning_style: '偏好图象与动手探究', strengths: ['计算'], weaknesses: ['函数建模'] }),
    );
    const reportId = Number(db.prepare("INSERT INTO monthly_reports (user_id, student_id, year_month, term, grade, subject) VALUES (?, ?, ?, ?, ?, ?)").run(
      userId, studentId, '2026-02', '2026春季', '初二', '数学',
    ).lastInsertRowid);
    db.prepare("INSERT INTO report_items (user_id, report_id, kind, seq, content, type, scheduled_at, sort) VALUES (?, ?, 'plan', ?, ?, ?, ?, ?)").run(
      userId, reportId, 1, '从变量关系过渡到一次函数图象', '新授课', '2026-03-05', 1,
    );
    db.prepare("INSERT INTO followups (user_id, student_id, student_name, grade, subject, topic, performance, mastery, content) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      userId, studentId, '备课测试生', '初二', '数学', '变量与函数',
      '能代入求值，但解释实际意义需要提示', 'partial', '近期对自变量取值范围仍有混淆',
    );
    db.prepare("INSERT INTO knowledge_points (user_id, student_id, subject, grade, point_name, point_category, mastery_level, evidence_count, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'))").run(
      userId, studentId, '数学', '初二', '函数图象读信息', 'skill', 0.42, 4,
    );

    const oldInput = { studentId, courseId, month: '2026-02', weekCount: 1, durationMinutes: 45 };
    const oldPlan = createFallbackLessonPlan({}, oldInput);
    saveGeneratedLessonPlan(userId, oldInput, {
      plan: oldPlan,
      modelMetadata: { provider: 'test', model: 'fixture', promptVersion: 'test', usedFallback: false, latencyMs: 0 },
    });
    validDocument = createFallbackLessonPlan({}, { month: '2026-03', weekCount: 1, durationMinutes: 45 });

    const app = express();
    app.use(express.json());
    app.use('/api/lesson-plans', authMiddleware, lessonPlannerRouter);
    lessonServer = http.createServer(app);
    await new Promise<void>((resolve) => lessonServer.listen(0, '127.0.0.1', resolve));
    lessonBaseUrl = 'http://127.0.0.1:' + (lessonServer.address() as AddressInfo).port;
  });

  afterEach(() => resetChatGenerator());

  after(async () => {
    resetChatGenerator();
    lessonServer.closeAllConnections();
    await new Promise<void>((resolve) => lessonServer.close(() => resolve()));
    await stopServer();
  });

  test('严格解析结构化 JSON，拒绝 Markdown 和错误时长', () => {
    const expected = { month: '2026-03', weekCount: 1, durationMinutes: 45 };
    const fence = String.fromCharCode(96).repeat(3);
    assert.deepEqual(parseLessonPlanResponse(JSON.stringify(validDocument), expected), validDocument);
    assert.deepEqual(parseLessonPlanResponse(fence + 'json\n' + JSON.stringify(validDocument) + '\n' + fence, expected), validDocument);
    assert.equal(parseLessonPlanResponse('## 教案\n' + JSON.stringify(validDocument), expected), null);
    const wrongMinutes = structuredClone(validDocument);
    wrongMinutes.weekly_lesson_plans[0].activities[0].duration_minutes = 10;
    assert.equal(parseLessonPlanResponse(JSON.stringify(wrongMinutes), expected), null);
    assert.ok(validateLessonPlanRules(wrongMinutes, expected).some((message) => message.includes('总时长')));
  });

  test('聚合真实月计划、画像、教材、薄弱点和历史教案', () => {
    const context = collectLessonPlannerContext(userId, {
      studentId, courseId, month: '2026-03', weekCount: 1, durationMinutes: 45,
    });
    assert.equal(context.course?.content, '一次函数图象与性质');
    assert.equal(context.course?.textbook, '人教版');
    assert.equal(context.student_profile?.profile.learning_style, '偏好图象与动手探究');
    assert.equal(context.monthly_plan_items?.[0].content, '从变量关系过渡到一次函数图象');
    assert.equal(context.weak_knowledge_points?.[0].point_name, '函数图象读信息');
    assert.equal(context.recent_followups?.[0].topic, '变量与函数');
    assert.equal(context.historical_lesson_plans?.[0].month, '2026-02');
    assert.ok((context.course_catalog?.length || 0) >= 1);
  });

  test('mock AI 生成、提示词包含证据并保存草稿', async () => {
    let prompt = '';
    setChatGenerator(async (_userId, messages) => {
      prompt = messages[messages.length - 1].content;
      return JSON.stringify(validDocument);
    });
    const response = await lessonRequest('POST', '/api/lesson-plans/generate', token, {
      studentId, courseId, month: '2026-03', weekCount: 1, durationMinutes: 45,
      requirements: '增加一道生活情境压轴题',
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    generatedId = response.body.plan.id;
    assert.equal(response.body.plan.status, 'draft');
    assert.equal(response.body.plan.studentName, '备课测试生');
    assert.equal(response.body.plan.modelMetadata.usedFallback, false);
    assert.equal(response.body.plan.plan.month, '2026-03');
    assert.ok(!JSON.stringify(response.body.plan.plan).includes(fenceForAssertion()));
    for (const evidence of ['一次函数图象与性质', '从变量关系过渡到一次函数图象', '函数图象读信息', '2026-02', '增加一道生活情境压轴题']) {
      assert.ok(prompt.includes(evidence), '提示词缺少证据: ' + evidence);
    }
    const stored = db.prepare('SELECT plan_json FROM lesson_plans WHERE id = ? AND user_id = ?').get(generatedId, userId) as { plan_json: string };
    assert.doesNotThrow(() => JSON.parse(stored.plan_json));
  });

  test('非结构输出走确定性 fallback，仍返回合法结构', async () => {
    setChatGenerator(async () => '这是一份 Markdown 教案，不是 JSON');
    const generated = await generateLessonPlan(userId, {
      studentId, courseId, month: '2026-04', weekCount: 2, durationMinutes: 60,
    });
    assert.equal(generated.modelMetadata.usedFallback, true);
    assert.equal(generated.plan.month, '2026-04');
    assert.equal(generated.plan.weekly_lesson_plans.length, 2);
    assert.deepEqual(validateLessonPlanRules(generated.plan, { month: '2026-04', weekCount: 2, durationMinutes: 60 }), []);
    assert.notEqual(parseLessonPlanResponse(JSON.stringify(generated.plan), { month: '2026-04', weekCount: 2, durationMinutes: 60 }), null);
    const metric = db.prepare("SELECT status, error_message FROM ai_metrics WHERE user_id = ? AND endpoint = 'lesson_planner_generate' ORDER BY id DESC LIMIT 1").get(userId) as { status: string; error_message: string | null };
    assert.equal(metric.status, 'error');
    assert.equal(metric.error_message, 'invalid_or_noncompliant_model_output_fallback_used');
  });

  test('路由校验、跨用户隔离、教师编辑确认和删除', async () => {
    const invalid = await lessonRequest('POST', '/api/lesson-plans/generate', token, { durationMinutes: 0 });
    assert.equal(invalid.status, 400);
    assert.equal((await lessonRequest('GET', '/api/lesson-plans/' + generatedId, otherToken)).status, 404);
    assert.equal((await lessonRequest('DELETE', '/api/lesson-plans/' + generatedId, otherToken)).status, 404);
    assert.equal((await lessonRequest('GET', '/api/lesson-plans', otherToken)).body.total, 0);

    const badEdit = structuredClone(validDocument);
    badEdit.weekly_lesson_plans[0].activities = [];
    assert.equal((await lessonRequest('PUT', '/api/lesson-plans/' + generatedId, token, { plan: badEdit })).status, 400);

    const edited = structuredClone(validDocument);
    edited.weekly_lesson_plans[0].objectives[0] = '教师已编辑：能独立解释函数图象';
    const confirmed = await lessonRequest('PUT', '/api/lesson-plans/' + generatedId, token, {
      title: '三月一次函数备课（教师确认版）', status: 'confirmed', plan: edited,
    });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
    assert.equal(confirmed.body.plan.status, 'confirmed');
    assert.ok(confirmed.body.plan.confirmedAt);
    assert.equal(confirmed.body.plan.plan.weekly_lesson_plans[0].objectives[0], '教师已编辑：能独立解释函数图象');

    const list = await lessonRequest('GET', '/api/lesson-plans?studentId=' + studentId, token);
    assert.equal(list.status, 200);
    assert.ok(list.body.total >= 2);
    assert.equal((await lessonRequest('DELETE', '/api/lesson-plans/' + generatedId, token)).status, 200);
    assert.equal((await lessonRequest('GET', '/api/lesson-plans/' + generatedId, token)).status, 404);
  });
});

function fenceForAssertion() { return String.fromCharCode(96).repeat(3); }
