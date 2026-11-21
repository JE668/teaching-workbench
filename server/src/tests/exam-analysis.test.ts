import './setup.js';
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createStudent,
  createUser,
  req,
  startServer,
  stopServer,
  tinyPngBuffer,
  userIdOf,
} from './helpers.js';
import { env } from '../config/env.js';
import { db } from '../config/database.js';

/**
 * Task-4 阶测接口专项回归。
 *
 * 图片通过真实 multipart 上传进入暂存区；视觉模型仅由受控 fetch 响应替代。
 * 这些用例验证 HTTP、模型请求构造和 SQLite 持久化，不代表真实视觉模型准确率验收。
 */

interface ExamAnalysisFixture {
  question_index: number;
  question_type: string;
  mistake_tags: string[];
  root_cause: string;
  review_actions: string[];
  confidence: number;
}

function questionAnalysis(
  questionIndex = 1,
  overrides: Partial<ExamAnalysisFixture> = {}
): ExamAnalysisFixture {
  return {
    question_index: questionIndex,
    question_type: '数学',
    mistake_tags: ['计算粗心:符号漏'],
    root_cause: '移项时遗漏负号，且完成后没有反向代入检查。',
    review_actions: ['订正本题并标注符号变化', '当天重做同类题3道并反向代入验算'],
    confidence: 0.91,
    ...overrides,
  };
}

function modelContent(analyses: ExamAnalysisFixture[] = [questionAnalysis()]): string {
  return JSON.stringify({ analyses });
}

const originalFetch = globalThis.fetch;
const originalAiKey = env.SENSENOVA_API_KEY;
let queuedModelContents: string[] = [];
let aiRequests: any[] = [];
let teacherToken = '';
let otherTeacherToken = '';
let teacherId = 0;
let otherTeacherId = 0;
let student: any;
let otherStudent: any;
let trendStudent: any;
let ownedImagePath = '';
let otherTeacherImagePath = '';

function pngForm(filename: string): FormData {
  const form = new FormData();
  form.append('images', new Blob([tinyPngBuffer()], { type: 'image/png' }), filename);
  return form;
}

function analyzeBody(examId: number, overrides: Record<string, any> = {}): Record<string, any> {
  return {
    studentId: student.id,
    examId,
    studentName: student.name,
    subject: student.subject,
    grade: student.grade,
    examName: 'Task-4 受控阶测',
    questionCount: 1,
    text: '',
    images: [],
    ...overrides,
  };
}

