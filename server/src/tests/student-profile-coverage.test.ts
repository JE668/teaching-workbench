import assert from 'node:assert/strict';
import { after, before, mock, test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import './setup.js';
import { db, initDatabase } from '../config/database.js';
import { env } from '../config/env.js';
import { createStudent, createUser, startServer, stopServer, userIdOf } from './helpers.js';
import {
  buildAllStudentProfiles,
  buildStudentProfile,
  gatherProfileSourceData,
  getStudentProfile,
  getStudentProfileForGeneration,
  updateStudentProfile,
} from '../services/ai/studentProfile.js';
import { saveOcrResults } from '../services/ocr.js';

env.SENSENOVA_API_KEY = 'test-only-profile-key';
const originalFetch = globalThis.fetch;
let chatResponder: (body: any) => Response = () => { throw new Error('缺少画像 AI 响应夹具'); };
const chatBodies: any[] = [];
let ownerToken = '';
let ownerId = 0;
let otherId = 0;
let mainStudentId = 0;
let failureStudentId = 0;
let ownImage = '';
let otherImage = '';

const generatedProfile = {
  learning_style: 'visual',
  weak_points: ['分数通分'],
  strong_points: ['图形观察'],
  motivation_drivers: ['即时反馈'],
  pacing_preference: 'steady',
  communication_style: 'encouraging',
  attention_span_minutes: 25,
  homework_compliance: 'medium',
  parental_involvement: 'high',
  updated_at: '2026-01-01T00:00:00.000Z',
  confidence: 0.86,
};

function aiContent(content: string): Response {
  return Response.json({
    id: 'profile-chat-test', object: 'chat.completion', created: 1, model: 'profile-test',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 101, completion_tokens: 51, total_tokens: 152 },
  });
}

before(async () => {
  await initDatabase();
  await startServer();
  ownerToken = await createUser('profile-coverage-owner');
  ownerId = userIdOf(ownerToken);
  otherId = userIdOf(await createUser('profile-coverage-other'));
  const main = await createStudent(ownerToken, { name: '画像综合学生' });
  const failure = await createStudent(ownerToken, { name: '画像异常学生' });
  mainStudentId = main.id;
  failureStudentId = failure.id;
  await createStudent(await createUser('profile-coverage-other-student'), { name: '画像综合学生' });

  ownImage = `${ownerId}/profile-own.jpg`;
  otherImage = `${otherId}/profile-private.jpg`;
  for (const relative of [ownImage, otherImage]) {
    const absolute = path.join(env.UPLOAD_DIR, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    await sharp({ create: { width: 4, height: 4, channels: 3, background: '#ffffff' } }).jpeg().toFile(absolute);
  }
  await saveOcrResults(ownerId, [{ path: ownImage, text: '本人图片：通分时漏乘分子' }]);
  await saveOcrResults(otherId, [{ path: otherImage, text: '其他租户私密OCR' }]);

  mock.method(globalThis, 'fetch', async (input: any, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith(env.SENSENOVA_BASE_URL)) return originalFetch(input, init);
    assert.ok(url.includes('/chat/completions'));
    const body = JSON.parse(String(init?.body));
    chatBodies.push(body);
    return chatResponder(body);
  });
});

after(async () => {
  await stopServer();
  mock.restoreAll();
});

