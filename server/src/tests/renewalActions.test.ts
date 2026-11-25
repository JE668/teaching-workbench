import './setup.js';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { after, afterEach, before, beforeEach, mock, test } from 'node:test';
import express from 'express';
import { initRenewalDb, renewalDb } from '../renewal/db.js';
import type { AuthenticatedRequest } from '../types/index.js';
import { actionRouter, initRenewalActions } from '../renewal/actionRoutes.js';
import { log } from '../utils/logger.js';

const STUDENT_KEY = 'student_funnel.student_id';
const DEFAULT_USER_ID = 42;
const OTHER_USER_ID = 43;
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  (req as AuthenticatedRequest).userId = Number(req.header('x-test-user-id') ?? DEFAULT_USER_ID);
  next();
});
app.use('/api/renewal/actions', actionRouter);

let server: Server;
let baseUrl: string;

initRenewalDb();
initRenewalActions();
initRenewalActions(); // 建表入口必须可重复执行。

before(async () => {
  server = createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
});

afterEach(() => {
  mock.restoreAll();
});

beforeEach(() => {
  renewalDb.exec(`
    DELETE FROM renewal_risk_followup;
    DELETE FROM teacher_stats;
    DELETE FROM student_funnel;
    DELETE FROM renewal_report;
  `);
});

function insertReport(options: {
  fileName: string;
  status?: string;
  centerName?: string | null;
  uploadedBy?: number | null;
}): number {
  const result = renewalDb.prepare(`
    INSERT INTO renewal_report
      (file_name, file_size, stat_month, center_name, row_count, error_count, status, uploaded_by)
    VALUES (?, 100, '2026-11', ?, 1, 0, ?, ?)
  `).run(
    options.fileName,
    options.centerName === undefined ? '中心A' : options.centerName,
    options.status ?? 'committed',
    options.uploadedBy === undefined ? DEFAULT_USER_ID : options.uploadedBy,
  );
  return Number(result.lastInsertRowid);
}