function insertDetail(options: {
  userId?: number;
  studentId?: number;
  examId: number;
  questionIndex: number;
  tags?: string[];
  rootCause?: string;
  reviewActions?: string[];
  createdAt: string;
}): void {
  db.prepare(
    `INSERT INTO exam_analysis_details
      (user_id, student_id, exam_id, question_index, question_type, mistake_tags,
       root_cause, review_actions, confidence, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    options.userId ?? teacherId,
    options.studentId ?? student.id,
    options.examId,
    options.questionIndex,
    '数学',
    JSON.stringify(options.tags ?? ['计算粗心:符号漏']),
    options.rootCause ?? '受控测试错因',
    JSON.stringify(options.reviewActions ?? ['重做同类题3道']),
    0.9,
    options.createdAt
  );
}

function persistedRows(examId: number, studentId = student.id): any[] {
  return db.prepare(
    `SELECT * FROM exam_analysis_details
     WHERE user_id = ? AND student_id = ? AND exam_id = ?
     ORDER BY question_index, id`
  ).all(teacherId, studentId, examId) as any[];
}

before(async () => {
  env.SENSENOVA_API_KEY = 'test-only-exam-analysis-key';

  // 客户端按用户缓存；用同一个长期包装器拦截 AI URL，避免缓存捕获单次 mock。
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const requestUrl = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
    if (!requestUrl.startsWith(env.SENSENOVA_BASE_URL)) {
      return originalFetch(input, init);
    }

    const rawBody = typeof init?.body === 'string'
      ? init.body
      : input instanceof Request
        ? await input.clone().text()
        : '';
    aiRequests.push(rawBody ? JSON.parse(rawBody) : {});
    const content = queuedModelContents.length > 1
      ? queuedModelContents.shift()!
      : queuedModelContents[0] ?? modelContent();

    return new Response(JSON.stringify({
      id: 'chatcmpl-exam-analysis-test',
      object: 'chat.completion',
      created: 1_700_000_000,
      model: 'controlled-exam-analysis-model',
      choices: [{
        index: 0,
        message: { role: 'assistant', content, refusal: null },
        finish_reason: 'stop',
        logprobs: null,
      }],
      usage: { prompt_tokens: 80, completion_tokens: 40, total_tokens: 120 },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  await startServer();
  teacherToken = await createUser('exam-analysis-teacher');
  otherTeacherToken = await createUser('exam-analysis-other-teacher');
  teacherId = userIdOf(teacherToken);
  otherTeacherId = userIdOf(otherTeacherToken);
  student = await createStudent(teacherToken, { name: '阶测学生甲' });
  otherStudent = await createStudent(otherTeacherToken, { name: '阶测学生乙' });
  trendStudent = await createStudent(teacherToken, { name: '阶测趋势学生' });

  const ownUpload = await req('POST', '/api/upload', {
    token: teacherToken,
    raw: pngForm('exam-owned.png'),
  });
  assert.equal(ownUpload.status, 200, JSON.stringify(ownUpload.body));
  ownedImagePath = ownUpload.body.paths[0];

  const otherUpload = await req('POST', '/api/upload', {
    token: otherTeacherToken,
    raw: pngForm('exam-other.png'),
  });
  assert.equal(otherUpload.status, 200, JSON.stringify(otherUpload.body));
  otherTeacherImagePath = otherUpload.body.paths[0];
});

beforeEach(() => {
  aiRequests = [];
  queuedModelContents = [modelContent()];
});

after(async () => {
  await stopServer();
  globalThis.fetch = originalFetch;
  env.SENSENOVA_API_KEY = originalAiKey;
});

describe('Task-4 阶测分析、查询与趋势', () => {
  test('真实上传图片应转换为受控多模态请求，并保留题目与 OCR 文本', async () => {
    const examId = 4101;
    const res = await req('POST', '/api/exam-analysis/analyze', {
      token: teacherToken,
      body: analyzeBody(examId, {
        text: '第1题：解方程 2x - 3 = 7；学生移项后得到 2x = 4。',
        images: [ownedImagePath],
      }),
    });

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.success, true);
    assert.equal(aiRequests.length, 1, '一次分析只应调用一次受控模型');
    const request = aiRequests[0];
    assert.equal(request.response_format?.json_schema?.strict, true);

    const userMessage = request.messages.find((message: any) => message.role === 'user');
    assert.ok(userMessage, '请求必须包含 user 消息');
    assert.ok(Array.isArray(userMessage.content), '有图片时 user.content 必须是多模态数组');
    const text = userMessage.content
      .filter((part: any) => part.type === 'text')
      .map((part: any) => part.text)
      .join('\n');
    assert.match(text, /第1题：解方程/);
    assert.match(text, /试题文本\/OCR结果/);

    const imageParts = userMessage.content.filter((part: any) => part.type === 'image_url');
    assert.equal(imageParts.length, 1, '上传图必须真正进入多模态请求');
    const imageUrl = imageParts[0]?.image_url?.url ?? '';
    assert.match(
      imageUrl,
      /^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/=]+$/,
      '模型收到的是可读取的图片 Data URL，而不是服务器暂存路径'
    );
    assert.ok(Buffer.from(imageUrl.split(',')[1] ?? '', 'base64').length > 0);
    assert.ok(!imageUrl.includes('_staging/'));
  });

  test('结构化错因与微计划按租户持久化，查询保留原试卷题数口径', async () => {
    const examId = 4102;
    const analyses = [
      questionAnalysis(1, {
        mistake_tags: ['计算粗心:符号漏', '审题失误:条件漏读'],
        root_cause: '移项符号错误，同时漏看了取值范围。',
        review_actions: ['订正第1题并圈出限制条件', '重做同类方程题3道'],
      }),
      questionAnalysis(2, {
        mistake_tags: ['概念不清:公式套用错误'],
        root_cause: '把等差数列求和公式误套到等比数列。',
        review_actions: ['对比默写两类求和公式', '完成公式辨析题4道并口述理由'],
        confidence: 0.86,
      }),
    ];
    queuedModelContents = [modelContent(analyses)];

    const analyzed = await req('POST', '/api/exam-analysis/analyze', {
      token: teacherToken,
      body: analyzeBody(examId, {
        questionCount: 3,
        text: '第1题方程，第2题数列，第3题未失分。',
      }),
    });
    assert.equal(analyzed.status, 200, JSON.stringify(analyzed.body));
    assert.deepEqual(analyzed.body.data.summary.tag_distribution, {
      计算粗心: 1,
      审题失误: 1,
      概念不清: 1,
    });
    assert.equal(analyzed.body.data.summary.total_questions, 3);
    assert.equal(analyzed.body.data.summary.analyzed_questions, 2);

    const rows = persistedRows(examId);
    assert.equal(rows.length, 2);
    assert.ok(rows.every(row => row.user_id === teacherId && row.student_id === student.id));
    assert.ok(rows.every(row => row.question_count === 3), '每条新明细都应同事务保存原试卷总题数');
    assert.deepEqual(JSON.parse(rows[0].mistake_tags), analyses[0].mistake_tags);
    assert.deepEqual(JSON.parse(rows[0].review_actions), analyses[0].review_actions);
    assert.equal(rows[0].root_cause, analyses[0].root_cause);
    assert.equal(rows[1].confidence, 0.86);

    const queried = await req('GET', `/api/exam-analysis/${student.id}/${examId}`, {
      token: teacherToken,
    });
    assert.equal(queried.status, 200, JSON.stringify(queried.body));
    assert.deepEqual(queried.body.data.analyses, analyses);
    assert.deepEqual(queried.body.data.summary.tag_distribution, analyzed.body.data.summary.tag_distribution);
    assert.equal(
      queried.body.data.summary.total_questions,
      3,
      '分析响应与查询响应必须保留同一份试卷的总题数，而非用已分析行数替代'
    );
    assert.equal(queried.body.data.summary.analyzed_questions, 2);
  });

  test('同一学生同一考试重复分析应替换旧结果，不追加重复题', async () => {
    const examId = 4103;
    const replacement = questionAnalysis(1, {
      root_cause: '复析后确认是通分时漏乘分子。',
      review_actions: ['重做错题并完成通分专项3题'],
    });
    queuedModelContents = [
      modelContent([questionAnalysis(1), questionAnalysis(2)]),
      modelContent([replacement]),
    ];
    const payload = analyzeBody(examId, {
      questionCount: 2,
      text: '分数运算阶测',
    });

    const first = await req('POST', '/api/exam-analysis/analyze', { token: teacherToken, body: payload });
    const second = await req('POST', '/api/exam-analysis/analyze', { token: teacherToken, body: payload });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(second.status, 200, JSON.stringify(second.body));

    const rows = persistedRows(examId);
    assert.equal(rows.length, 1, '重跑同一份试卷后只能保留最新的一组明细');
    assert.equal(rows[0].question_index, 1);
    assert.equal(rows[0].root_cause, replacement.root_cause);
    assert.deepEqual(JSON.parse(rows[0].review_actions), replacement.review_actions);
    assert.equal(rows[0].question_count, 2);
  });

  test('成功分析后的失败重跑不得清空或部分覆盖旧结果', async () => {
    const examId = 4109;
    const original = [questionAnalysis(1), questionAnalysis(2)];
    queuedModelContents = [modelContent(original), '{重跑结果不是 JSON'];
    const payload = analyzeBody(examId, { questionCount: 2, text: '失败重跑回归' });

    const first = await req('POST', '/api/exam-analysis/analyze', { token: teacherToken, body: payload });
    const second = await req('POST', '/api/exam-analysis/analyze', { token: teacherToken, body: payload });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.ok(second.status >= 500 && second.status <= 599, JSON.stringify(second.body));
    assert.equal(aiRequests.length, 2);

    const rows = persistedRows(examId);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map(row => row.question_index), [1, 2]);
    assert.ok(rows.every(row => row.question_count === 2));
    const queried = await req('GET', `/api/exam-analysis/${student.id}/${examId}`, { token: teacherToken });
    assert.equal(queried.status, 200);
    assert.deepEqual(queried.body.data.analyses, original);
    assert.equal(queried.body.data.summary.total_questions, 2);
  });

  test('模型返回非法 JSON 时返回服务端错误且不写入空成功结果', async () => {
    const examId = 4104;
    queuedModelContents = ['这不是 JSON'];

    const res = await req('POST', '/api/exam-analysis/analyze', {
      token: teacherToken,
      body: analyzeBody(examId, { text: '第1题' }),
    });

    assert.ok(
      res.status >= 500 && res.status <= 599,
      `非法模型结果不得返回 200 空分析，实际：${res.status} ${JSON.stringify(res.body)}`
    );
    assert.equal(persistedRows(examId).length, 0, '无效模型结果不得持久化');
  });

  test('模型 JSON 结构不符时返回服务端错误且不落库', async () => {
    const examId = 4105;
    queuedModelContents = [JSON.stringify({ analyses: { question_index: 1 } })];

    const res = await req('POST', '/api/exam-analysis/analyze', {
      token: teacherToken,
      body: analyzeBody(examId, { text: '第1题' }),
    });

    assert.ok(res.status >= 500 && res.status <= 599, JSON.stringify(res.body));
    assert.equal(persistedRows(examId).length, 0);
  });

  test('analyzeExam 抛出普通 Error 时路由仅记录日志且不泄露敏感细节', async (t) => {
    const examId = 4111;
    const sensitiveMessage = 'SQLITE_PRIVATE_TOKEN=exam-analysis-secret-do-not-expose';
    const originalPrepare = db.prepare.bind(db);
    t.mock.method(db, 'prepare', (sql: string) => {
      if (sql.includes('INSERT INTO exam_analysis_details')) {
        throw new Error(sensitiveMessage);
      }
      return originalPrepare(sql);
    });

    const res = await req('POST', '/api/exam-analysis/analyze', {
      token: teacherToken,
      body: analyzeBody(examId, { text: '第1题：触发受控持久化异常' }),
    });

    assert.equal(res.status, 500);
    assert.deepEqual(res.body, { error: '分析失败' });
    assert.equal(JSON.stringify(res.body).includes(sensitiveMessage), false);
    assert.equal(persistedRows(examId).length, 0, '普通内部错误不得留下部分分析结果');
  });

  test('模型编造白名单外错因标签时拒绝结果且不污染趋势数据', async () => {
    const examId = 4106;
    queuedModelContents = [modelContent([
      questionAnalysis(1, { mistake_tags: ['凭空捏造:幻觉标签'] }),
    ])];

    const res = await req('POST', '/api/exam-analysis/analyze', {
      token: teacherToken,
      body: analyzeBody(examId, { text: '第1题' }),
    });

    assert.ok(
      res.status >= 500 && res.status <= 599,
      `白名单外标签不得作为成功分析落库，实际：${res.status} ${JSON.stringify(res.body)}`
    );
    assert.equal(persistedRows(examId).length, 0);
  });

  test('教师之间按学生归属隔离分析、查询和趋势，越权分析不调用模型', async () => {
    const examId = 4107;
    insertDetail({ examId, questionIndex: 1, createdAt: '2026-04-01 09:00:00' });
    const payload = analyzeBody(4199, { text: '越权测试' });

    const otherAnalyze = await req('POST', '/api/exam-analysis/analyze', {
      token: otherTeacherToken,
      body: payload,
    });
    const ownAnalyzeOther = await req('POST', '/api/exam-analysis/analyze', {
      token: teacherToken,
      body: { ...payload, studentId: otherStudent.id },
    });
    assert.equal(otherAnalyze.status, 404);
    assert.equal(ownAnalyzeOther.status, 404);
    assert.equal(aiRequests.length, 0, '归属校验必须先于模型调用');

    assert.equal((await req('GET', `/api/exam-analysis/${student.id}/${examId}`, {
      token: otherTeacherToken,
    })).status, 404);
    assert.equal((await req('GET', `/api/exam-analysis/${otherStudent.id}/${examId}`, {
      token: teacherToken,
    })).status, 404);
    assert.equal((await req('GET', `/api/exam-analysis/student/${student.id}/trend`, {
      token: otherTeacherToken,
    })).status, 404);
    assert.equal((await req('GET', `/api/exam-analysis/student/${otherStudent.id}/trend`, {
      token: teacherToken,
    })).status, 404);

    assert.equal((await req('POST', '/api/exam-analysis/analyze', { body: payload })).status, 401);
    assert.equal((await req('GET', `/api/exam-analysis/${student.id}/${examId}`)).status, 401);
    assert.equal((await req('GET', `/api/exam-analysis/student/${student.id}/trend`)).status, 401);
  });

  test('其他教师的图片路径不得进入本教师的多模态请求', async () => {
    const examId = 4108;
    const res = await req('POST', '/api/exam-analysis/analyze', {
      token: teacherToken,
      body: analyzeBody(examId, {
        text: '只分析自己的题目文本',
        images: [otherTeacherImagePath],
      }),
    });

    assert.equal(res.status, 403, JSON.stringify(res.body));
    assert.equal(aiRequests.length, 0, '跨租户图片必须在模型调用前拒绝');
    assert.equal(persistedRows(examId).length, 0);
  });

  test('本租户任一图片不可读时整体失败，不调用模型也不落库', async () => {
    const examId = 4110;
    const missingImagePath = ownedImagePath + '.missing.png';
    const res = await req('POST', '/api/exam-analysis/analyze', {
      token: teacherToken,
      body: analyzeBody(examId, {
        text: '即使文本完整，也不能静默丢弃坏图后生成成功结果',
        images: [ownedImagePath, missingImagePath],
      }),
    });

    assert.ok(res.status >= 400 && res.status < 500, JSON.stringify(res.body));
    assert.equal(aiRequests.length, 0);
    assert.equal(persistedRows(examId).length, 0);
  });

  test('趋势 limit 按最近考试数截取，并保留每份试卷的完整标签分布', async () => {
    insertDetail({ studentId: trendStudent.id, examId: 4201, questionIndex: 1, tags: ['表达不规范:步骤跳跃'], createdAt: '2026-01-01 09:00:00' });

    insertDetail({ studentId: trendStudent.id, examId: 4202, questionIndex: 1, tags: ['技巧缺失:换元思维不到'], createdAt: '2026-02-01 09:00:01' });
    insertDetail({ studentId: trendStudent.id, examId: 4202, questionIndex: 2, tags: ['审题失误:条件漏读'], createdAt: '2026-02-01 09:00:02' });

    insertDetail({ studentId: trendStudent.id, examId: 4203, questionIndex: 1, tags: ['概念不清:公式套用错误'], createdAt: '2026-03-01 09:00:01' });
    insertDetail({ studentId: trendStudent.id, examId: 4203, questionIndex: 2, tags: ['计算粗心:符号漏'], createdAt: '2026-03-01 09:00:02' });
    insertDetail({ studentId: trendStudent.id, examId: 4203, questionIndex: 3, tags: ['计算粗心:运算失误'], createdAt: '2026-03-01 09:00:03' });

    insertDetail({
      userId: otherTeacherId,
      studentId: otherStudent.id,
      examId: 4299,
      questionIndex: 1,
      tags: ['时间管理:易题超时'],
      createdAt: '2026-04-01 09:00:00',
    });

    const res = await req('GET', `/api/exam-analysis/student/${trendStudent.id}/trend?limit=2`, {
      token: teacherToken,
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.success, true);
    assert.deepEqual(
      res.body.data.map((exam: any) => exam.exam_id),
      [4203, 4202],
      'limit=2 应返回最近两次考试，而不是最近两条题目明细'
    );
    assert.deepEqual(res.body.data[0].tag_distribution, { 概念不清: 1, 计算粗心: 2 });
    assert.deepEqual(res.body.data[1].tag_distribution, { 技巧缺失: 1, 审题失误: 1 });
    assert.equal(res.body.data[0].date, '2026-03-01 09:00:03');
    assert.ok(!res.body.data.some((exam: any) => exam.exam_id === 4201 || exam.exam_id === 4299));
  });
});
