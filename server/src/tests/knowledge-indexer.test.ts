import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import './setup.js';
import { db, initDatabase } from '../config/database.js';
import { env } from '../config/env.js';
import { createFollowUp, createStudent, createUser, startServer, stopServer, userIdOf } from './helpers.js';
import { indexFollowup, indexObservation, incrementalIndex } from '../services/knowledge/indexer.js';

env.SENSENOVA_API_KEY = 'test-only-ai-key';
const originalFetch = globalThis.fetch;

before(async () => {
  await initDatabase();
  await startServer();
});
after(async () => { await stopServer(); });

test('真实学生/听评课字段可索引，重复索引幂等且 since/subjectGroup 参数不可注入', async (t) => {
  t.mock.method(globalThis, 'fetch', async (input: any, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith(env.SENSENOVA_BASE_URL)) return originalFetch(input, init);
    assert.ok(url.includes('/embeddings'));
    return Response.json({
      object: 'list', data: [{ object: 'embedding', index: 0, embedding: [1, 0] }],
      model: 'test-embedding', usage: { prompt_tokens: 1, total_tokens: 1 },
    });
  });

  const teacher = await createUser('index-fields-owner');
  const other = await createUser('index-fields-other');
  const userId = userIdOf(teacher);
  const student = await createStudent(teacher, { name: '索引学生', subject: '数学' });
  const followup = await createFollowUp(teacher, {
    studentId: student.id,
    studentName: student.name,
    content: '本节课学习异分母分数加减法，学生能够借助图形理解通分，课后需要继续巩固计算步骤并独立完成练习。教师还应记录常见错误并安排下一次课堂进行针对性复习。',
  });
  const otherStudent = await createStudent(other, { name: '其他租户学生', subject: '数学' });
  await createFollowUp(other, {
    studentId: otherStudent.id,
    content: '这是其他教师的私密回访，内容足够长但不能进入当前教师的增量索引任务和知识分块。',
  });

  const first = await indexFollowup(userId, followup.id);
  assert.ok(first > 0);
  const followupRows = db.prepare(`SELECT subject_group, chunk_text, metadata_json FROM group_knowledge_chunks
    WHERE user_id = ? AND source_type = 'followup' AND source_id = ?`).all(userId, followup.id) as any[];
  assert.equal(followupRows.length, first);
  assert.equal(followupRows.every((row) => row.subject_group === '数学'), true);
  assert.equal(followupRows.every((row) => JSON.parse(row.metadata_json).student_id === student.id), true);

  const second = await indexFollowup(userId, followup.id);
  assert.equal(second, first);
  const countAfterRetry = db.prepare(`SELECT COUNT(*) AS count FROM group_knowledge_chunks
    WHERE user_id = ? AND source_type = 'followup' AND source_id = ?`).get(userId, followup.id) as { count: number };
  assert.equal(countAfterRetry.count, first);

  const observationId = Number(db.prepare(`INSERT INTO observations
    (user_id, topic, observed_at, grade, subject, student_name, class_notes, report, overall_grade, status)
    VALUES (?, '分数听评课', '2026-11-20', '五年级', '数学', '授课教师', ?, ?, 'excellent', 'completed')`)
    .run(userId,
      '课堂通过面积模型引导学生理解分数意义，学生参与充分，练习反馈及时，课堂记录内容完整。',
      '建议继续增加分层练习并保留学生错误案例，形成可以复用的教研改进记录。').lastInsertRowid);
  assert.ok(await indexObservation(userId, observationId) > 0);
  const observation = db.prepare(`SELECT subject_group, chunk_text, metadata_json FROM group_knowledge_chunks
    WHERE user_id = ? AND source_type = 'observation' AND source_id = ?`).get(userId, observationId) as any;
  assert.equal(observation.subject_group, '数学');
  assert.match(observation.chunk_text, /面积模型/);
  assert.match(observation.chunk_text, /分层练习/);
  assert.equal(JSON.parse(observation.metadata_json).overall_grade, 'excellent');

  const injected = await incrementalIndex({
    userId,
    subjectGroup: "数学' OR 1=1 --",
    since: "2000-01-01' UNION SELECT 1 --",
    types: ['followup', 'observation'],
  });
  assert.deepEqual(injected, { processed: 0, failed: 0, skipped: 0, errors: [] });

  const normal = await incrementalIndex({
    userId, subjectGroup: '数学', since: '2000-01-01', types: ['followup', 'observation'],
  });
  assert.equal(normal.failed, 0);
  assert.equal(normal.processed, 2);
  const ownCount = db.prepare('SELECT COUNT(*) AS count FROM group_knowledge_chunks WHERE user_id = ?').get(userId) as { count: number };
  assert.equal(ownCount.count, first + 1);
  const otherCount = db.prepare('SELECT COUNT(*) AS count FROM group_knowledge_chunks WHERE user_id = ?').get(userIdOf(other)) as { count: number };
  assert.equal(otherCount.count, 0);
});