function insertTeacher(reportId: number, options: {
  teacherName?: string | null;
  teacherNo?: string | null;
  baseCount?: number | null;
  prepaidCount?: number | null;
  prepaidRate?: number | null;
  renewedCount?: number | null;
  renewRate?: number | null;
  incentiveGap?: number | null;
  studentCount?: number | null;
  extra?: Record<string, number | null>;
  sourceRow?: number | null;
}): void {
  renewalDb.prepare(`
    INSERT INTO teacher_stats
      (report_id, tab, teacher_name, teacher_no, base_count, prepaid_count, prepaid_rate,
       renewed_count, renew_rate, incentive_gap, student_count, extra_json, source_row)
    VALUES (?, 'stage', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    reportId,
    options.teacherName ?? null,
    options.teacherNo ?? null,
    options.baseCount ?? null,
    options.prepaidCount ?? null,
    options.prepaidRate ?? null,
    options.renewedCount ?? null,
    options.renewRate ?? null,
    options.incentiveGap ?? null,
    options.studentCount ?? null,
    JSON.stringify(options.extra ?? {}),
    options.sourceRow ?? null,
  );
}

async function request(
  path: string,
  init?: RequestInit,
  userId = DEFAULT_USER_ID,
): Promise<{
  status: number;
  body: any;
}> {
  const headers = new Headers(init?.headers);
  headers.set('x-test-user-id', String(userId));
  const response = await fetch(`${baseUrl}${path}`, { ...(init ?? {}), headers });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

function put(path: string, body: unknown, userId = DEFAULT_USER_ID) {
  return request(path, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }, userId);
}

test('compare 限制同中心和已提交状态', async () => {
  const current = insertReport({ fileName: 'current.xlsx' });
  const otherCenter = insertReport({ fileName: 'other.xlsx', centerName: '中心B' });
  const draft = insertReport({ fileName: 'draft.xlsx', status: 'parsed' });

  const crossCenter = await request(
    `/api/renewal/actions/compare?reportId=${current}&compareReportId=${otherCenter}&tab=stage`,
  );
  assert.equal(crossCenter.status, 400);
  assert.match(crossCenter.body.error, /同一中心/);

  const uncommitted = await request(
    `/api/renewal/actions/compare?reportId=${current}&compareReportId=${draft}`,
  );
  assert.equal(uncommitted.status, 400);
  assert.match(uncommitted.body.error, /committed/);

  const missing = await request('/api/renewal/actions/compare?compareReportId=1');
  assert.equal(missing.status, 400);
  assert.match(missing.body.error, /reportId/);
});

test('compare 返回汇总和教师差值，NULL 不当作 0', async () => {
  const previous = insertReport({ fileName: 'previous.xlsx' });
  const current = insertReport({ fileName: 'current.xlsx', status: 'committed_with_warnings' });

  insertTeacher(previous, {
    teacherName: '教师甲', teacherNo: 'T01', baseCount: 100, prepaidCount: 50,
    prepaidRate: 50, renewedCount: 50, renewRate: 50, incentiveGap: 15,
    studentCount: 5, extra: { enrolledCount: 6 },
  });
  insertTeacher(previous, {
    teacherName: '教师乙', teacherNo: 'T02', baseCount: 80, prepaidCount: 40,
    prepaidRate: 50, renewedCount: 40, renewRate: 50, incentiveGap: 5,
    studentCount: 4, extra: { enrolledCount: 7 },
  });
  insertTeacher(current, {
    teacherName: '教师甲', teacherNo: 'T01', baseCount: 120, prepaidCount: null,
    prepaidRate: null, renewedCount: 72, renewRate: 60, incentiveGap: 20,
    studentCount: 6, extra: { enrolledCount: 8 },
  });
  insertTeacher(current, {
    teacherName: '教师乙', teacherNo: 'T02', baseCount: 80, prepaidCount: 32,
    prepaidRate: 40, renewedCount: 20, renewRate: 25, incentiveGap: 10,
    studentCount: 4, extra: { enrolledCount: 5 },
  });

  const response = await request(
    `/api/renewal/actions/compare?reportId=${current}&compareReportId=${previous}&tab=stage`,
  );
  assert.equal(response.status, 200);
  assert.equal(response.body.currentReport.reportId, current);
  assert.equal(response.body.previousReport.reportId, previous);
  assert.deepEqual(response.body.summary.baseCount, { current: 200, previous: 180, delta: 20 });
  assert.deepEqual(response.body.summary.prepaidCount, { current: null, previous: 90, delta: null });
  assert.deepEqual(response.body.summary.prepaidRate, { current: null, previous: 50, delta: null });
  assert.deepEqual(response.body.summary.renewedCount, { current: 92, previous: 90, delta: 2 });
  assert.deepEqual(response.body.summary.extra.enrolledCount, { current: 13, previous: 13, delta: 0 });

  const teacher = response.body.teachers.find((item: any) => item.teacherNo === 'T01');
  assert(teacher);
  assert.equal(teacher.current.prepaidCount, null);
  assert.equal(teacher.current.prepaidRate, null);
  assert.equal(teacher.previous.prepaidCount, 50);
  assert.equal(teacher.delta.prepaidCount, null);
  assert.equal(teacher.delta.prepaidRate, null);
  assert.deepEqual(teacher.delta.renewedCount, 22);
  assert.deepEqual(teacher.delta.extra.enrolledCount, 2);
});

test('compare 教师仅存在一侧时保留 NULL，并可用 source_row 稳定键', async () => {
  const previous = insertReport({ fileName: 'previous.xlsx' });
  const current = insertReport({ fileName: 'current.xlsx' });
  insertTeacher(previous, {
    teacherName: null, teacherNo: null, sourceRow: 88,
    baseCount: 5, prepaidCount: null, renewedCount: 2,
  });

  const response = await request(
    `/api/renewal/actions/compare?reportId=${current}&compareReportId=${previous}`,
  );
  assert.equal(response.status, 200);
  assert.equal(response.body.teachers.length, 1);
  const teacher = response.body.teachers[0];
  assert.equal(teacher.teacherKey, 'source_row:88');
  assert.equal(teacher.current, null);
  assert.equal(teacher.previous.baseCount, 5);
  assert.equal(teacher.previous.prepaidCount, null);
  assert.equal(teacher.delta.baseCount, null);
  assert.equal(teacher.delta.prepaidCount, null);
});

test('compare 没有工号时按源行保守匹配，不合并同名教师', async () => {
  const previous = insertReport({ fileName: 'previous.xlsx' });
  const current = insertReport({ fileName: 'current.xlsx' });
  insertTeacher(previous, { teacherName: '同名教师', sourceRow: 10, baseCount: 10 });
  insertTeacher(previous, { teacherName: '同名教师', sourceRow: 11, baseCount: 20 });
  insertTeacher(current, { teacherName: '同名教师', sourceRow: 10, baseCount: 25 });
  insertTeacher(current, { teacherName: '同名教师', sourceRow: 11, baseCount: 35 });

  const response = await request(
    `/api/renewal/actions/compare?reportId=${current}&compareReportId=${previous}&tab=stage`,
  );
  assert.equal(response.status, 200);
  assert.equal(response.body.teachers.length, 2);
  assert.deepEqual(response.body.summary.baseCount, { current: 60, previous: 30, delta: 30 });
  const first = response.body.teachers.find((item: any) => item.teacherKey === 'source_row:10');
  assert(first);
  assert.equal(first.previous.baseCount, 10);
  assert.equal(first.current.baseCount, 25);
  assert.equal(first.delta.baseCount, 15);
});

test('risk-followups upsert、稳定学生键、批次隔离和级联删除', async () => {
  const current = insertReport({ fileName: 'current.xlsx' });
  const other = insertReport({ fileName: 'other.xlsx' });
  renewalDb.prepare(`
    INSERT INTO student_funnel
      (report_id, student_id, student_name, source_row, renewed, class_last1)
    VALUES (?, ?, '学生甲', 7, 0, 0), (?, NULL, '学生乙', 17, 0, 0),
           (?, ?, '其他学生', 7, 0, 0)
  `).run(current, STUDENT_KEY, current, other, STUDENT_KEY);

  const created = await put(
    `/api/renewal/actions/risk-followups/${encodeURIComponent(STUDENT_KEY)}?reportId=${current}`,
    { owner: ' 王老师 ', followUpStatus: 'pending', nextFollowUpDate: '2026-12-01', outcome: '首次联系' },
  );
  assert.equal(created.status, 200);
  assert.equal(created.body.record.studentKey, STUDENT_KEY);
  assert.equal(created.body.record.owner, '王老师');
  assert.equal(created.body.record.updatedBy, 42);
  assert.equal(typeof created.body.record.createdAt, 'string');

  const updated = await put(
    `/api/renewal/actions/risk-followups/${encodeURIComponent(STUDENT_KEY)}?reportId=${current}`,
    { owner: '李老师', followUpStatus: 'contacted', nextFollowUpDate: null, outcome: null },
  );
  assert.equal(updated.status, 200);
  assert.equal(updated.body.record.followUpStatus, 'contacted');
  assert.equal(updated.body.record.nextFollowUpDate, null);
  assert.equal(updated.body.record.outcome, null);
  assert.equal(updated.body.record.createdAt, created.body.record.createdAt);

  const sourceRowRecord = await put(
    `/api/renewal/actions/risk-followups/source_row%3A17?reportId=${current}`,
    { owner: '王老师', followUpStatus: 'renewed', nextFollowUpDate: null, outcome: '已续费' },
  );
  assert.equal(sourceRowRecord.status, 200);
  assert.equal(sourceRowRecord.body.record.studentKey, 'source_row:17');

  const isolated = await put(
    `/api/renewal/actions/risk-followups/${encodeURIComponent(STUDENT_KEY)}?reportId=${other}`,
    { owner: '其他中心', followUpStatus: 'closed', nextFollowUpDate: null, outcome: null },
  );
  assert.equal(isolated.status, 200);

  const currentList = await request(`/api/renewal/actions/risk-followups?reportId=${current}`);
  const otherList = await request(`/api/renewal/actions/risk-followups?reportId=${other}`);
  assert.equal(currentList.status, 200);
  assert.equal(currentList.body.records.length, 2);
  assert.equal(otherList.body.records.length, 1);
  assert.equal(otherList.body.records[0].owner, '其他中心');

  renewalDb.prepare('DELETE FROM renewal_report WHERE id = ?').run(other);
  const remaining = renewalDb.prepare(
    'SELECT COUNT(*) AS count FROM renewal_risk_followup WHERE report_id = ?',
  ).get(other) as { count: number };
  assert.equal(remaining.count, 0);
});

test('risk-followups 只允许保存该批次真实待关注学生', async () => {
  const current = insertReport({ fileName: 'current.xlsx' });
  renewalDb.prepare(`
    INSERT INTO student_funnel
      (report_id, student_id, student_name, source_row, renewed, class_last1)
    VALUES (?, 'NOT-RISK', '已续费学生', 27, 1, 1)
  `).run(current);
  const body = { owner: '王老师', followUpStatus: 'contacted', nextFollowUpDate: null, outcome: null };
  for (const studentKey of ['UNKNOWN', 'NOT-RISK', 'source_row:999']) {
    const response = await put(
      `/api/renewal/actions/risk-followups/${encodeURIComponent(studentKey)}?reportId=${current}`,
      body,
    );
    assert.equal(response.status, 404);
    assert.match(response.body.error, /待关注清单/);
  }
  const count = renewalDb.prepare(
    'SELECT COUNT(*) AS count FROM renewal_risk_followup WHERE report_id = ?',
  ).get(current) as { count: number };
  assert.equal(count.count, 0);
});

test('risk-followups 校验字段、枚举、长度和真实日期', async () => {
  const current = insertReport({ fileName: 'current.xlsx' });
  const path = `/api/renewal/actions/risk-followups/${encodeURIComponent(STUDENT_KEY)}?reportId=${current}`;
  const invalidBodies: unknown[] = [
    { followUpStatus: 'pending' },
    { owner: '', followUpStatus: 'pending' },
    { owner: 'x'.repeat(81), followUpStatus: 'pending' },
    { owner: '王老师', followUpStatus: 'invalid' },
    { owner: '王老师', followUpStatus: 'pending', nextFollowUpDate: '2026-02-30' },
    { owner: '王老师', followUpStatus: 'pending', nextFollowUpDate: '12/01/2026' },
    { owner: '王老师', followUpStatus: 'pending', outcome: 'x'.repeat(2001) },
    [],
  ];
  for (const body of invalidBodies) {
    const response = await put(path, body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(typeof response.body.error, 'string');
  }
  const count = renewalDb.prepare(
    'SELECT COUNT(*) AS count FROM renewal_risk_followup WHERE report_id = ?',
  ).get(current) as { count: number };
  assert.equal(count.count, 0);
});

test('未知内部异常不会泄露 error.message', async t => {
  t.mock.method(log, 'error', () => {});
  t.mock.method(renewalDb, 'prepare', () => {
    throw new Error('sensitive database detail');
  });
  const response = await request('/api/renewal/actions/compare?reportId=1&compareReportId=2');
  assert.equal(response.status, 500);
  assert.deepEqual(response.body, { error: '获取续费批次对比失败' });
  assert(!JSON.stringify(response.body).includes('sensitive database detail'));
});

test('compare 两个批次均强制当前用户归属，非本人与不存在统一 404', async () => {
  const userACurrent = insertReport({ fileName: 'user-a-current.xlsx' });
  const userAPrevious = insertReport({ fileName: 'user-a-previous.xlsx' });
  const userBOwn = insertReport({ fileName: 'user-b-own.xlsx', uploadedBy: OTHER_USER_ID });
  const paths = [
    `/api/renewal/actions/compare?reportId=${userACurrent}&compareReportId=${userBOwn}&tab=stage`,
    `/api/renewal/actions/compare?reportId=${userBOwn}&compareReportId=${userAPrevious}&tab=stage`,
    `/api/renewal/actions/compare?reportId=${userBOwn}&compareReportId=999999&tab=stage`,
    `/api/renewal/actions/compare?reportId=999999&compareReportId=${userBOwn}&tab=stage`,
  ];

  const responses: unknown[] = [];
  for (const path of paths) {
    const response = await request(path, undefined, OTHER_USER_ID);
    assert.equal(response.status, 404);
    assert.deepEqual(response.body, { error: '报表批次不存在' });
    responses.push(response.body);
  }
  assert(responses.every(body => JSON.stringify(body) === JSON.stringify(responses[0])));
});

test('risk-followups 双用户读写隔离并保留 updatedBy 审计', async () => {
  const userAReport = insertReport({ fileName: 'user-a.xlsx' });
  const userBReport = insertReport({ fileName: 'user-b.xlsx', uploadedBy: OTHER_USER_ID });
  renewalDb.prepare(`
    INSERT INTO student_funnel
      (report_id, student_id, student_name, source_row, renewed, class_last1)
    VALUES (?, ?, '测试学生', 7, 0, 0), (?, ?, '测试学生', 7, 0, 0)
  `).run(userAReport, STUDENT_KEY, userBReport, STUDENT_KEY);

  const userAPath = `/api/renewal/actions/risk-followups/${encodeURIComponent(STUDENT_KEY)}?reportId=${userAReport}`;
  const userBPath = `/api/renewal/actions/risk-followups/${encodeURIComponent(STUDENT_KEY)}?reportId=${userBReport}`;
  const missingPath = `/api/renewal/actions/risk-followups/${encodeURIComponent(STUDENT_KEY)}?reportId=999999`;
  const created = await put(userAPath, {
    owner: 'user-a', followUpStatus: 'pending', nextFollowUpDate: null, outcome: 'original',
  });
  assert.equal(created.status, 200);
  assert.equal(created.body.record.updatedBy, DEFAULT_USER_ID);

  const foreignRead = await request(
    `/api/renewal/actions/risk-followups?reportId=${userAReport}`,
    undefined,
    OTHER_USER_ID,
  );
  const missingRead = await request(
    '/api/renewal/actions/risk-followups?reportId=999999',
    undefined,
    OTHER_USER_ID,
  );
  assert.equal(foreignRead.status, 404);
  assert.equal(missingRead.status, 404);
  assert.deepEqual(foreignRead.body, { error: '报表批次不存在' });
  assert.deepEqual(foreignRead.body, missingRead.body);

  const foreignWrite = await put(userAPath, {
    owner: 'user-b', followUpStatus: 'closed', nextFollowUpDate: null, outcome: 'overwritten',
  }, OTHER_USER_ID);
  const missingWrite = await put(missingPath, {
    owner: 'user-b', followUpStatus: 'closed', nextFollowUpDate: null, outcome: 'overwritten',
  }, OTHER_USER_ID);
  assert.equal(foreignWrite.status, 404);
  assert.equal(missingWrite.status, 404);
  assert.deepEqual(foreignWrite.body, { error: '报表批次不存在' });
  assert.deepEqual(foreignWrite.body, missingWrite.body);

  const unchanged = renewalDb.prepare(`
    SELECT owner, updated_by FROM renewal_risk_followup WHERE report_id = ? AND student_key = ?
  `).get(userAReport, STUDENT_KEY) as { owner: string; updated_by: number };
  assert.equal(unchanged.owner, 'user-a');
  assert.equal(unchanged.updated_by, DEFAULT_USER_ID);

  const ownWrite = await put(userBPath, {
    owner: 'user-b', followUpStatus: 'contacted', nextFollowUpDate: null, outcome: null,
  }, OTHER_USER_ID);
  assert.equal(ownWrite.status, 200);
  assert.equal(ownWrite.body.record.updatedBy, OTHER_USER_ID);

  const reverseRead = await request(
    `/api/renewal/actions/risk-followups?reportId=${userBReport}`,
    undefined,
    DEFAULT_USER_ID,
  );
  assert.equal(reverseRead.status, 404);
  assert.deepEqual(reverseRead.body, { error: '报表批次不存在' });
  const ownList = await request(
    `/api/renewal/actions/risk-followups?reportId=${userBReport}`,
    undefined,
    OTHER_USER_ID,
  );
  assert.equal(ownList.status, 200);
  assert.equal(ownList.body.records.length, 1);
  assert.equal(ownList.body.records[0].updatedBy, OTHER_USER_ID);
});
