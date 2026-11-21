import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, test } from 'node:test';
import './setup.js';
import { db, initDatabase } from '../config/database.js';
import { createUser, req, startServer, stopServer, userIdOf } from './helpers.js';

before(async () => {
  await initDatabase();
  await startServer();
});

after(async () => {
  await stopServer();
});

function insertChunk(userId: number, sourceId: number, text: string) {
  db.prepare(`INSERT INTO group_knowledge_chunks
    (user_id, subject_group, source_type, source_id, chunk_text, metadata_json, indexed_at)
    VALUES (?, '数学', 'followup', ?, ?, '{}', '2026-11-20 08:00:00')`)
    .run(userId, sourceId, text);
}

test('仅 owner 可轮换或撤销邀请码，旧码立即失效且只保存新 hash', async () => {
  assert.equal((await req('POST', '/api/knowledge/groups/1/join-code/rotate')).status, 401);
  assert.equal((await req('DELETE', '/api/knowledge/groups/1/join-code')).status, 401);

  const owner = await createUser('lifecycle-owner');
  const member = await createUser('lifecycle-member');
  const outsider = await createUser('lifecycle-outsider');
  const lateMember = await createUser('lifecycle-late-member');
  const created = await req('POST', '/api/knowledge/groups', {
    token: owner,
    body: { name: '邀请码生命周期组', subjectGroup: '数学' },
  });
  assert.equal(created.status, 201);
  const groupId = created.body.group.id as number;
  const originalCode = created.body.joinCode as string;
  assert.equal((await req('POST', '/api/knowledge/groups/join', {
    token: member, body: { joinCode: originalCode },
  })).status, 200);

  const rotatePath = `/api/knowledge/groups/${groupId}/join-code/rotate`;
  assert.equal((await req('POST', rotatePath, { token: member })).status, 403);
  assert.equal((await req('POST', rotatePath, { token: outsider })).status, 403);
  assert.equal((await req('DELETE', `/api/knowledge/groups/${groupId}/join-code`, { token: member })).status, 403);
  assert.equal((await req('DELETE', `/api/knowledge/groups/${groupId}/join-code`, { token: outsider })).status, 403);

  const rotated = await req('POST', rotatePath, { token: owner });
  assert.equal(rotated.status, 200);
  const rotatedCode = rotated.body.joinCode as string;
  assert.ok(rotatedCode.length >= 40);
  assert.notEqual(rotatedCode, originalCode);
  assert.equal(rotated.body.group.member_count, 2);
  assert.equal(JSON.stringify(rotated.body.group).includes('join_code'), false);
  const rotatedStored = db.prepare(
    'SELECT join_code_hash, join_code_used_at, join_code_used_by FROM knowledge_groups WHERE id = ?'
  ).get(groupId) as { join_code_hash: string; join_code_used_at: string | null; join_code_used_by: number | null };
  assert.equal(rotatedStored.join_code_hash, createHash('sha256').update(rotatedCode).digest('hex'));
  assert.equal(rotatedStored.join_code_used_at, null);
  assert.equal(rotatedStored.join_code_used_by, null);

  // 原邀请码已被消费，轮换后也不能因消费字段重置而复活。
  assert.equal((await req('POST', '/api/knowledge/groups/join', {
    token: outsider, body: { joinCode: originalCode },
  })).status, 400);
  assert.equal((await req('POST', '/api/knowledge/groups/join', {
    token: outsider, body: { joinCode: rotatedCode },
  })).status, 200);

  const revoked = await req('DELETE', `/api/knowledge/groups/${groupId}/join-code`, { token: owner });
  assert.equal(revoked.status, 200);
  assert.equal(revoked.body.revoked, true);
  assert.equal(revoked.body.group.member_count, 3);
  const revokedStored = db.prepare(
    'SELECT join_code_hash, join_code_used_at, join_code_used_by FROM knowledge_groups WHERE id = ?'
  ).get(groupId) as { join_code_hash: string | null; join_code_used_at: string | null; join_code_used_by: number | null };
  assert.deepEqual(revokedStored, { join_code_hash: null, join_code_used_at: null, join_code_used_by: null });
  assert.equal((await req('POST', '/api/knowledge/groups/join', {
    token: lateMember, body: { joinCode: rotatedCode },
  })).status, 400);
  // 撤销操作可安全重试，且不会恢复任何旧邀请码。
  assert.equal((await req('DELETE', `/api/knowledge/groups/${groupId}/join-code`, { token: owner })).status, 200);

  const rotatedAfterRevoke = await req('POST', rotatePath, { token: owner });
  assert.equal(rotatedAfterRevoke.status, 200);
  assert.equal((await req('POST', '/api/knowledge/groups/join', {
    token: lateMember, body: { joinCode: rotatedAfterRevoke.body.joinCode },
  })).status, 200);
  const groups = await req('GET', '/api/knowledge/groups', { token: lateMember });
  assert.equal(groups.body.groups.length, 1);
  assert.equal(JSON.stringify(groups.body).includes('join_code_hash'), false);
});

