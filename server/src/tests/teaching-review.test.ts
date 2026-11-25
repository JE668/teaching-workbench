import './setup.js';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../config/database.js';
import { createStudent, createUser, req, startServer, stopServer, userIdOf } from './helpers.js';

const MONTH = '2026-10';
const STRUCTURED_CONTENT = [
  '【学生收获】能独立完成分数通分并说明理由。',
  '【课堂表现】主动演算，遇到错误会重新检查。',
  '【作业布置】完成十道异分母分数练习。',
  '【下步计划】下节课进入分数应用题。',
  '【教师评价】基础扎实，继续保持验算习惯。',
].join('\n');

let token = '';
let otherToken = '';
let emptyToken = '';
let userId = 0;
let otherUserId = 0;
let studentA = 0;
let studentB = 0;
let studentC = 0;
let studentD = 0;
let otherStudent = 0;

function insertFollowup(
  ownerId: number,
  studentId: number,
  studentName: string,
  createdAt: string,
  options: { content?: string; wordCount?: number; images?: string[]; mastery?: string } = {},
): number {
  return Number(db.prepare(
    `INSERT INTO followups
      (user_id, student_id, student_name, grade, subject, topic, performance, mastery, images, content, word_count, created_at)
     VALUES (?, ?, ?, '五年级', '数学', '分数运算', '课堂表现稳定', ?, ?, ?, ?, ?)`,
  ).run(
    ownerId,
    studentId,
    studentName,
    options.mastery ?? 'good',
    JSON.stringify(options.images ?? []),
    options.content ?? '简短回访',
    options.wordCount ?? 50,
    createdAt,
  ).lastInsertRowid);
}

function insertObservation(ownerId: number, topic: string, observedAt: string | null, status: 'draft' | 'sent' | 'archived'): void {
  db.prepare('INSERT INTO observations (user_id, topic, observed_at, status) VALUES (?, ?, ?, ?)').run(
    ownerId,
    topic,
    observedAt,
    status,
  );
}

function insertReport(ownerId: number, studentId: number, yearMonth: string): number {
  return Number(db.prepare(
    "INSERT INTO monthly_reports (user_id, student_id, year_month, term, grade, subject) VALUES (?, ?, ?, '秋季', '五年级', '数学')",
  ).run(ownerId, studentId, yearMonth).lastInsertRowid);
}

function insertKnowledgePoint(
  ownerId: number,
  studentId: number,
  pointName: string,
  category: 'concept' | 'skill',
  mastery: number,
): number {
  return Number(db.prepare(
    `INSERT INTO knowledge_points
      (user_id, student_id, subject, grade, point_name, point_category, mastery_level, evidence_count, last_seen_at)
     VALUES (?, ?, '数学', '五年级', ?, ?, ?, 1, '2026-10-20 10:00:00')`,
  ).run(ownerId, studentId, pointName, category, mastery).lastInsertRowid);
}

