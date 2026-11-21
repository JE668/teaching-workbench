import assert from 'node:assert/strict';
import { after, before, mock, test } from 'node:test';
import './setup.js';
import { db, initDatabase } from '../config/database.js';
import { env } from '../config/env.js';
import { createStudent, createUser, req, startServer, stopServer, userIdOf } from './helpers.js';
import {
  KNOWLEDGE_EXTRACTION_SCHEMA,
  buildKnowledgeExtractionPrompt,
  extractKnowledgePoints,
  getKnowledgeRadar,
  getWeakPoints,
  recommendRemedialExercises,
  upsertKnowledgePoints,
} from '../services/knowledge/graph.js';

env.SENSENOVA_API_KEY = 'test-only-ai-key';
const originalFetch = globalThis.fetch;

let activeChatRequests: any[] = [];
let chatResponder: (() => Response) | null = null;

before(async () => {
  await initDatabase();
  await startServer();
  // OpenAI 客户端会缓存首次传入的 fetch；使用稳定分发器，避免匿名 userId=0 跨用例固化首个响应。
  mock.method(globalThis, 'fetch', async (input: any, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith(env.SENSENOVA_BASE_URL)) return originalFetch(input, init);
    assert.ok(url.includes('/chat/completions'));
    activeChatRequests.push(JSON.parse(String(init?.body)));
    if (!chatResponder) throw new Error('缺少知识点聊天响应夹具');
    return chatResponder();
  });
});
after(async () => {
  await stopServer();
  mock.restoreAll();
});

function mockChat(_t: any, content: string, requests: any[] = []) {
  activeChatRequests = requests;
  chatResponder = () => Response.json({
    id: 'knowledge-chat-test', object: 'chat.completion', created: 1, model: 'test-chat',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
  });
  return requests;
}

function insertPoint(
  userId: number,
  studentId: number,
  name: string,
  category: string,
  mastery: number,
  evidenceCount = 1,
  subject = '数学',
) {
  return Number(db.prepare(`INSERT INTO knowledge_points
    (user_id, student_id, subject, grade, point_name, point_category, mastery_level, evidence_count)
    VALUES (?, ?, ?, '五年级', ?, ?, ?, ?)`)
    .run(userId, studentId, subject, name, category, mastery, evidenceCount).lastInsertRowid);
}

function insertCourse(userId: number, content: string, band: string, track: string, seq: number, subject = '数学') {
  return Number(db.prepare(`INSERT INTO course_catalog
    (user_id, band, term, grade, subject, track, seq, content)
    VALUES (?, ?, '上学期', '五年级', ?, ?, ?, ?)`)
    .run(userId, band, subject, track, seq, content).lastInsertRowid);
}

test('知识点抽取 prompt 包含学生、材料、图片与结构化约束，缺省材料不伪造内容', () => {
  const prompt = buildKnowledgeExtractionPrompt({
    text: '第3题通分正确，但约分遗漏公因数。',
    images: ['data:image/png;base64,AA', 'data:image/png;base64,BB'],
    studentName: '李小明', subject: '数学', grade: '五年级', context: '十月月报与订正试卷',
  });
  assert.match(prompt, /专业的数学学科教研员/);
  assert.match(prompt, /十月月报与订正试卷/);
  assert.match(prompt, /李小明（五年级，数学）/);
  assert.match(prompt, /【文本内容】\n第3题通分正确/);
  assert.match(prompt, /【上传图片】共 2 张/);
  for (const category of ['concept', 'skill', 'method', 'habit']) assert.ok(prompt.includes(category));
  assert.match(prompt, /同一知识点在多处出现只输出一次/);
  assert.match(prompt, /最多输出 20 个知识点，按置信度降序/);

  const empty = buildKnowledgeExtractionPrompt({ studentName: '王芳', subject: '语文', grade: '四年级' });
  assert.match(empty, /请从教学材料中为学生 王芳/);
  assert.equal(empty.includes('【文本内容】'), false);
  assert.equal(empty.includes('【上传图片】'), false);
});

