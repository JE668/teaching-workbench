import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, test } from 'node:test';
import './setup.js';
import { db, initDatabase } from '../config/database.js';
import { createUser, req, startServer, stopServer, userIdOf } from './helpers.js';
import { generateWeeklyDigest } from '../services/knowledge/vectorStore.js';

before(async () => {
  await initDatabase();
  await startServer();
});

after(async () => {
  await stopServer();
});

function insertChunk(userId: number, sourceId: number, text: string, subject = '数学', metadata: Record<string, unknown> = {}) {
  db.prepare(`INSERT INTO group_knowledge_chunks
    (user_id, subject_group, source_type, source_id, chunk_text, metadata_json, indexed_at)
    VALUES (?, ?, 'followup', ?, ?, ?, '2026-11-20 08:00:00')`)
    .run(userId, subject, sourceId, text, JSON.stringify(metadata));
}

test('知识库接口要求身份，个人统计保持跨用户隔离', async () => {
  assert.equal((await req('GET', '/api/knowledge/groups')).status, 401);
  assert.equal((await req('POST', '/api/knowledge/groups', { body: { name: 'x', subjectGroup: '数学' } })).status, 401);

  const teacher = await createUser('knowledge-owner');
  const other = await createUser('knowledge-other');
  const userId = userIdOf(teacher);
  insertChunk(userId, 101, '本教师回访知识', '数学', { student_id: 101 });
  insertChunk(userIdOf(other), 202, '其他教师私密知识', '数学', { student_id: 202 });

  const response = await req('GET', '/api/knowledge/stats?subjectGroup=数学', { token: teacher });
  assert.equal(response.status, 200);
  assert.equal(response.body.scope, 'personal');
  assert.equal(response.body.total_chunks, 1);
  assert.equal(response.body.unique_students, 1);
  assert.equal(response.body.by_source_type[0].count, 1);
});

test('群组邀请码只存 hash、一次消费且成员重复加入幂等', async () => {
  const owner = await createUser('group-code-owner');
  const member = await createUser('group-code-member');
  const outsider = await createUser('group-code-outsider');
  const created = await req('POST', '/api/knowledge/groups', {
    token: owner,
    body: { name: '数学教研一组', subjectGroup: '数学' },
  });
  assert.equal(created.status, 201);
  const joinCode = created.body.joinCode as string;
  const groupId = created.body.group.id as number;
  assert.ok(joinCode.length >= 40);
  assert.equal(created.body.group.member_count, 1);

  const stored = db.prepare('SELECT join_code_hash, join_code_used_at FROM knowledge_groups WHERE id = ?').get(groupId) as { join_code_hash: string; join_code_used_at: string | null };
  assert.equal(stored.join_code_hash, createHash('sha256').update(joinCode).digest('hex'));
  assert.equal(stored.join_code_hash.includes(joinCode), false);
  assert.equal(JSON.stringify(created.body.group).includes('join_code'), false);

  const ownerRetry = await req('POST', '/api/knowledge/groups/join', { token: owner, body: { joinCode } });
  assert.equal(ownerRetry.status, 200);
  assert.equal(ownerRetry.body.alreadyMember, true);
  assert.equal(ownerRetry.body.group.member_count, 1);

  const joined = await req('POST', '/api/knowledge/groups/join', { token: member, body: { joinCode } });
  assert.equal(joined.status, 200);
  assert.equal(joined.body.alreadyMember, false);
  assert.equal(joined.body.group.member_count, 2);
  const memberRetry = await req('POST', '/api/knowledge/groups/join', { token: member, body: { joinCode } });
  assert.equal(memberRetry.status, 200);
  assert.equal(memberRetry.body.alreadyMember, true);
  assert.equal(memberRetry.body.group.member_count, 2);

  const consumed = await req('POST', '/api/knowledge/groups/join', { token: outsider, body: { joinCode } });
  assert.equal(consumed.status, 400);
  const listed = await req('GET', '/api/knowledge/groups', { token: member });
  assert.equal(listed.status, 200);
  assert.equal(listed.body.groups.length, 1);
  assert.equal(listed.body.groups[0].id, groupId);
  assert.equal('joinCode' in listed.body.groups[0], false);
  assert.equal('join_code_hash' in listed.body.groups[0], false);
  const outsiderGroups = await req('GET', '/api/knowledge/groups', { token: outsider });
  assert.deepEqual(outsiderGroups.body.groups, []);
});

