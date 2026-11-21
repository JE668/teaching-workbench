import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import './setup.js';
import { db, initDatabase } from '../config/database.js';
import { env } from '../config/env.js';
import { createStudent, createUser, startServer, stopServer, userIdOf } from './helpers.js';
import {
  deleteSourceIndex,
  incrementalIndex,
  indexFollowup,
  indexObservation,
  indexReport,
  rebuildIndex,
  recordIndexChangeEvent,
} from '../services/knowledge/indexer.js';

env.SENSENOVA_API_KEY = 'test-only-ai-key';
const originalFetch = globalThis.fetch;
const longText = '本节课通过面积模型理解异分母分数加减法，学生能够说明通分依据，课后继续巩固约分和计算检查步骤。';

before(async () => {
  await initDatabase();
  await startServer();
});
after(async () => { await stopServer(); });

function mockEmbeddings(t: any, respond?: (input: string, index: number) => Response | undefined) {
  const inputs: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: any, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith(env.SENSENOVA_BASE_URL)) return originalFetch(input, init);
    assert.ok(url.includes('/embeddings'));
    const body = JSON.parse(String(init?.body));
    assert.equal(body.encoding_format, 'float');
    const text = String(body.input);
    const index = inputs.length;
    inputs.push(text);
    const custom = respond?.(text, index);
    if (custom) return custom;
    return Response.json({
      object: 'list', data: [{ object: 'embedding', index: 0, embedding: [1, 0] }],
      model: 'test-embedding', usage: { prompt_tokens: 1, total_tokens: 1 },
    });
  });
  return inputs;
}

function insertFollowup(userId: number, student: any, content: string, createdAt = '2026-01-02 08:00:00') {
  return Number(db.prepare(`INSERT INTO followups
    (user_id, student_id, student_name, grade, subject, topic, performance, mastery, content, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, '分数复习', '参与充分', 'good', ?, ?, ?)`)
    .run(userId, student.id, student.name, student.grade, student.subject, content, createdAt, createdAt).lastInsertRowid);
}

function insertReport(userId: number, studentId: number, yearMonth = '2026-01') {
  return Number(db.prepare(`INSERT INTO monthly_reports (user_id, student_id, year_month, created_at)
    VALUES (?, ?, ?, '2026-01-15 08:00:00')`).run(userId, studentId, yearMonth).lastInsertRowid);
}

function insertChunk(userId: number, sourceType: string, sourceId: number, text: string, subjectGroup = '数学') {
  return Number(db.prepare(`INSERT INTO group_knowledge_chunks
    (user_id, subject_group, source_type, source_id, chunk_text, metadata_json, indexed_at)
    VALUES (?, ?, ?, ?, ?, '{}', '2026-01-01 08:00:00')`)
    .run(userId, subjectGroup, sourceType, sourceId, text).lastInsertRowid);
}

test('月报索引保留条目类型和学生元数据，空报告与不存在的来源均安全跳过', async (t) => {
  mockEmbeddings(t);
  const teacher = await createUser('index-report-owner');
  const userId = userIdOf(teacher);
  const student = await createStudent(teacher, { name: '月报学生', subject: '数学' });
  const reportId = insertReport(userId, student.id);
  const addItem = db.prepare('INSERT INTO report_items (user_id, report_id, kind, content) VALUES (?, ?, ?, ?)');
  addItem.run(userId, reportId, 'summary', '本月系统学习分数通分，能够独立完成基础练习。');
  addItem.run(userId, reportId, 'plan', '下月安排约分与应用题建模，并持续记录错题原因。');

  assert.equal(await indexReport(userId, reportId), 1);
  const row = db.prepare(`SELECT subject_group, chunk_text, metadata_json FROM group_knowledge_chunks
    WHERE user_id = ? AND source_type = 'report' AND source_id = ?`).get(userId, reportId) as any;
  assert.equal(row.subject_group, '数学');
  assert.match(row.chunk_text, /\[summary\] 本月系统学习分数通分/);
  assert.match(row.chunk_text, /\[plan\] 下月安排约分/);
  const metadata = JSON.parse(row.metadata_json);
  assert.equal(metadata.student_id, student.id);
  assert.equal(metadata.student_name, '月报学生');
  assert.equal(metadata.grade, student.grade);
  assert.equal(metadata.report_year_month, '2026-01');
  assert.equal(metadata.source_type, 'report');
  assert.equal(metadata.source_id, reportId);
  assert.equal(metadata.chunk_length, row.chunk_text.length);

  const emptyReportId = insertReport(userId, student.id, '2026-02');
  assert.equal(await indexReport(userId, emptyReportId), 0);
  assert.equal(await indexReport(userId + 1000, reportId), 0);
  assert.equal(await indexFollowup(userId, 999999), 0);
  assert.equal(await indexObservation(userId, 999999), 0);
});

