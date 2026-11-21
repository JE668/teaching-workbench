import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import './setup.js';
import { db, initDatabase } from '../config/database.js';
import { env } from '../config/env.js';
import { createStudent, createUser, req, startServer, stopServer, userIdOf } from './helpers.js';
import { serializeEmbedding } from '../services/knowledge/vectorStore.js';

env.SENSENOVA_API_KEY = 'test-only-ai-key';
const originalFetch = globalThis.fetch;
const unitEmbedding = serializeEmbedding(new Float32Array([1, 0]));

function mockAi(t: any, digestContent = JSON.stringify({
  key_topics: ['分数'], teacher_insights: [], common_challenges: [], recommendations: [],
})) {
  t.mock.method(globalThis, 'fetch', async (input: any, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith(env.SENSENOVA_BASE_URL)) return originalFetch(input, init);
    if (url.includes('/embeddings')) {
      return Response.json({
        object: 'list',
        data: [{ object: 'embedding', index: 0, embedding: [1, 0] }],
        model: 'test-embedding', usage: { prompt_tokens: 1, total_tokens: 1 },
      });
    }
    if (url.includes('/chat/completions')) {
      return Response.json({
        id: 'chat-test', object: 'chat.completion', created: 1, model: 'test-chat',
        choices: [{ index: 0, message: { role: 'assistant', content: digestContent }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    }
    throw new Error('Unexpected AI URL: ' + url);
  });
}

function insertChunk(userId: number, sourceId: number, text: string, metadata: Record<string, unknown> = {}, withEmbedding = true) {
  return Number(db.prepare(`INSERT INTO group_knowledge_chunks
    (user_id, subject_group, source_type, source_id, chunk_text, embedding, metadata_json, indexed_at)
    VALUES (?, '数学', 'followup', ?, ?, ?, ?, '2026-11-20 08:00:00')`)
    .run(userId, sourceId, text, withEmbedding ? unitEmbedding : null, JSON.stringify(metadata)).lastInsertRowid);
}

async function createJoinedGroup(owner: string, member: string) {
  const created = await req('POST', '/api/knowledge/groups', {
    token: owner, body: { name: '共享检索组', subjectGroup: '数学' },
  });
  assert.equal(created.status, 201);
  const joined = await req('POST', '/api/knowledge/groups/join', {
    token: member, body: { joinCode: created.body.joinCode },
  });
  assert.equal(joined.status, 200);
  return created.body.group.id as number;
}

before(async () => {
  await initDatabase();
  await startServer();
});
after(async () => { await stopServer(); });

test('群组语义检索只返回成员真实非空片段，不泄露同科目租户', async (t) => {
  mockAi(t);
  const owner = await createUser('search-owner');
  const member = await createUser('search-member');
  const outsider = await createUser('search-outsider');
  const groupId = await createJoinedGroup(owner, member);
  insertChunk(userIdOf(owner), 11, '群主可共享的真实片段');
  insertChunk(userIdOf(member), 11, '成员可共享的真实片段');
  insertChunk(userIdOf(outsider), 11, '绝不返回的租户私密片段');
  insertChunk(userIdOf(owner), 12, '   ');

  const response = await req('GET', '/api/knowledge/search?subjectGroup=数学&q=分数&minSimilarity=0&groupId=' + groupId, { token: member });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.results.map((item: any) => item.chunk_text).sort(), ['成员可共享的真实片段', '群主可共享的真实片段']);
  assert.equal(response.body.results.some((item: any) => item.chunk_text.includes('绝不返回')), false);
  assert.equal(response.body.results.every((item: any) => item.chunk_text.trim().length > 0), true);
});

test('相似学生保留真实 chunk_text，跳过空片段和无 student_id 的猜测关联', async (t) => {
  mockAi(t);
  const owner = await createUser('similar-owner');
  const member = await createUser('similar-member');
  const groupId = await createJoinedGroup(owner, member);
  const target = await createStudent(member, { name: '目标学生' });
  const peer = await createStudent(owner, { name: '同组参考学生' });
  const chunkId = insertChunk(userIdOf(owner), 777, '该学生通过数形结合理解分数，课堂练习表现稳定。', { student_id: peer.id, student_name: peer.name });
  insertChunk(userIdOf(owner), 778, '   ', { student_id: peer.id });
  insertChunk(userIdOf(owner), peer.id, '没有学生关联，绝不能仅凭 source_id 猜测。');

  const response = await req('POST', '/api/knowledge/similar-students', {
    token: member,
    body: {
      subjectGroup: '数学', studentId: target.id, groupId,
      studentProfile: { weak_points: ['分数'], strong_points: ['图形'], learning_style: 'visual' },
    },
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.similar.length, 1);
  const similar = response.body.similar[0];
  assert.equal(similar.student_id, peer.id);
  assert.equal(similar.matching_chunks.length, 1);
  assert.equal(similar.matching_chunks[0].id, chunkId);
  assert.equal(similar.matching_chunks[0].source_id, 777);
  assert.equal(similar.matching_chunks[0].chunk_text, '该学生通过数形结合理解分数，课堂练习表现稳定。');
});

test('高分范例必须有显式质量证据并返回质量依据', async (t) => {
  mockAi(t);
  const teacher = await createUser('quality-owner');
  const userId = userIdOf(teacher);
  insertChunk(userId, 21, '优秀听评课范例', { overall_grade: 'excellent' });
  insertChunk(userId, 22, '显式质量评分范例', { quality_score: 90 });
  insertChunk(userId, 23, '只有高语义相似度不能冒充高分', {});

  const response = await req('GET', '/api/knowledge/high-quality-examples?subjectGroup=数学&topic=教学&minSimilarity=0', { token: teacher });
  assert.equal(response.status, 200);
  assert.equal(response.body.examples.length, 2);
  assert.deepEqual(response.body.examples.map((item: any) => item.chunk_text).sort(), ['优秀听评课范例', '显式质量评分范例']);
  assert.equal(response.body.examples.every((item: any) => typeof item.quality_label === 'string' && item.quality_label.length > 0), true);
});

test('周报模型 JSON 无效时返回 502，不返回空摘要伪装成功', async (t) => {
  mockAi(t, '这不是 JSON');
  const teacher = await createUser('bad-digest-owner');
  insertChunk(userIdOf(teacher), 31, '需要摘要的真实教学片段');
  const response = await req('GET', '/api/knowledge/weekly-digest?subjectGroup=数学&startDate=2026-01-01&endDate=2026-12-31', { token: teacher });
  assert.equal(response.status, 502);
  assert.match(response.body.error, /有效 JSON/);
  assert.equal('digest' in response.body, false);
});
