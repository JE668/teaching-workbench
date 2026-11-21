import './setup.js';
import assert from 'node:assert/strict';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { after, afterEach, before, beforeEach, describe, test } from 'node:test';
import express from 'express';
import { db } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.js';
import reportsAiRouter from '../routes/reports.ai.js';
import { resetChatGenerator, setChatGenerator } from '../services/ai/index.js';
import { createFallbackLessonPlan } from '../services/ai/lessonPlanner.js';
import { createStudent, createUser, startServer, stopServer, userIdOf } from './helpers.js';

const REPORT_MONTH = '2026-03';
const validDocument = createFallbackLessonPlan({}, { month: REPORT_MONTH, weekCount: 1, durationMinutes: 45 });
const defaultDocument = createFallbackLessonPlan({}, { month: REPORT_MONTH, weekCount: 4, durationMinutes: 45 });

let token = '';
let otherToken = '';
let userId = 0;
let firstStudentId = 0;
let secondStudentId = 0;
let otherStudentId = 0;
let reportId = 0;
let otherReportId = 0;
let reportServer: http.Server;
let baseUrl = '';
let aiCalls: Array<{ userId: number; prompt: string }> = [];

async function generateRequest(id: number, body: unknown = {}, auth = token) {
  const response = await fetch(baseUrl + '/api/reports/' + id + '/generate-lesson-plans', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + auth, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

function savedPlanCount(): number {
  return (db.prepare('SELECT COUNT(*) AS count FROM lesson_plans').get() as { count: number }).count;
}

describe('POST /api/reports/:id/generate-lesson-plans', () => {
  before(async () => {
    await startServer();
    token = await createUser('lesson-report-owner');
    otherToken = await createUser('lesson-report-other');
    userId = userIdOf(token);
    firstStudentId = (await createStudent(token, { name: '月报学生甲', grade: '初二', subject: '数学' })).id;
    secondStudentId = (await createStudent(token, { name: '月报学生乙', grade: '初二', subject: '数学' })).id;
    otherStudentId = (await createStudent(otherToken, { name: '他人学生', grade: '初二', subject: '数学' })).id;

    reportId = Number(db.prepare(
      'INSERT INTO monthly_reports (user_id, student_id, year_month, term, grade, subject) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(userId, firstStudentId, REPORT_MONTH, '2026春季', '初二', '数学').lastInsertRowid);
    db.prepare(
      "INSERT INTO report_items (user_id, report_id, kind, seq, content, type, scheduled_at, sort) VALUES (?, ?, 'plan', 1, ?, '新授课', '2026-03-05', 1)",
    ).run(userId, reportId, '一次函数图象与性质');

    const otherUserId = userIdOf(otherToken);
    otherReportId = Number(db.prepare(
      'INSERT INTO monthly_reports (user_id, student_id, year_month, term, grade, subject) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(otherUserId, otherStudentId, REPORT_MONTH, '2026春季', '初二', '数学').lastInsertRowid);

    const app = express();
    app.use(express.json());
    app.use('/api/reports', authMiddleware, reportsAiRouter);
    reportServer = http.createServer(app);
    await new Promise<void>((resolve) => reportServer.listen(0, '127.0.0.1', resolve));
    baseUrl = 'http://127.0.0.1:' + (reportServer.address() as AddressInfo).port;
  });

  beforeEach(() => {
    aiCalls = [];
  });

  afterEach(() => resetChatGenerator());

  after(async () => {
    resetChatGenerator();
    reportServer.closeAllConnections();
    await new Promise<void>((resolve) => reportServer.close(() => resolve()));
    await stopServer();
  });

  test('多学生顺序生成成功并去重，保留来源月份和教案参数', async () => {
    let active = 0;
    let maxActive = 0;
    setChatGenerator(async (aiUserId, messages) => {
      aiCalls.push({ userId: aiUserId, prompt: messages[messages.length - 1].content });
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => setImmediate(resolve));
      active--;
      return JSON.stringify(validDocument);
    });

    const beforeCount = savedPlanCount();
    const response = await generateRequest(reportId, {
      studentIds: [firstStudentId, secondStudentId, firstStudentId],
      durationMinutes: 45,
      weekCount: 1,
      requirements: '加入分层练习',
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal(response.body.sourceReportId, reportId);
    assert.equal(response.body.month, REPORT_MONTH);
    assert.deepEqual(response.body.failures, []);
    assert.deepEqual(response.body.plans.map((plan: any) => plan.studentId), [firstStudentId, secondStudentId]);
    assert.equal(response.body.plans[0].month, REPORT_MONTH);
    assert.equal(response.body.plans[0].durationMinutes, 45);
    assert.equal(response.body.plans[0].weekCount, 1);
    assert.equal(response.body.plans[0].requirements, '加入分层练习');
    assert.equal(response.body.plans[0].status, 'draft');
    assert.equal(response.body.plans[0].plan.month, REPORT_MONTH);
    assert.equal(response.body.plans[0].modelMetadata.usedFallback, false);
    assert.equal('reportId' in response.body.plans[0], false);
    assert.equal(savedPlanCount(), beforeCount + 2);
    assert.equal(aiCalls.length, 2);
    assert.equal(maxActive, 1, '批量生成必须顺序调用 AI');
    assert.ok(aiCalls.every((call) => call.userId === userId && call.prompt.includes('加入分层练习')));
    assert.ok(aiCalls[0].prompt.includes('月报学生甲'));
    assert.ok(aiCalls[0].prompt.includes('一次函数图象与性质'));
    assert.ok(aiCalls[1].prompt.includes('月报学生乙'));
  });

  test('缺省 studentIds 和生成参数时使用当前报告学生、报告月份及服务默认值', async () => {
    setChatGenerator(async (aiUserId, messages) => {
      aiCalls.push({ userId: aiUserId, prompt: messages[messages.length - 1].content });
      return JSON.stringify(defaultDocument);
    });

    const response = await generateRequest(reportId);
    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal(response.body.plans.length, 1);
    assert.deepEqual(response.body.failures, []);
    assert.equal(response.body.sourceReportId, reportId);
    assert.equal(response.body.month, REPORT_MONTH, '默认月份是报告 year_month，而不是下一月');
    assert.equal(response.body.plans[0].studentId, firstStudentId);
    assert.equal(response.body.plans[0].month, REPORT_MONTH);
    assert.equal(response.body.plans[0].durationMinutes, 45);
    assert.equal(response.body.plans[0].weekCount, 4);
    assert.equal(response.body.plans[0].requirements, '');
    assert.equal(response.body.plans[0].plan.weekly_lesson_plans.length, 4);
    assert.equal(aiCalls.length, 1);
  });

  test('跨用户报告、跨用户或不存在的学生均返回 404，且不会先调用 AI', async () => {
    setChatGenerator(async () => {
      aiCalls.push({ userId: 0, prompt: '' });
      return JSON.stringify(validDocument);
    });
    const beforeCount = savedPlanCount();

    const foreignReport = await generateRequest(otherReportId, { weekCount: 1 });
    assert.equal(foreignReport.status, 404);
    const foreignStudent = await generateRequest(reportId, {
      studentIds: [firstStudentId, otherStudentId], weekCount: 1,
    });
    assert.equal(foreignStudent.status, 404);
    assert.equal(foreignStudent.body.studentId, otherStudentId);
    const missingStudent = await generateRequest(reportId, {
      studentIds: [firstStudentId, 999999], weekCount: 1,
    });
    assert.equal(missingStudent.status, 404);
    assert.equal(aiCalls.length, 0);
    assert.equal(savedPlanCount(), beforeCount);
  });

  test('strict body 拒绝非法学生列表、生成参数和未知字段，零 AI 调用', async () => {
    setChatGenerator(async () => {
      aiCalls.push({ userId: 0, prompt: '' });
      return JSON.stringify(validDocument);
    });
    const beforeCount = savedPlanCount();
    const invalidBodies: unknown[] = [
      { studentIds: [] },
      { studentIds: Array.from({ length: 21 }, (_, index) => index + 1) },
      { studentIds: [0] },
      { studentIds: [1.5] },
      { studentIds: null },
      { month: '2026-13' },
      { durationMinutes: 14 },
      { durationMinutes: 241 },
      { weekCount: 0 },
      { weekCount: 9 },
      { requirements: 'x'.repeat(2001) },
      { unexpected: true },
    ];
    for (const body of invalidBodies) {
      const response = await generateRequest(reportId, body);
      assert.equal(response.status, 400, JSON.stringify(body));
      assert.equal(response.body.error, '参数校验失败');
    }
    assert.equal(aiCalls.length, 0);
    assert.equal(savedPlanCount(), beforeCount);
  });

  test('单个学生失败返回 201，成功教案保留且 failures 指明失败学生', async () => {
    setChatGenerator(async (aiUserId, messages) => {
      aiCalls.push({ userId: aiUserId, prompt: messages[messages.length - 1].content });
      if (aiCalls.length === 2) throw new Error('mock upstream unavailable');
      return JSON.stringify(validDocument);
    });
    const beforeCount = savedPlanCount();
    const response = await generateRequest(reportId, {
      studentIds: [firstStudentId, secondStudentId], weekCount: 1,
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal(response.body.plans.length, 1);
    assert.equal(response.body.plans[0].studentId, firstStudentId);
    assert.deepEqual(response.body.failures, [
      { studentId: secondStudentId, message: 'mock upstream unavailable' },
    ]);
    assert.equal(response.body.sourceReportId, reportId);
    assert.equal(response.body.month, REPORT_MONTH);
    assert.equal(savedPlanCount(), beforeCount + 1);
  });

  test('全部学生失败返回 502，并保留逐项失败信息且无教案落库', async () => {
    setChatGenerator(async (aiUserId, messages) => {
      aiCalls.push({ userId: aiUserId, prompt: messages[messages.length - 1].content });
      throw new Error('mock total outage');
    });
    const beforeCount = savedPlanCount();
    const response = await generateRequest(reportId, {
      studentIds: [firstStudentId, secondStudentId], weekCount: 1,
    });
    assert.equal(response.status, 502, JSON.stringify(response.body));
    assert.deepEqual(response.body.plans, []);
    assert.deepEqual(response.body.failures, [
      { studentId: firstStudentId, message: 'mock total outage' },
      { studentId: secondStudentId, message: 'mock total outage' },
    ]);
    assert.equal(response.body.sourceReportId, reportId);
    assert.equal(response.body.month, REPORT_MONTH);
    assert.equal(aiCalls.length, 2);
    assert.equal(savedPlanCount(), beforeCount);
  });
});