test('过短来源不落库，观察记录缺省学科与创建时间正确进入索引元数据', async (t) => {
  mockEmbeddings(t);
  const teacher = await createUser('index-defaults-owner');
  const userId = userIdOf(teacher);
  const student = await createStudent(teacher, { name: '缺省字段学生' });
  const shortFollowup = insertFollowup(userId, student, '内容太短');
  assert.equal(await indexFollowup(userId, shortFollowup), 0);

  const insertObservation = db.prepare(`INSERT INTO observations
    (user_id, topic, observed_at, grade, subject, student_name, class_notes, report, overall_grade, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const emptyObservation = Number(insertObservation.run(
    userId, '', null, null, null, null, '', '', null, '2026-02-01 08:00:00',
  ).lastInsertRowid);
  assert.equal(await indexObservation(userId, emptyObservation), 0);

  const topic = '听评课记录仅保留课题也能形成有效教研素材，教师展示分数面积模型并组织学生讨论不同表示方法，同时记录学生反馈与后续教学改进建议。';
  const observationId = Number(insertObservation.run(
    userId, topic, null, null, null, null, '', '', null, '2026-02-03 04:05:06',
  ).lastInsertRowid);
  assert.equal(await indexObservation(userId, observationId), 1);
  const row = db.prepare(`SELECT subject_group, chunk_text, metadata_json FROM group_knowledge_chunks
    WHERE user_id = ? AND source_type = 'observation' AND source_id = ?`).get(userId, observationId) as any;
  assert.equal(row.subject_group, '未分科');
  assert.equal(row.chunk_text, topic);
  const metadata = JSON.parse(row.metadata_json);
  assert.equal(metadata.observation_created_at, '2026-02-03 04:05:06');
  assert.equal(metadata.overall_grade, null);
  assert.equal(metadata.topic, topic);
  const count = db.prepare(`SELECT COUNT(*) AS count FROM group_knowledge_chunks
    WHERE user_id = ? AND ((source_type = 'followup' AND source_id = ?) OR (source_type = 'observation' AND source_id = ?))`)
    .get(userId, shortFollowup, emptyObservation) as { count: number };
  assert.equal(count.count, 0);
});

test('长段落保留 200 字重叠分块，单块嵌入失败仍提交其余有效块并替换旧索引', async (t) => {
  const content = '通分情境'.repeat(800);
  const inputs = mockEmbeddings(t, (_input, index) => index === 1
    ? Response.json({ error: { message: 'bad chunk', type: 'invalid_request_error' } }, { status: 400 })
    : undefined);
  const teacher = await createUser('index-chunk-owner');
  const userId = userIdOf(teacher);
  const student = await createStudent(teacher, { name: '长文本学生' });
  const followupId = insertFollowup(userId, student, content);
  insertChunk(userId, 'followup', followupId, '必须被事务替换的旧索引');

  assert.equal(await indexFollowup(userId, followupId), 2);
  assert.deepEqual(inputs.map(input => input.length), [1500, 1500, 600]);
  assert.equal(inputs[1].slice(0, 200), inputs[0].slice(-200));
  const rows = db.prepare(`SELECT chunk_text, metadata_json FROM group_knowledge_chunks
    WHERE user_id = ? AND source_type = 'followup' AND source_id = ? ORDER BY id`).all(userId, followupId) as any[];
  assert.deepEqual(rows.map(row => row.chunk_text), [inputs[0], inputs[2]]);
  assert.equal(rows.some(row => row.chunk_text.includes('旧索引')), false);
  for (const row of rows) {
    const metadata = JSON.parse(row.metadata_json);
    assert.equal(metadata.chunk_length, row.chunk_text.length);
    assert.equal(metadata.student_id, student.id);
    assert.equal(metadata.source_type, 'followup');
  }
});

test('增量任务分别汇总成功、失败和跳过，单个来源持久化异常不阻断后续来源', async (t) => {
  mockEmbeddings(t);
  const teacher = await createUser('index-incremental-errors-owner');
  const userId = userIdOf(teacher);
  const student = await createStudent(teacher, { name: '任务汇总学生', subject: '数学' });
  const badId = insertFollowup(userId, student, longText + '失败来源。', '2026-03-03 08:00:00');
  const goodId = insertFollowup(userId, student, longText + '成功来源。', '2026-03-02 08:00:00');
  const shortId = insertFollowup(userId, student, '短内容应跳过', '2026-03-01 08:00:00');

  const originalPrepare = db.prepare.bind(db);
  t.mock.method(db, 'prepare', ((sql: string) => {
    const statement: any = (originalPrepare as any)(sql);
    if (sql.startsWith('DELETE FROM group_knowledge_chunks')) {
      const run = statement.run.bind(statement);
      statement.run = (...args: any[]) => {
        if (args[2] === badId) throw new Error('simulated index failure');
        return run(...args);
      };
    }
    return statement;
  }) as any);

  const status = await incrementalIndex({
    userId, subjectGroup: '数学', since: '2026-03-01', types: ['followup'],
  });
  assert.deepEqual(status, {
    processed: 1,
    failed: 1,
    skipped: 1,
    errors: [`followup ${badId}: simulated index failure`],
  });
  const chunks = db.prepare(`SELECT source_id, chunk_text FROM group_knowledge_chunks
    WHERE user_id = ? AND source_type = 'followup'`).all(userId) as any[];
  assert.deepEqual(chunks, [{ source_id: goodId, chunk_text: longText + '成功来源。' }]);
  assert.equal(chunks.some(row => row.source_id === badId || row.source_id === shortId), false);
});

test('rebuildIndex 按学科或用户清理并重建，保留其他租户已有知识分块', async (t) => {
  mockEmbeddings(t);
  const teacher = await createUser('index-rebuild-owner');
  const other = await createUser('index-rebuild-other');
  const userId = userIdOf(teacher);
  const otherId = userIdOf(other);
  const mathStudent = await createStudent(teacher, { name: '数学重建学生', subject: '数学' });
  const physicsStudent = await createStudent(teacher, { name: '物理重建学生', subject: '物理' });
  const mathFollowup = insertFollowup(userId, mathStudent, longText + '数学新索引。');
  const physicsFollowup = insertFollowup(userId, physicsStudent, '物理课堂通过实验观察光的折射现象，学生能记录入射角和折射角并解释实验误差，课后继续完成探究报告，教师整理实验数据并安排下一节课进行小组复核与方法总结。');
  insertChunk(userId, 'followup', 8001, '数学陈旧索引', '数学');
  insertChunk(userId, 'followup', 8002, '物理既有索引', '物理');
  const otherChunk = insertChunk(otherId, 'followup', 8003, '其他租户不可删除', '数学');

  const mathStatus = await rebuildIndex({ userId, subjectGroup: '数学' });
  assert.deepEqual(mathStatus, { processed: 1, failed: 0, skipped: 0, errors: [] });
  let ownRows = db.prepare('SELECT source_id, chunk_text FROM group_knowledge_chunks WHERE user_id = ? ORDER BY source_id').all(userId) as any[];
  assert.deepEqual(ownRows, [
    { source_id: mathFollowup, chunk_text: longText + '数学新索引。' },
    { source_id: 8002, chunk_text: '物理既有索引' },
  ]);
  assert.ok(db.prepare('SELECT id FROM group_knowledge_chunks WHERE id = ?').get(otherChunk));

  const allStatus = await rebuildIndex({ userId });
  assert.deepEqual(allStatus, { processed: 2, failed: 0, skipped: 0, errors: [] });
  ownRows = db.prepare('SELECT source_id, subject_group FROM group_knowledge_chunks WHERE user_id = ? ORDER BY subject_group').all(userId) as any[];
  assert.deepEqual(ownRows, [
    { source_id: mathFollowup, subject_group: '数学' },
    { source_id: physicsFollowup, subject_group: '物理' },
  ]);
  const remainingOther = db.prepare('SELECT chunk_text FROM group_knowledge_chunks WHERE id = ?').get(otherChunk) as any;
  assert.deepEqual(remainingOther, { chunk_text: '其他租户不可删除' });
});

test('deleteSourceIndex 只删当前用户指定来源，索引变更事件记录操作人与字段', async () => {
  const teacher = await createUser('index-delete-owner');
  const other = await createUser('index-delete-other');
  const userId = userIdOf(teacher);
  const otherId = userIdOf(other);
  insertChunk(userId, 'followup', 44, '待删除来源');
  insertChunk(userId, 'report', 44, '不同来源类型应保留');
  insertChunk(otherId, 'followup', 44, '其他租户应保留');

  assert.equal(await deleteSourceIndex(userId, 'followup', 44), 1);
  assert.equal(await deleteSourceIndex(userId, 'followup', 44), 0);
  const remaining = db.prepare(`SELECT user_id, source_type FROM group_knowledge_chunks
    WHERE source_id = 44 ORDER BY user_id`).all() as any[];
  assert.deepEqual(remaining, [
    { user_id: userId, source_type: 'report' },
    { user_id: otherId, source_type: 'followup' },
  ]);

  for (const action of ['created', 'updated', 'deleted'] as const) {
    await recordIndexChangeEvent(userId, 'followup', 44, action);
  }
  const events = db.prepare(`SELECT entity_type, entity_id, changed_fields, version, notified, user_id
    FROM content_change_events WHERE user_id = ? ORDER BY id`).all(userId) as any[];
  assert.equal(events.length, 3);
  assert.deepEqual(events.map(event => JSON.parse(event.changed_fields)), [
    ['created:followup:44'], ['updated:followup:44'], ['deleted:followup:44'],
  ]);
  assert.equal(events.every(event => event.entity_type === 'knowledge_chunk' && event.entity_id === 0), true);
  assert.equal(events.every(event => event.version === 1 && event.notified === 0 && event.user_id === userId), true);
});