test('画像聚合五类来源且严格隔离租户，成功请求携带本人图片/OCR并持久化、合并教师修订', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const yearMonth = today.slice(0, 7);
  db.prepare(`INSERT INTO followups
    (user_id, student_id, student_name, grade, subject, topic, performance, mastery, images, content, blocks, created_at)
    VALUES (?, ?, '画像综合学生', '五年级', '数学', '分数综合复习', '画图后有进步', 'fair', ?, '本人回访正文', ?, ?)`)
    .run(ownerId, mainStudentId, JSON.stringify([ownImage, otherImage, `${ownerId}/missing.jpg`]),
      JSON.stringify({ 课堂表现: '本人结构化回访证据' }), today);
  const reportId = Number(db.prepare(`INSERT INTO monthly_reports (user_id, student_id, year_month, term, grade, subject)
    VALUES (?, ?, ?, '秋季', '五年级', '数学')`).run(ownerId, mainStudentId, yearMonth).lastInsertRowid);
  const insertItem = db.prepare('INSERT INTO report_items (user_id, report_id, kind, content, type) VALUES (?, ?, ?, ?, ?)');
  insertItem.run(ownerId, reportId, 'summary', '本人月报总结证据', 'course');
  insertItem.run(ownerId, reportId, 'plan', '本人月报规划证据', 'course');
  insertItem.run(ownerId, reportId, 'exam', '本人阶测安排证据', 'exam');
  db.prepare(`INSERT INTO observations (user_id, topic, class_notes, student_name, report, overall_grade, observed_at, lesson_type)
    VALUES (?, '画像听评课', '本人听评课笔记', '画像综合学生', '本人听评课报告', 'B+', ?, 'one_on_one')`)
    .run(ownerId, today);
  db.prepare(`INSERT INTO exam_analysis_details
    (user_id, student_id, exam_id, question_index, mistake_tags, root_cause, review_actions, created_at)
    VALUES (?, ?, 901, 3, ?, '本人阶测根因', ?, ?)`)
    .run(ownerId, mainStudentId, JSON.stringify(['概念不清:定义记错']), JSON.stringify(['重做同类题3道']), today);
  db.prepare(`INSERT INTO knowledge_points
    (user_id, student_id, subject, grade, point_name, point_category, mastery_level, evidence_count)
    VALUES (?, ?, '数学', '五年级', '分数通分', 'skill', 0.35, 4)`).run(ownerId, mainStudentId);

  // 同用户其他学生、其他用户同名学生的证据均不得混入。
  const otherStudent = await createStudent(ownerToken, { name: '隔离学生' });
  db.prepare(`INSERT INTO followups
    (user_id, student_id, student_name, grade, subject, topic, performance, mastery, images, content, created_at)
    VALUES (?, ?, '隔离学生', '五年级', '数学', '不应聚合课题', '无', 'poor', '[]', '其他学生私密回访', ?)`)
    .run(ownerId, otherStudent.id, today);
  db.prepare(`INSERT INTO observations (user_id, topic, class_notes, student_name, observed_at)
    VALUES (?, '其他租户听评课', '其他租户私密笔记', '画像综合学生', ?)`).run(otherId, today);

  const source = await gatherProfileSourceData(ownerId, mainStudentId);
  assert.equal(source.followups.length, 1);
  assert.equal(source.reports.length, 1);
  assert.equal(source.observations.length, 1);
  assert.equal(source.knowledge_points.length, 1);
  assert.equal(source.exam_analyses.length, 1);
  assert.deepEqual(source.followups[0].blocks, { 课堂表现: '本人结构化回访证据' });
  assert.equal(source.followups[0].observed_at, today);
  assert.equal(source.followups[0].overall_grade, 'fair');
  assert.deepEqual(source.reports[0].summary_items, [{ type: 'course', content: '本人月报总结证据' }]);
  assert.deepEqual(source.reports[0].plan_items, [{ type: 'course', content: '本人月报规划证据' }]);
  assert.deepEqual(source.reports[0].exam_items, [{ type: 'exam', content: '本人阶测安排证据' }]);
  assert.deepEqual(source.exam_analyses[0].mistake_tags, ['概念不清:定义记错']);
  assert.deepEqual(source.exam_analyses[0].review_actions, ['重做同类题3道']);
  assert.doesNotMatch(JSON.stringify(source), /其他学生私密回访|其他租户私密笔记/);

  chatBodies.length = 0;
  chatResponder = () => aiContent(JSON.stringify(generatedProfile));
  const built = await buildStudentProfile(ownerId, mainStudentId, '画像综合学生');
  assert.deepEqual(built.profile.weak_points, ['分数通分']);
  assert.equal(built.profile.confidence, 0.86);
  assert.ok(Date.parse(built.profile.updated_at) > Date.parse('2026-01-01T00:00:00.000Z'));
  assert.match(built.sourceSummary, /回访/);
  assert.match(built.sourceSummary, /听评课/);
  assert.match(built.sourceSummary, /错题分析/);

  assert.equal(chatBodies.length, 1);
  const requestText = JSON.stringify(chatBodies[0]);
  for (const evidence of ['本人结构化回访证据', '本人月报总结证据', '本人听评课笔记', '概念不清:定义记错', '分数通分']) {
    assert.ok(requestText.includes(evidence), `画像请求缺少证据：${evidence}`);
  }
  assert.ok(requestText.includes('本人图片：通分时漏乘分子'));
  assert.ok(requestText.includes('data:image/jpeg;base64,'));
  assert.doesNotMatch(requestText, /其他租户私密OCR|其他学生私密回访|其他租户私密笔记/);
  assert.equal(chatBodies[0].response_format.json_schema.name, 'student_profile');
  assert.equal(chatBodies[0].temperature, 0.2);
  assert.equal(chatBodies[0].max_tokens, 1500);

  const saved = getStudentProfile(ownerId, mainStudentId);
  assert.equal(saved?.learning_style, 'visual');
  assert.equal(saved?.confirmed_by_teacher, false);
  assert.equal(getStudentProfile(otherId, mainStudentId), null);
  assert.equal(updateStudentProfile(otherId, mainStudentId, { teacher_notes: '越权修订' }), false);
  assert.equal(updateStudentProfile(ownerId, mainStudentId, {
    strong_points: ['图形观察', '主动订正'], confirmed_by_teacher: true, teacher_notes: '继续用图示',
  }), true);
  const revised = getStudentProfile(ownerId, mainStudentId);
  assert.deepEqual(revised?.strong_points, ['图形观察', '主动订正']);
  assert.deepEqual(revised?.weak_points, ['分数通分']);
  assert.equal(revised?.confirmed_by_teacher, true);
  assert.equal(revised?.teacher_notes, '继续用图示');
  assert.equal(getStudentProfileForGeneration(ownerId, mainStudentId)?.teacher_notes, '继续用图示');
  assert.equal((db.prepare(`SELECT COUNT(*) AS count FROM ai_metrics WHERE user_id = ? AND endpoint = 'student_profile' AND status = 'success'`)
    .get(ownerId) as { count: number }).count, 1);

  db.prepare('UPDATE student_profiles SET profile_json = ? WHERE user_id = ? AND student_id = ?')
    .run('{broken', ownerId, mainStudentId);
  assert.equal(getStudentProfileForGeneration(ownerId, mainStudentId), null);
});