test('AI 成功抽取时发送严格 schema 和多模态内容，并返回模型知识点及学生上下文', async (t) => {
  const point = {
    point_name: '分数通分', point_category: 'skill', evidence: '第3题通分正确',
    confidence: 0.93, mastery_delta: 0.2,
  };
  const requests = mockChat(t, '  ' + JSON.stringify({ points: [point] }) + '\n');
  const result = await extractKnowledgePoints({
    text: '第3题通分正确', images: ['image-A', 'image-B'],
    studentName: '李小明', subject: '数学', grade: '五年级', context: '订正试卷',
  });
  assert.deepEqual(result, { points: [point], student_id: 0, subject: '数学', grade: '五年级' });
  assert.equal(requests.length, 1);
  const request = requests[0];
  assert.equal(request.temperature, 0.2);
  assert.equal(request.max_tokens, 3000);
  assert.equal(request.response_format.type, 'json_schema');
  assert.equal(request.response_format.json_schema.name, 'knowledge_extraction');
  assert.equal(request.response_format.json_schema.strict, true);
  assert.deepEqual(request.response_format.json_schema.schema, KNOWLEDGE_EXTRACTION_SCHEMA);
  assert.match(request.messages[0].content, /只输出 JSON/);
  const content = request.messages[1].content;
  assert.equal(content[0].type, 'text');
  assert.match(content[0].text, /第3题通分正确/);
  assert.deepEqual(content.slice(1), [
    { type: 'image_url', image_url: { url: 'image-A' } },
    { type: 'image_url', image_url: { url: 'image-B' } },
  ]);
});

test('AI 返回坏 JSON 时抽取结果为空且保留学科年级，不抛出解析异常', async (t) => {
  const requests = mockChat(t, '不是合法 JSON');
  const result = await extractKnowledgePoints({ studentName: '李小明', subject: '英语', grade: '六年级' });
  assert.deepEqual(result, { points: [], student_id: 0, subject: '英语', grade: '六年级' });
  assert.equal(requests[0].messages[1].content.length, 1);
});

test('AI 请求失败时保留上游错误并向调用方抛出', async () => {
  activeChatRequests = [];
  chatResponder = () => Response.json(
    { error: { message: 'knowledge upstream rejected', type: 'invalid_request_error' } },
    { status: 400 },
  );
  await assert.rejects(
    extractKnowledgePoints({ studentName: '李小明', subject: '数学', grade: '五年级' }),
    /knowledge upstream rejected/,
  );
});