function insertAiMetric(
  ownerId: number,
  endpoint: string,
  status: 'success' | 'error' | 'retry',
  createdAt: string,
  options: {
    retryCount?: number;
    totalTokens?: number;
    latencyMs?: number;
    wordCount?: number | null;
    wordRangeMin?: number | null;
    wordRangeMax?: number | null;
  } = {},
): void {
  db.prepare(
    `INSERT INTO ai_metrics
      (user_id, provider, model, endpoint, total_tokens, latency_ms, status, retry_count,
       word_count, word_range_min, word_range_max, created_at)
     VALUES (?, 'fixture', 'fixed-model', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    ownerId,
    endpoint,
    options.totalTokens ?? 0,
    options.latencyMs ?? 0,
    status,
    options.retryCount ?? 0,
    options.wordCount ?? null,
    options.wordRangeMin ?? null,
    options.wordRangeMax ?? null,
    createdAt,
  );
}

before(async () => {
  await startServer();
  token = await createUser('teaching-review-owner');
  otherToken = await createUser('teaching-review-other');
  emptyToken = await createUser('teaching-review-empty');
  userId = userIdOf(token);
  otherUserId = userIdOf(otherToken);

  studentA = (await createStudent(token, { name: '甲生' })).id as number;
  studentB = (await createStudent(token, { name: '乙生' })).id as number;
  studentC = (await createStudent(token, { name: '丙生' })).id as number;
  studentD = (await createStudent(token, { name: '丁生' })).id as number;
  otherStudent = (await createStudent(otherToken, { name: '他人生' })).id as number;

  const followupA = insertFollowup(userId, studentA, '甲生', '2026-10-05 10:00:00', {
    content: STRUCTURED_CONTENT,
    wordCount: 100,
    images: ['/uploads/review-a.png'],
    mastery: 'good',
  });
  const followupB = insertFollowup(userId, studentB, '乙生', '2026-10-20 10:00:00', {
    content: '只有一段非结构化内容',
    wordCount: 50,
    mastery: 'average',
  });
  insertFollowup(userId, studentC, '丙生', '2026-09-08 09:00:00', { wordCount: 80 });
  insertFollowup(otherUserId, otherStudent, '他人生', '2026-10-06 10:00:00', {
    content: STRUCTURED_CONTENT,
    wordCount: 999,
    images: ['/uploads/other.png'],
  });

  // 同一回访被引用两次也只能计为一条被引用的回访。
  db.prepare("INSERT INTO content_references (source_type, source_id, target_type, target_id, ref_role) VALUES ('followup', ?, 'observation', 9001, 'cites')").run(followupA);
  db.prepare("INSERT INTO content_references (source_type, source_id, target_type, target_id, ref_role) VALUES ('followup', ?, 'observation', 9002, 'cites')").run(followupA);
  const insertParentView = db.prepare(
    `INSERT INTO parent_views (user_id, source_type, source_id, view_json, access_token, read_at)
     VALUES (?, 'followup', ?, '{}', ?, ?)`,
  );
  insertParentView.run(userId, followupA, 'review-followup-a', '2026-10-06 12:00:00');
  insertParentView.run(userId, followupB, 'review-followup-b', null);

  insertObservation(userId, '十月已反馈', '2026-10-08', 'sent');
  insertObservation(userId, '十月已归档', '2026-10-25', 'archived');
  insertObservation(userId, '十月草稿也计入', '2026-10-10', 'draft');
  insertObservation(userId, '九月已反馈', '2026-09-15', 'sent');
  insertObservation(otherUserId, '他人十月已反馈', '2026-10-11', 'sent');
  insertObservation(userId, '无听课日期不计入月度', null, 'draft');
  insertObservation(userId, '次月一日不计入十月', '2026-11-01', 'draft');

  const octoberReportA = insertReport(userId, studentA, MONTH);
  const octoberReportB = insertReport(userId, studentB, MONTH);
  const septemberReportA = insertReport(userId, studentA, '2026-09');
  const otherOctoberReport = insertReport(otherUserId, otherStudent, MONTH);

  const pointA1 = insertKnowledgePoint(userId, studentA, '概念甲一', 'concept', 0.8);
  const pointA2 = insertKnowledgePoint(userId, studentA, '概念甲二', 'concept', 0.2);
  const pointASkill = insertKnowledgePoint(userId, studentA, '技能甲一', 'skill', 0.9);
  const pointB1 = insertKnowledgePoint(userId, studentB, '概念乙一', 'concept', 0.4);
  const otherPoint = insertKnowledgePoint(otherUserId, otherStudent, '他人概念', 'concept', 0.95);

  const insertDelta = db.prepare('INSERT INTO report_knowledge_points (report_id, point_id, delta, evidence) VALUES (?, ?, ?, ?)');
  insertDelta.run(octoberReportA, pointA1, 0.1, '甲一进步');
  insertDelta.run(octoberReportA, pointA2, -0.05, '甲二回落');
  insertDelta.run(octoberReportA, pointASkill, 0.3, '技能进步');
  insertDelta.run(octoberReportB, pointB1, 0.2, '乙一进步');
  insertDelta.run(septemberReportA, pointA1, 4, '九月证据不应混入十月');
  insertDelta.run(otherOctoberReport, otherPoint, 9, '他人证据不应混入');

  // 直接构造遗留脏数据：正常分组 API 会拒绝他人学生，但聚合仍必须按 owner 再过滤。
  db.prepare('INSERT INTO groups (user_id, name, student_ids) VALUES (?, ?, ?)').run(
    userId,
    '固定对标组',
    JSON.stringify([studentA, studentB, otherStudent, studentA]),
  );
  db.prepare('INSERT INTO groups (user_id, name, student_ids) VALUES (?, ?, ?)').run(
    userId,
    '无知识证据组',
    JSON.stringify([studentC, studentD, studentC]),
  );
  db.prepare('INSERT INTO groups (user_id, name, student_ids) VALUES (?, ?, ?)').run(
    userId,
    '脏 JSON 组',
    'not-valid-json',
  );

  insertAiMetric(userId, 'followup_stream', 'success', '2026-10-01 10:00:00', {
    retryCount: 2,
    totalTokens: 100,
    latencyMs: 100,
    wordCount: 120,
    wordRangeMin: 100,
    wordRangeMax: 150,
  });
  insertAiMetric(userId, 'report_summary', 'success', '2026-10-02 10:00:00', {
    totalTokens: 200,
    latencyMs: 200,
    wordCount: 300,
    wordRangeMin: 100,
    wordRangeMax: 200,
  });
  insertAiMetric(userId, 'report_summary', 'error', '2026-10-03 10:00:00', {
    retryCount: 1,
    totalTokens: 30,
    latencyMs: 300,
    wordCount: 100,
    wordRangeMin: 0,
    wordRangeMax: 200,
  });
  insertAiMetric(userId, 'followup_stream', 'retry', '2026-10-04 10:00:00', {
    retryCount: 3,
    totalTokens: 20,
    latencyMs: 400,
  });
  insertAiMetric(userId, 'followup_stream', 'success', '2026-09-04 10:00:00', {
    totalTokens: 10,
    latencyMs: 50,
  });
  insertAiMetric(otherUserId, 'followup_stream', 'success', '2026-10-07 10:00:00', {
    totalTokens: 777,
    latencyMs: 777,
    wordCount: 999,
    wordRangeMin: 1,
    wordRangeMax: 1000,
  });
});

after(async () => {
  await stopServer();
});

describe('teaching-review 固定数据回归', () => {
  test('summary 统计 draft/sent/archived 听评课，并完整汇总 retry、重试次数、token 与字数目标', async () => {
    const res = await req('GET', '/api/teaching-review/summary?month=' + MONTH, { token });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.workload, {
      followups: 2,
      reports: 2,
      observations: 3,
      lessonPlans: 0,
      lessonPlansConfirmed: 0,
      students: 4,
      total: 7,
    });
    assert.equal(res.body.quality.aiCalls, 4);
    assert.equal(res.body.quality.aiSuccessRate, 50);
    assert.equal(res.body.quality.aiErrorCount, 1);
    assert.equal(res.body.quality.aiRetryCount, 3, 'success/error 行上的 retry_count 也应计入重试调用');
    assert.equal(res.body.quality.aiRetryRate, 75);
    assert.equal(res.body.quality.retryAttempts, 6);
    assert.equal(res.body.quality.totalTokens, 350);
    assert.equal(res.body.quality.avgLatencyMs, 250);
    assert.deepEqual(res.body.quality.wordTarget, { measured: 2, inRange: 1, rate: 50 });
    assert.equal(res.body.quality.latencyWordCount.length, 2, 'error 行即使有字数也不进入成功字数样本');
    assert.deepEqual(res.body.quality.funnel, [
      { key: 'calls', label: '发起调用', value: 4 },
      { key: 'success', label: '生成成功', value: 2 },
      { key: 'measured', label: '成功且有字数目标', value: 2 },
      { key: 'inRange', label: '字数达标', value: 1 },
    ]);
    const followupEndpoint = res.body.quality.byEndpoint.find((row: any) => row.endpoint === 'followup_stream');
    assert.deepEqual(followupEndpoint, {
      endpoint: 'followup_stream',
      calls: 2,
      successRate: 50,
      retryCount: 2,
      retryRate: 100,
      avgLatencyMs: 250,
    });
  });

  test('空 AI 数据使用 null 成功率，重试与字数目标保持零值语义', async () => {
    const res = await req('GET', '/api/teaching-review/summary?month=' + MONTH, { token: emptyToken });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.quality.aiCalls, 0);
    assert.equal(res.body.quality.aiSuccessRate, null);
    assert.equal(res.body.quality.aiRetryRate, null);
    assert.equal(res.body.quality.avgLatencyMs, null);
    assert.equal(res.body.quality.retryAttempts, 0);
    assert.equal(res.body.quality.totalTokens, 0);
    assert.deepEqual(res.body.quality.wordTarget, { measured: 0, inRange: 0, rate: null });
  });

  test('growth 先按学生等权再加权类别，monthlyKnowledgeDelta 只汇总所选月', async () => {
    const res = await req('GET', '/api/teaching-review/summary?month=' + MONTH, { token });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const concept = res.body.growth.find((row: any) => row.category === 'concept');
    assert.deepEqual(concept, { category: 'concept', total: 3, solid: 1, weak: 1, avgMastery: 0.45 });
    const skill = res.body.growth.find((row: any) => row.category === 'skill');
    assert.deepEqual(skill, { category: 'skill', total: 1, solid: 1, weak: 0, avgMastery: 0.9 });
    assert.equal(res.body.growthSemantics, 'current_snapshot_student_weighted');
    assert.deepEqual(res.body.monthlyKnowledgeDelta, [
      {
        category: 'concept',
        delta: 0.25,
        evidenceCount: 3,
        semantics: 'sum_of_report_deltas_not_historical_mastery',
      },
      {
        category: 'skill',
        delta: 0.3,
        evidenceCount: 1,
        semantics: 'sum_of_report_deltas_not_historical_mastery',
      },
    ]);
  });

  test('groupComparisons 去除重复及他人学生，mastery 与 delta 按各自有证据学生等权', async () => {
    const res = await req('GET', '/api/teaching-review/summary?month=' + MONTH, { token });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.groupComparisons.length, 2);
    const fixedGroup = res.body.groupComparisons.find((group: any) => group.groupName === '固定对标组');
    assert.deepEqual(fixedGroup, {
      groupId: fixedGroup.groupId,
      groupName: '固定对标组',
      studentCount: 2,
      masteryStudentCount: 2,
      avgMastery: 0.52,
      deltaStudentCount: 2,
      avgMasteryDelta: 0.28,
      deltaEvidenceCount: 4,
      followupCovered: 2,
      followupCoverageRate: 100,
    });
    assert.ok(Number.isInteger(fixedGroup.groupId));
    const noEvidenceGroup = res.body.groupComparisons.find((group: any) => group.groupName === '无知识证据组');
    assert.deepEqual(noEvidenceGroup, {
      groupId: noEvidenceGroup.groupId,
      groupName: '无知识证据组',
      studentCount: 2,
      masteryStudentCount: 0,
      avgMastery: null,
      deltaStudentCount: 0,
      avgMasteryDelta: null,
      deltaEvidenceCount: 0,
      followupCovered: 0,
      followupCoverageRate: 0,
    });
    assert.equal(res.body.groupComparisons.some((group: any) => group.groupName === '脏 JSON 组'), false);
  });

  test('followupQuality 统计完整结构、图片、去重引用及家长已读率', async () => {
    const res = await req('GET', '/api/teaching-review/summary?month=' + MONTH, { token });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.followupQuality, {
      total: 2,
      avgWordCount: 75,
      structured: 1,
      structuredRate: 50,
      withImages: 1,
      imageRecordRate: 50,
      referenced: 1,
      historicalReferenceRate: 50,
      parentShared: 2,
      parentRead: 1,
      parentReadRate: 50,
    });
  });

  test('students 的 coldCount 统计全量学生，不受返回 limit 截断影响', async () => {
    const res = await req('GET', '/api/teaching-review/students?month=' + MONTH + '&limit=2', { token });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.totalStudents, 4);
    assert.equal(res.body.coveredStudents, 2);
    assert.equal(res.body.coldCount, 2);
    assert.equal(res.body.returnedCount, 2);
    assert.equal(res.body.students.length, 2);
    assert.ok(res.body.students.every((student: any) => student.cold && student.followups === 0));
    assert.deepEqual(res.body.students.map((student: any) => student.studentId), [studentC, studentD], '并列冷学生按 studentId 稳定排序');
  });

  test('trend 以 endMonth 为终点，全部反馈状态与月份边界均按同一口径统计', async () => {
    const res = await req('GET', '/api/teaching-review/trend?months=3&endMonth=' + MONTH, { token });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body, {
      months: 3,
      points: [
        { month: '2026-08', followups: 0, reports: 0, observations: 0, aiCalls: 0, aiSuccessRate: null },
        { month: '2026-09', followups: 1, reports: 1, observations: 1, aiCalls: 1, aiSuccessRate: 100 },
        { month: '2026-10', followups: 2, reports: 2, observations: 3, aiCalls: 4, aiSuccessRate: 50 },
      ],
    });
  });

  test('真实 API 新建的默认 draft 听评课立即进入 summary 与 trend', async () => {
    const created = await req('POST', '/api/observations', {
      token,
      body: { topic: '真实API默认草稿', observedAt: '2026-10-20 09:00:00', classNotes: '真实课堂记录' },
    });
    const observationId = created.body.observation.id;
    try {
      assert.equal(created.status, 200, JSON.stringify(created.body));
      assert.equal(created.body.observation.status, 'draft');
      const summary = await req('GET', '/api/teaching-review/summary?month=' + MONTH, { token });
      assert.equal(summary.body.workload.observations, 4);
      const trend = await req('GET', '/api/teaching-review/trend?months=2&endMonth=' + MONTH, { token });
      assert.equal(trend.body.points[1].observations, 4);
    } finally {
      db.prepare('DELETE FROM observations WHERE id = ? AND user_id = ?').run(observationId, userId);
    }
  });

  test('summary、students、trend 均隔离其他用户的数据', async () => {
    const summary = await req('GET', '/api/teaching-review/summary?month=' + MONTH, { token: otherToken });
    assert.equal(summary.status, 200, JSON.stringify(summary.body));
    assert.deepEqual(summary.body.workload, {
      followups: 1,
      reports: 1,
      observations: 1,
      lessonPlans: 0,
      lessonPlansConfirmed: 0,
      students: 1,
      total: 3,
    });
    assert.equal(summary.body.quality.aiCalls, 1);
    assert.equal(summary.body.quality.aiSuccessRate, 100);
    assert.equal(summary.body.quality.totalTokens, 777);
    assert.deepEqual(summary.body.growth, [
      { category: 'concept', total: 1, solid: 1, weak: 0, avgMastery: 0.95 },
    ]);
    assert.deepEqual(summary.body.monthlyKnowledgeDelta, [
      {
        category: 'concept',
        delta: 9,
        evidenceCount: 1,
        semantics: 'sum_of_report_deltas_not_historical_mastery',
      },
    ]);
    assert.deepEqual(summary.body.groupComparisons, []);

    const students = await req('GET', '/api/teaching-review/students?month=' + MONTH, { token: otherToken });
    assert.equal(students.status, 200);
    assert.equal(students.body.totalStudents, 1);
    assert.equal(students.body.coveredStudents, 1);
    assert.equal(students.body.coldCount, 0);
    assert.deepEqual(students.body.students.map((row: any) => row.studentId), [otherStudent]);

    const trend = await req('GET', '/api/teaching-review/trend?months=2&endMonth=' + MONTH, { token: otherToken });
    assert.equal(trend.status, 200);
    assert.deepEqual(trend.body.points, [
      { month: '2026-09', followups: 0, reports: 0, observations: 0, aiCalls: 0, aiSuccessRate: null },
      { month: '2026-10', followups: 1, reports: 1, observations: 1, aiCalls: 1, aiSuccessRate: 100 },
    ]);
  });

  test('主管可查看全组并按 teacherId 下钻，普通教师不能越权', async () => {
    const previousSupervisors = process.env.TEACHING_SUPERVISOR_USERNAMES;
    const previousAdmins = process.env.ADMIN_USERNAMES;
    try {
      delete process.env.TEACHING_SUPERVISOR_USERNAMES;
      delete process.env.ADMIN_USERNAMES;
      const deniedAccess = await req('GET', '/api/teaching-review/access', { token: otherToken });
      assert.equal(deniedAccess.body.canViewTeam, false);
      assert.equal((await req('GET', '/api/teaching-review/team?month=' + MONTH, { token: otherToken })).status, 403);
      assert.equal((await req('GET', '/api/teaching-review/summary?month=' + MONTH + '&teacherId=' + userId, { token: otherToken })).status, 403);

      const supervisorToken = await createUser('teaching-review-supervisor');
      process.env.TEACHING_SUPERVISOR_USERNAMES = 'teaching-review-supervisor';
      const access = await req('GET', '/api/teaching-review/access', { token: supervisorToken });
      assert.equal(access.body.canViewTeam, true);
      const team = await req('GET', '/api/teaching-review/team?month=' + MONTH, { token: supervisorToken });
      assert.equal(team.status, 200, JSON.stringify(team.body));
      const ownerRow = team.body.teachers.find((row: any) => row.teacherId === userId);
      assert.deepEqual(ownerRow, {
        teacherId: userId, username: 'teaching-review-owner', students: 4,
        followups: 2, reports: 2, observations: 3,
        lessonPlans: 0, aiCalls: 4, aiSuccessRate: 50,
      });

      const summary = await req('GET', '/api/teaching-review/summary?month=' + MONTH + '&teacherId=' + otherUserId, { token: supervisorToken });
      assert.equal(summary.status, 200, JSON.stringify(summary.body));
      assert.equal(summary.body.workload.followups, 1);
      assert.equal(summary.body.quality.totalTokens, 777);
      const students = await req('GET', '/api/teaching-review/students?month=' + MONTH + '&teacherId=' + otherUserId, { token: supervisorToken });
      assert.deepEqual(students.body.students.map((row: any) => row.studentId), [otherStudent]);
      const trend = await req('GET', '/api/teaching-review/trend?months=2&endMonth=' + MONTH + '&teacherId=' + otherUserId, { token: supervisorToken });
      assert.equal(trend.body.points[1].aiCalls, 1);
      assert.equal((await req('GET', '/api/teaching-review/summary?month=' + MONTH + '&teacherId=bad', { token: supervisorToken })).status, 400);
      assert.equal((await req('GET', '/api/teaching-review/summary?month=' + MONTH + '&teacherId=999999', { token: supervisorToken })).status, 404);
    } finally {
      if (previousSupervisors === undefined) delete process.env.TEACHING_SUPERVISOR_USERNAMES;
      else process.env.TEACHING_SUPERVISOR_USERNAMES = previousSupervisors;
      if (previousAdmins === undefined) delete process.env.ADMIN_USERNAMES;
      else process.env.ADMIN_USERNAMES = previousAdmins;
    }
  });
});