test('画像坏JSON和上游异常向上抛出，批量任务记录单生失败并继续生成其他学生', async () => {
  chatBodies.length = 0;
  chatResponder = () => aiContent('{not-json');
  await assert.rejects(buildStudentProfile(ownerId, failureStudentId, '画像异常学生'), SyntaxError);
  assert.equal(getStudentProfile(ownerId, failureStudentId), null);

  chatResponder = () => Response.json({ error: { message: 'profile upstream failed' } }, { status: 500 });
  await assert.rejects(buildStudentProfile(ownerId, failureStudentId, '画像异常学生'), /500|profile upstream failed/);
  assert.equal(getStudentProfile(ownerId, failureStudentId), null);

  const batchToken = await createUser('profile-coverage-batch');
  const batchUserId = userIdOf(batchToken);
  const failed = await createStudent(batchToken, { name: '批量失败学生' });
  const succeeded = await createStudent(batchToken, { name: '批量成功学生' });
  chatResponder = (body) => JSON.stringify(body).includes('批量失败学生')
    ? Response.json({ error: { message: 'batch source failed' } }, { status: 503 })
    : aiContent(JSON.stringify({ ...generatedProfile, weak_points: ['批量学生薄弱点'] }));
  const results = await buildAllStudentProfiles(batchUserId);
  assert.deepEqual(results.map((r) => ({ studentId: r.studentId, success: r.success })), [
    { studentId: failed.id, success: false },
    { studentId: succeeded.id, success: true },
  ]);
  assert.match(results[0].error || '', /503|batch source failed/);
  assert.equal(getStudentProfile(batchUserId, failed.id), null);
  assert.deepEqual(getStudentProfile(batchUserId, succeeded.id)?.weak_points, ['批量学生薄弱点']);

  const isolated = await gatherProfileSourceData(otherId, mainStudentId);
  assert.deepEqual(isolated, { followups: [], reports: [], observations: [], knowledge_points: [], exam_analyses: [] });
});