test('mastery upsert 过滤低置信度、限制上下限、累计证据并维护新旧报告关联', async () => {
  const teacher = await createUser('graph-upsert-owner');
  const userId = userIdOf(teacher);
  const student = await createStudent(teacher, { name: '掌握度学生' });
  const first = await upsertKnowledgePoints(userId, student.id, '数学', '五年级', [
    { point_name: '分数通分', point_category: 'skill', evidence: '首次证据', confidence: 0.95, mastery_delta: 2 },
    { point_name: '审题习惯', point_category: 'habit', evidence: '边界置信度也保留', confidence: 0.6 },
    { point_name: '低置信噪声', point_category: 'concept', evidence: '不应入库', confidence: 0.59, mastery_delta: 1 },
  ]);
  assert.deepEqual(first, { created: 2, updated: 0 });
  let high = db.prepare('SELECT * FROM knowledge_points WHERE user_id = ? AND point_name = ?').get(userId, '分数通分') as any;
  assert.equal(high.mastery_level, 1);
  assert.equal(high.evidence_count, 1);
  assert.equal(high.grade, '五年级');
  const highId = high.id as number;
  const boundary = db.prepare('SELECT mastery_level, evidence_count FROM knowledge_points WHERE user_id = ? AND point_name = ?')
    .get(userId, '审题习惯') as any;
  assert.deepEqual(boundary, { mastery_level: 0, evidence_count: 1 });
  assert.equal((db.prepare('SELECT COUNT(*) AS count FROM knowledge_points WHERE user_id = ?').get(userId) as { count: number }).count, 2);
  assert.equal((db.prepare('SELECT COUNT(*) AS count FROM report_knowledge_points WHERE point_id = ?').get(highId) as { count: number }).count, 0);

  const second = await upsertKnowledgePoints(userId, student.id, '数学', '五年级', [
    { point_name: '分数通分', point_category: 'skill', evidence: '第二次暴露薄弱', confidence: 0.9, mastery_delta: -2 },
    { point_name: '计算检查', point_category: 'habit', evidence: '主动复查', confidence: 0.9, mastery_delta: 0.3 },
  ], 501);
  assert.deepEqual(second, { created: 1, updated: 1 });
  high = db.prepare('SELECT * FROM knowledge_points WHERE id = ?').get(highId) as any;
  assert.equal(high.mastery_level, 0);
  assert.equal(high.evidence_count, 2);
  assert.match(high.last_seen_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  const links = db.prepare(`SELECT report_id, point_id, delta, evidence FROM report_knowledge_points
    WHERE report_id = 501 ORDER BY point_id`).all() as any[];
  assert.equal(links.length, 2);
  const highLink = links.find(link => link.point_id === highId);
  assert.deepEqual(highLink, { report_id: 501, point_id: highId, delta: -2, evidence: '第二次暴露薄弱' });

  const third = await upsertKnowledgePoints(userId, student.id, '数学', '五年级', [
    { point_name: '分数通分', point_category: 'skill', evidence: '第三次有所进步', confidence: 0.9, mastery_delta: 0.25 },
  ], 502);
  assert.deepEqual(third, { created: 0, updated: 1 });
  high = db.prepare('SELECT mastery_level, evidence_count FROM knowledge_points WHERE id = ?').get(highId) as any;
  assert.deepEqual(high, { mastery_level: 0.25, evidence_count: 3 });
  const latestLink = db.prepare('SELECT delta, evidence FROM report_knowledge_points WHERE report_id = 502 AND point_id = ?')
    .get(highId) as any;
  assert.deepEqual(latestLink, { delta: 0.25, evidence: '第三次有所进步' });
});

test('知识雷达每类只保留掌握度 Top8，薄弱点按程度和证据数排序并过滤零证据', async () => {
  const teacher = await createUser('graph-radar-owner');
  const userId = userIdOf(teacher);
  const student = await createStudent(teacher, { name: '雷达学生' });
  for (let i = 1; i <= 9; i++) insertPoint(userId, student.id, `概念${i}`, 'concept', i / 10);
  insertPoint(userId, student.id, '计算技能', 'skill', 0.7);
  insertPoint(userId, student.id, '错题归纳', 'method', 0.6);
  insertPoint(userId, student.id, '书写规范', 'habit', 0.8);
  insertPoint(userId, student.id, '历史遗留类别', 'legacy', 0.99);

  const radar = await getKnowledgeRadar(userId, student.id, '数学');
  assert.deepEqual(radar.concept.map(point => point.name), ['概念9', '概念8', '概念7', '概念6', '概念5', '概念4', '概念3', '概念2']);
  assert.equal(radar.concept[0].mastery, 0.9);
  assert.equal(radar.concept.some(point => point.name === '概念1'), false);
  assert.deepEqual(radar.skill, [{ name: '计算技能', mastery: 0.7 }]);
  assert.deepEqual(radar.method, [{ name: '错题归纳', mastery: 0.6 }]);
  assert.deepEqual(radar.habit, [{ name: '书写规范', mastery: 0.8 }]);

  const weakStudent = await createStudent(teacher, { name: '薄弱点学生' });
  insertPoint(userId, weakStudent.id, '同分证据较少', 'concept', 0.2, 3);
  insertPoint(userId, weakStudent.id, '同分证据较多', 'concept', 0.2, 5);
  insertPoint(userId, weakStudent.id, '最薄弱', 'skill', 0.05, 2);
  insertPoint(userId, weakStudent.id, '零证据不列入', 'skill', 0.01, 0);
  insertPoint(userId, weakStudent.id, '其他学科不混入', 'skill', 0.01, 9, '语文');
  const weakest = await getWeakPoints(userId, weakStudent.id, '数学', 2);
  assert.deepEqual(weakest.map(point => point.point_name), ['最薄弱', '同分证据较多']);
  assert.deepEqual(weakest.map(point => point.evidence_count), [2, 5]);
  assert.equal(weakest.every(point => point.evidence_count > 0), true);
});

test('补缺推荐匹配内容、band、track，跨薄弱点去重并遵守 limit 与租户学科边界', async () => {
  const teacher = await createUser('graph-remedial-owner');
  const other = await createUser('graph-remedial-other');
  const userId = userIdOf(teacher);
  const student = await createStudent(teacher, { name: '推荐学生' });
  insertPoint(userId, student.id, '通分', 'skill', 0.1);
  insertPoint(userId, student.id, '约分', 'skill', 0.2);
  insertPoint(userId, student.id, '分数', 'concept', 0.3);
  const courseA = insertCourse(userId, '通分与约分综合练习', '基础', '分数提升', 1);
  const courseB = insertCourse(userId, '专项练习', '约分训练', '', 2);
  const courseC = insertCourse(userId, '综合练习', '', '分数提升', 3);
  insertCourse(userIdOf(other), '通分与约分综合练习', '约分训练', '分数提升', 1);
  insertCourse(userId, '通分与约分综合练习', '约分训练', '分数提升', 1, '语文');

  const all = await recommendRemedialExercises(userId, student.id, '数学');
  assert.deepEqual(all.map(course => course.id), [courseA, courseB, courseC]);
  assert.equal(new Set(all.map(course => course.id)).size, all.length);
  const limited = await recommendRemedialExercises(userId, student.id, '数学', 2);
  assert.deepEqual(limited.map(course => course.id), [courseA, courseB]);
  const emptyStudent = await createStudent(teacher, { name: '无薄弱点学生' });
  assert.deepEqual(await recommendRemedialExercises(userId, emptyStudent.id, '数学'), []);
});

test('知识抽取 API 校验参数和学生归属，返回真实 student_id 并脱敏上游失败', async (t) => {
  const teacher = await createUser('graph-route-extract-owner');
  const student = await createStudent(teacher, { name: '接口抽取学生' });
  const point = {
    point_name: '分数约分', point_category: 'skill', evidence: '约分步骤完整',
    confidence: 0.91, mastery_delta: 0.15,
  };
  const requests = mockChat(t, JSON.stringify({ points: [point] }));
  const payload = {
    reportId: 901, text: '本次约分步骤完整', images: ['route-image'], context: '接口回归',
    studentName: student.name, subject: '数学', grade: '五年级',
  };

  const invalid = await req('POST', '/api/knowledge/extract', { token: teacher, body: {} });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error, '参数错误');
  assert.ok(invalid.body.details.fieldErrors.studentName);
  const missing = await req('POST', '/api/knowledge/extract', {
    token: teacher, body: { ...payload, studentName: '不存在的学生' },
  });
  assert.deepEqual({ status: missing.status, body: missing.body }, { status: 404, body: { error: '学生不存在' } });
  assert.equal(requests.length, 0);

  const success = await req('POST', '/api/knowledge/extract', { token: teacher, body: payload });
  assert.equal(success.status, 200);
  assert.deepEqual(success.body, { points: [point], student_id: student.id, subject: '数学', grade: '五年级' });
  assert.equal(requests.length, 1);
  assert.match(requests[0].messages[1].content[0].text, /接口回归/);
  assert.deepEqual(requests[0].messages[1].content[1], { type: 'image_url', image_url: { url: 'route-image' } });

  chatResponder = () => Response.json(
    { error: { message: 'route upstream secret', type: 'invalid_request_error' } },
    { status: 400 },
  );
  const failed = await req('POST', '/api/knowledge/extract', { token: teacher, body: payload });
  assert.deepEqual({ status: failed.status, body: failed.body }, {
    status: 500, body: { error: '知识点抽取失败，请稍后重试' },
  });
  assert.equal(JSON.stringify(failed.body).includes('route upstream secret'), false);
});

