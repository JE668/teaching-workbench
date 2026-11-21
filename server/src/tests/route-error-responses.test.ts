import './setup.js';
import { after, before, describe, test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { db } from '../config/database.js';
import { log } from '../utils/logger.js';
import { createUser, req, startServer, stopServer } from './helpers.js';

let token = '';

before(async () => {
  await startServer();
  token = await createUser('route-error-response-owner');
});

after(async () => {
  await stopServer();
});

interface InternalErrorCase {
  method: string;
  path: string;
  sqlMarker: string;
  publicMessage: string;
  body?: unknown;
  internalMessage: string;
  privateDetails: string[];
}

async function assertSanitizedInternalError(t: TestContext, testCase: InternalErrorCase): Promise<void> {
  const internalError = new Error(testCase.internalMessage);
  const originalPrepare = db.prepare.bind(db);
  t.mock.method(db, 'prepare', (source: string) => {
    if (source.includes(testCase.sqlMarker)) throw internalError;
    return originalPrepare(source);
  });
  const errorLog = t.mock.method(log, 'error', () => undefined);

  const response = await req(testCase.method, testCase.path, { token, body: testCase.body });

  assert.equal(response.status, 500);
  assert.deepEqual(response.body, { error: testCase.publicMessage });
  const serialized = JSON.stringify(response.body);
  assert.ok(!serialized.includes('message'), '响应不应包含内部 message 字段');
  for (const detail of testCase.privateDetails) {
    assert.ok(!serialized.includes(detail), `响应泄露了内部细节：${detail}`);
  }

  assert.equal(errorLog.mock.callCount(), 1, '未知异常必须记录服务端日志');
  const logPayload = errorLog.mock.calls[0]?.arguments[0] as { err?: unknown };
  assert.equal(logPayload.err, internalError, '日志必须保留原始异常对象');
}

describe('路由内部错误响应脱敏', () => {
  test('reports 列表不泄露 SQL、表名和数据库路径', async (t) => {
    await assertSanitizedInternalError(t, {
      method: 'GET',
      path: '/api/reports',
      sqlMarker: 'FROM monthly_reports r',
      publicMessage: '获取月度报告失败',
      internalMessage: 'SQLITE_ERROR: no such table: monthly_reports; SELECT secret_columns FROM monthly_reports; /private/server/teaching.sqlite',
      privateDetails: ['SQLITE_ERROR', 'secret_columns', 'monthly_reports', '/private/server'],
    });
  });

  test('Excel 模板列表不泄露工作表名、包内路径和模板文件路径', async (t) => {
    await assertSanitizedInternalError(t, {
      method: 'GET',
      path: '/api/reports/excel-templates',
      sqlMarker: 'FROM excel_templates',
      publicMessage: '获取模板列表失败',
      internalMessage: 'Failed to read worksheet "内部薪酬" from xl/worksheets/sheet1.xml in /private/templates/secret.xlsx',
      privateDetails: ['内部薪酬', 'xl/worksheets', '/private/templates', 'secret.xlsx'],
    });
  });

  test('teaching-review summary 不泄露 SQL 与内部路径', async (t) => {
    await assertSanitizedInternalError(t, {
      method: 'GET',
      path: '/api/teaching-review/summary?month=2026-10',
      sqlMarker: 'FROM followups',
      publicMessage: '获取复盘总览失败',
      internalMessage: 'SQLITE_BUSY: SELECT private_metric FROM followups; database /var/lib/teaching/private.sqlite',
      privateDetails: ['SQLITE_BUSY', 'private_metric', 'followups', '/var/lib/teaching'],
    });
  });

  test('teaching-review students 不泄露 SQL 与内部路径', async (t) => {
    await assertSanitizedInternalError(t, {
      method: 'GET',
      path: '/api/teaching-review/students?month=2026-10',
      sqlMarker: 'FROM students s',
      publicMessage: '获取学生覆盖度失败',
      internalMessage: 'SQLITE_CORRUPT: SELECT private_student_data FROM students; /opt/internal/review.sqlite',
      privateDetails: ['SQLITE_CORRUPT', 'private_student_data', 'students', '/opt/internal'],
    });
  });

  test('teaching-review trend 不泄露 SQL 与内部路径', async (t) => {
    await assertSanitizedInternalError(t, {
      method: 'GET',
      path: '/api/teaching-review/trend?months=2&endMonth=2026-10',
      sqlMarker: 'FROM followups WHERE user_id',
      publicMessage: '获取产出趋势失败',
      internalMessage: 'SQLITE_MISMATCH: SELECT private_trend FROM followups; /srv/internal/trend.sqlite',
      privateDetails: ['SQLITE_MISMATCH', 'private_trend', 'followups', '/srv/internal'],
    });
  });

  test('ExcelTemplateInspectError 保留已有业务状态码和公开消息', async (t) => {
    const errorLog = t.mock.method(log, 'error', () => undefined);
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Report');
    const fileBase64 = Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64');

    const response = await req('POST', '/api/reports/excel-templates/inspect', {
      token,
      body: { fileBase64, sheetName: '教师指定工作表' },
    });

    assert.equal(response.status, 400);
    assert.deepEqual(response.body, { error: '未找到工作表：教师指定工作表' });
    assert.equal(errorLog.mock.callCount(), 0, '预期业务输入错误不应记为内部服务器错误');
  });

  test('content reference 同步不泄露 SQL、工作表和内部路径', async (t) => {
    await assertSanitizedInternalError(t, {
      method: 'POST',
      path: '/api/content/references/1/sync',
      body: { targetField: 'summary_intro', sourceField: 'report' },
      sqlMarker: 'SELECT * FROM content_references',
      publicMessage: '同步引用内容失败',
      internalMessage: 'SQLITE_ERROR: SELECT private_payload FROM content_references; worksheet "内部同步"; /private/content.sqlite',
      privateDetails: ['SQLITE_ERROR', 'private_payload', 'content_references', '内部同步', '/private/content.sqlite'],
    });
  });

  test('knowledge 创建教研组不泄露 SQL、内部字段和数据库路径', async (t) => {
    await assertSanitizedInternalError(t, {
      method: 'POST',
      path: '/api/knowledge/groups',
      body: { name: '异常脱敏教研组', subjectGroup: '数学' },
      sqlMarker: 'INSERT INTO knowledge_groups',
      publicMessage: '创建教研组失败',
      internalMessage: 'SQLITE_CONSTRAINT: join_code_hash in knowledge_groups; /private/knowledge.sqlite',
      privateDetails: ['SQLITE_CONSTRAINT', 'join_code_hash', 'knowledge_groups', '/private/knowledge.sqlite'],
    });
  });

  test('lesson planner 列表不泄露 SQL 和数据库路径', async (t) => {
    await assertSanitizedInternalError(t, {
      method: 'GET',
      path: '/api/lesson-plans',
      sqlMarker: 'FROM lesson_plans lp WHERE',
      publicMessage: '获取教案列表失败',
      internalMessage: 'SQLITE_ERROR: private_plan_column FROM lesson_plans lp; /private/lesson-list.sqlite',
      privateDetails: ['SQLITE_ERROR', 'private_plan_column', 'lesson_plans', '/private/lesson-list.sqlite'],
    });
  });

  test('lesson planner 生成未知异常不泄露 schema、SQL 和内部路径', async (t) => {
    await assertSanitizedInternalError(t, {
      method: 'POST',
      path: '/api/lesson-plans/generate',
      body: {},
      sqlMarker: 'FROM sqlite_master',
      publicMessage: '生成教案失败',
      internalMessage: 'SQLITE_BUSY: secret_schema FROM sqlite_master; worksheet "私有教案"; /private/lesson-generate.sqlite',
      privateDetails: ['SQLITE_BUSY', 'secret_schema', 'sqlite_master', '私有教案', '/private/lesson-generate.sqlite'],
    });
  });

  test('parent view 不泄露 token 字段、SQL 和数据库路径', async (t) => {
    await assertSanitizedInternalError(t, {
      method: 'GET',
      path: '/api/parent-view/internal-error-token',
      sqlMarker: 'FROM parent_views pv',
      publicMessage: 'Failed to get parent view',
      internalMessage: 'SQLITE_CORRUPT: access_token in parent_views; /private/parent.sqlite',
      privateDetails: ['SQLITE_CORRUPT', 'access_token', 'parent_views', '/private/parent.sqlite'],
    });
  });

  test('student profile 列表不泄露 SQL 和内部路径', async (t) => {
    await assertSanitizedInternalError(t, {
      method: 'GET',
      path: '/api/student-profiles',
      sqlMarker: 'FROM student_profiles sp',
      publicMessage: '获取学生画像列表失败',
      internalMessage: 'SQLITE_ERROR: private_profile_json FROM student_profiles sp; /private/profile.sqlite',
      privateDetails: ['SQLITE_ERROR', 'private_profile_json', 'student_profiles', '/private/profile.sqlite'],
    });
  });

  test('unified drafts 列表不泄露 SQL 和内部路径', async (t) => {
    await assertSanitizedInternalError(t, {
      method: 'GET',
      path: '/api/unified-drafts',
      sqlMarker: 'SELECT * FROM unified_drafts',
      publicMessage: '获取草稿列表失败',
      internalMessage: 'SQLITE_ERROR: private_content_json FROM unified_drafts; /private/drafts.sqlite',
      privateDetails: ['SQLITE_ERROR', 'private_content_json', 'unified_drafts', '/private/drafts.sqlite'],
    });
  });

  test('ReferenceSyncError 保留公开业务状态码和消息', async (t) => {
    const errorLog = t.mock.method(log, 'error', () => undefined);
    const response = await req('POST', '/api/content/references/1/sync', {
      token,
      body: { targetField: 'invalid_field', sourceField: 'report' },
    });
    assert.equal(response.status, 400);
    assert.deepEqual(response.body, { error: '同步字段无效' });
    assert.equal(errorLog.mock.callCount(), 0);
  });

  test('KnowledgeError 保留公开业务状态码和消息', async (t) => {
    const errorLog = t.mock.method(log, 'error', () => undefined);
    const response = await req('GET', '/api/knowledge/groups/not-a-number/members', { token });
    assert.equal(response.status, 400);
    assert.deepEqual(response.body, { error: 'groupId 必须是正整数' });
    assert.equal(errorLog.mock.callCount(), 1, '保留原有业务错误服务端日志');
  });

  test('LessonPlannerInputError 保留公开业务状态码和消息', async (t) => {
    const errorLog = t.mock.method(log, 'error', () => undefined);
    const response = await req('POST', '/api/lesson-plans/generate', {
      token,
      body: { studentId: 999999 },
    });
    assert.equal(response.status, 404);
    assert.deepEqual(response.body, { error: '学生不存在或不属于当前账号' });
    assert.equal(errorLog.mock.callCount(), 0);
  });
});