test('仅显式群组成员可共享，同科目、其他群组及注入参数均不能越权', async () => {
  const owner = await createUser('scope-owner');
  const member = await createUser('scope-member');
  const outsider = await createUser('scope-outsider');
  const ownerId = userIdOf(owner);
  const memberId = userIdOf(member);
  insertChunk(ownerId, 301, '群主私有分块', '数学', { student_id: 301 });
  insertChunk(memberId, 302, '成员私有分块', '数学', { student_id: 302 });
  insertChunk(userIdOf(outsider), 303, '租户外私密分块', '数学', { student_id: 303 });

  const created = await req('POST', '/api/knowledge/groups', {
    token: owner, body: { name: '授权共享组', subjectGroup: '数学' },
  });
  const groupId = created.body.group.id as number;
  const statsPath = '/api/knowledge/stats?subjectGroup=数学&groupId=' + groupId;

  const ownerPersonal = await req('GET', '/api/knowledge/stats?subjectGroup=数学', { token: owner });
  assert.equal(ownerPersonal.body.total_chunks, 1);
  const memberPersonal = await req('GET', '/api/knowledge/stats?subjectGroup=数学', { token: member });
  assert.equal(memberPersonal.body.total_chunks, 1);
  assert.equal((await req('GET', statsPath, { token: member })).status, 403);
  assert.equal((await req('GET', statsPath, { token: outsider })).status, 403);

  assert.equal((await req('POST', '/api/knowledge/groups/join', {
    token: member, body: { joinCode: created.body.joinCode },
  })).status, 200);
  const shared = await req('GET', statsPath, { token: member });
  assert.equal(shared.status, 200);
  assert.equal(shared.body.scope, 'shared');
  assert.equal(shared.body.group_id, groupId);
  assert.equal(shared.body.total_chunks, 2);
  assert.equal(shared.body.unique_students, 2);
  assert.equal((await req('GET', '/api/knowledge/stats?subjectGroup=语文&groupId=' + groupId, { token: member })).status, 403);

  const otherGroup = await req('POST', '/api/knowledge/groups', {
    token: outsider, body: { name: '同科目但不能互通', subjectGroup: '数学' },
  });
  assert.equal((await req('GET', '/api/knowledge/stats?subjectGroup=数学&groupId=' + otherGroup.body.group.id, { token: member })).status, 403);
  assert.equal((await req('GET', '/api/knowledge/stats?subjectGroup=数学&groupId=1%20OR%201%3D1', { token: member })).status, 400);
  const injection = await req('GET', '/api/knowledge/stats?subjectGroup=' + encodeURIComponent("数学' OR 1=1 --"), { token: member });
  assert.equal(injection.status, 200);
  assert.equal(injection.body.total_chunks, 0);

  await assert.rejects(
    generateWeeklyDigest({ userId: userIdOf(outsider), subjectGroup: '数学', startDate: '2026-01-01', endDate: '2026-12-31', groupId }),
    (error: any) => error.statusCode === 403,
  );
});

test('跨用户知识分块不会进入个人教研周报', async () => {
  const teacher = await createUser('digest-owner');
  const other = await createUser('digest-other');
  insertChunk(userIdOf(other), 999, '不应泄露的其他教师月报', '物理');

  const result = await generateWeeklyDigest({
    userId: userIdOf(teacher),
    subjectGroup: '物理',
    startDate: '2026-01-01',
    endDate: '2026-12-31 23:59:59',
  });
  assert.deepEqual(result.key_topics, []);
  assert.deepEqual(result.common_challenges, []);
  assert.equal(result.recommendations.length, 0);
});