test('知识保存 API 校验归属，持久化新增/更新及报告关联并处理坏条目', async () => {
  const teacher = await createUser('graph-route-save-owner');
  const other = await createUser('graph-route-save-other');
  const userId = userIdOf(teacher);
  const student = await createStudent(teacher, { name: '接口保存学生' });
  const otherStudent = await createStudent(other, { name: '他人保存学生' });
  const point = {
    point_name: '单位换算', point_category: 'concept', evidence: '首次换算正确',
    confidence: 0.9, mastery_delta: 0.1,
  };

  const invalid = await req('POST', '/api/knowledge/save', { token: teacher, body: {} });
  assert.deepEqual({ status: invalid.status, body: invalid.body }, { status: 400, body: { error: '参数错误' } });
  const forbidden = await req('POST', '/api/knowledge/save', {
    token: teacher,
    body: { studentId: otherStudent.id, subject: '数学', grade: '五年级', points: [] },
  });
  assert.deepEqual({ status: forbidden.status, body: forbidden.body }, { status: 404, body: { error: '学生不存在' } });

  const created = await req('POST', '/api/knowledge/save', {
    token: teacher,
    body: { reportId: 902, studentId: student.id, subject: '数学', grade: '五年级', points: [point] },
  });
  assert.deepEqual({ status: created.status, body: created.body }, {
    status: 200, body: { created: 1, updated: 0 },
  });
  const updated = await req('POST', '/api/knowledge/save', {
    token: teacher,
    body: {
      reportId: 903, studentId: student.id, subject: '数学', grade: '五年级',
      points: [{ ...point, evidence: '再次换算有进步', mastery_delta: 0.2 }],
    },
  });
  assert.deepEqual({ status: updated.status, body: updated.body }, {
    status: 200, body: { created: 0, updated: 1 },
  });
  const saved = db.prepare(`SELECT id, mastery_level, evidence_count FROM knowledge_points
    WHERE user_id = ? AND student_id = ? AND point_name = '单位换算'`).get(userId, student.id) as any;
  assert.ok(Math.abs(saved.mastery_level - 0.3) < 1e-10);
  assert.equal(saved.evidence_count, 2);
  const reportLinks = db.prepare(`SELECT report_id, evidence FROM report_knowledge_points
    WHERE point_id = ? ORDER BY report_id`).all(saved.id);
  assert.deepEqual(reportLinks, [
    { report_id: 902, evidence: '首次换算正确' },
    { report_id: 903, evidence: '再次换算有进步' },
  ]);

  const malformed = await req('POST', '/api/knowledge/save', {
    token: teacher,
    body: { studentId: student.id, subject: '数学', grade: '五年级', points: [null] },
  });
  assert.deepEqual({ status: malformed.status, body: malformed.body }, {
    status: 500, body: { error: '知识点保存失败' },
  });
  assert.equal((db.prepare('SELECT COUNT(*) AS count FROM knowledge_points WHERE user_id = ?')
    .get(userId) as { count: number }).count, 1);
});