test('仅 owner 可移除普通 member，owner 不可移除且被移除者立即失去共享权限', async () => {
  const owner = await createUser('remove-owner');
  const member = await createUser('remove-member');
  const outsider = await createUser('remove-outsider');
  const ownerId = userIdOf(owner);
  const memberId = userIdOf(member);
  insertChunk(ownerId, 9101, '群主自己的知识分块');
  insertChunk(memberId, 9102, '普通成员自己的知识分块');
  const created = await req('POST', '/api/knowledge/groups', {
    token: owner,
    body: { name: '成员移除授权组', subjectGroup: '数学' },
  });
  const groupId = created.body.group.id as number;
  assert.equal((await req('POST', '/api/knowledge/groups/join', {
    token: member, body: { joinCode: created.body.joinCode },
  })).status, 200);
  const statsPath = `/api/knowledge/stats?subjectGroup=数学&groupId=${groupId}`;
  const before = await req('GET', statsPath, { token: member });
  assert.equal(before.status, 200);
  assert.equal(before.body.total_chunks, 2);

  const removeMemberPath = `/api/knowledge/groups/${groupId}/members/${memberId}`;
  assert.equal((await req('DELETE', removeMemberPath)).status, 401);
  assert.equal((await req('DELETE', `/api/knowledge/groups/${groupId}/members/${ownerId}`, { token: member })).status, 403);
  assert.equal((await req('DELETE', removeMemberPath, { token: outsider })).status, 403);
  assert.equal((await req('DELETE', `/api/knowledge/groups/${groupId}/members/${ownerId}`, { token: owner })).status, 400);
  assert.equal((await req('DELETE', `/api/knowledge/groups/${groupId}/members/${userIdOf(outsider)}`, { token: owner })).status, 404);

  const removed = await req('DELETE', removeMemberPath, { token: owner });
  assert.equal(removed.status, 200);
  assert.equal(removed.body.removedMemberId, memberId);
  assert.equal(removed.body.group.member_count, 1);
  assert.equal(removed.body.group.role, 'owner');
  assert.equal((await req('GET', statsPath, { token: member })).status, 403);
  assert.deepEqual((await req('GET', '/api/knowledge/groups', { token: member })).body.groups, []);

  const ownerShared = await req('GET', statsPath, { token: owner });
  assert.equal(ownerShared.status, 200);
  assert.equal(ownerShared.body.total_chunks, 1);
  const memberPersonal = await req('GET', '/api/knowledge/stats?subjectGroup=数学', { token: member });
  assert.equal(memberPersonal.status, 200);
  assert.equal(memberPersonal.body.scope, 'personal');
  assert.equal(memberPersonal.body.total_chunks, 1);
  assert.equal((await req('DELETE', removeMemberPath, { token: owner })).status, 404);
});