test('雷达、薄弱点和补缺 API 返回服务结果，并拒绝非法编号与跨学生访问', async () => {
  const teacher = await createUser('graph-route-read-owner');
  const other = await createUser('graph-route-read-other');
  const userId = userIdOf(teacher);
  const student = await createStudent(teacher, { name: '接口读取学生' });
  const otherStudent = await createStudent(other, { name: '他人读取学生' });
  insertPoint(userId, student.id, '通分', 'skill', 0.25, 4);
  insertPoint(userIdOf(other), otherStudent.id, '他人薄弱点', 'skill', 0.01, 9);
  const courseId = insertCourse(userId, '通分专项练习', '基础', '分数巩固', 1);
  const subject = encodeURIComponent('数学');

  const radar = await req('GET', '/api/knowledge/radar/' + student.id + '/' + subject, { token: teacher });
  assert.equal(radar.status, 200);
  assert.deepEqual(radar.body, {
    concept: [], skill: [{ name: '通分', mastery: 0.25 }], method: [], habit: [],
  });
  const weak = await req('GET', '/api/knowledge/weak-points/' + student.id + '/' + subject + '?limit=1', { token: teacher });
  assert.equal(weak.status, 200);
  assert.deepEqual(weak.body, {
    points: [{ point_name: '通分', point_category: 'skill', mastery_level: 0.25, evidence_count: 4 }],
  });
  const remedial = await req('GET', '/api/knowledge/remedial/' + student.id + '/' + subject + '?limit=1', { token: teacher });
  assert.equal(remedial.status, 200);
  assert.deepEqual(remedial.body.exercises.map((course: any) => course.id), [courseId]);
  assert.equal(remedial.body.exercises[0].content, '通分专项练习');

  const invalid = await req('GET', '/api/knowledge/radar/0/' + subject, { token: teacher });
  assert.deepEqual({ status: invalid.status, body: invalid.body }, { status: 400, body: { error: '参数错误' } });
  for (const endpoint of ['radar', 'weak-points', 'remedial']) {
    const forbidden = await req('GET', '/api/knowledge/' + endpoint + '/' + otherStudent.id + '/' + subject, { token: teacher });
    assert.deepEqual({ status: forbidden.status, body: forbidden.body }, { status: 404, body: { error: '学生不存在' } });
  }
});
