import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import './setup.js';
import { initDatabase } from '../config/database.js';
import { createUser, req, startServer, stopServer, userIdOf } from './helpers.js';

before(async () => {
  await initDatabase();
  await startServer();
});

after(async () => {
  await stopServer();
});

test('成员枚举仅限 owner，返回真实成员字段且不泄露其他组或敏感字段', async () => {
  assert.equal((await req('GET', '/api/knowledge/groups/1/members')).status, 401);
  const owner = await createUser('member-list-owner');
  const member = await createUser('member-list-member');
  const outsider = await createUser('member-list-outsider');
  const foreignOwner = await createUser('member-list-foreign-owner');
  const foreignMember = await createUser('member-list-foreign-member');

  const created = await req('POST', '/api/knowledge/groups', {
    token: owner,
    body: { name: '成员枚举授权组', subjectGroup: '数学' },
  });
  assert.equal(created.status, 201);
  const groupId = created.body.group.id as number;
  assert.equal((await req('POST', '/api/knowledge/groups/join', {
    token: member, body: { joinCode: created.body.joinCode },
  })).status, 200);

  const foreignGroup = await req('POST', '/api/knowledge/groups', {
    token: foreignOwner,
    body: { name: '不应出现的其他组', subjectGroup: '数学' },
  });
  assert.equal((await req('POST', '/api/knowledge/groups/join', {
    token: foreignMember, body: { joinCode: foreignGroup.body.joinCode },
  })).status, 200);

  const path = `/api/knowledge/groups/${groupId}/members`;
  assert.equal((await req('GET', path, { token: member })).status, 403);
  assert.equal((await req('GET', path, { token: outsider })).status, 403);
  assert.equal((await req('GET', `/api/knowledge/groups/${foreignGroup.body.group.id}/members`, { token: owner })).status, 403);
  assert.equal((await req('GET', '/api/knowledge/groups/not-a-number/members', { token: owner })).status, 400);

  const listed = await req('GET', path, { token: owner });
  assert.equal(listed.status, 200);
  assert.equal(listed.body.groupId, groupId);
  assert.deepEqual(listed.body.members, [
    {
      user_id: userIdOf(owner),
      username: 'member-list-owner',
      role: 'owner',
      joined_at: listed.body.members[0].joined_at,
    },
    {
      user_id: userIdOf(member),
      username: 'member-list-member',
      role: 'member',
      joined_at: listed.body.members[1].joined_at,
    },
  ]);
  assert.ok(listed.body.members.every((row: { joined_at: string }) => typeof row.joined_at === 'string' && row.joined_at.length > 0));
  const serialized = JSON.stringify(listed.body);
  assert.equal(serialized.includes('member-list-foreign'), false);
  assert.equal(serialized.includes('password'), false);
  assert.equal(serialized.includes('join_code'), false);
  assert.equal(serialized.includes('joinCode'), false);
});

test('owner 完成轮换、撤销和移除闭环，普通成员及组外用户不能变更', async () => {
  const owner = await createUser('management-owner');
  const member = await createUser('management-member');
  const secondMember = await createUser('management-second-member');
  const outsider = await createUser('management-outsider');
  const lateMember = await createUser('management-late-member');
  const ownerId = userIdOf(owner);
  const memberId = userIdOf(member);

  const created = await req('POST', '/api/knowledge/groups', {
    token: owner,
    body: { name: '成员管理闭环组', subjectGroup: '数学' },
  });
  const groupId = created.body.group.id as number;
  const oldCode = created.body.joinCode as string;
  assert.equal((await req('POST', '/api/knowledge/groups/join', {
    token: member, body: { joinCode: oldCode },
  })).status, 200);

  const rotatePath = `/api/knowledge/groups/${groupId}/join-code/rotate`;
  assert.equal((await req('POST', rotatePath, { token: member })).status, 403);
  assert.equal((await req('POST', rotatePath, { token: outsider })).status, 403);
  const rotated = await req('POST', rotatePath, { token: owner });
  assert.equal(rotated.status, 200);
  assert.ok(rotated.body.joinCode.length >= 40);
  assert.notEqual(rotated.body.joinCode, oldCode);
  assert.match(rotated.body.notice, /旧邀请码已失效/);
  assert.equal((await req('POST', '/api/knowledge/groups/join', {
    token: outsider, body: { joinCode: oldCode },
  })).status, 400);
  assert.equal((await req('POST', '/api/knowledge/groups/join', {
    token: secondMember, body: { joinCode: rotated.body.joinCode },
  })).status, 200);

  const removePath = `/api/knowledge/groups/${groupId}/members/${memberId}`;
  assert.equal((await req('DELETE', removePath, { token: member })).status, 403);
  assert.equal((await req('DELETE', removePath, { token: outsider })).status, 403);
  assert.equal((await req('DELETE', `/api/knowledge/groups/${groupId}/members/${ownerId}`, { token: owner })).status, 400);
  const removed = await req('DELETE', removePath, { token: owner });
  assert.equal(removed.status, 200);
  assert.equal(removed.body.removedMemberId, memberId);
  assert.equal(removed.body.group.member_count, 2);
  assert.deepEqual((await req('GET', '/api/knowledge/groups', { token: member })).body.groups, []);

  const listed = await req('GET', `/api/knowledge/groups/${groupId}/members`, { token: owner });
  assert.deepEqual(listed.body.members.map((row: { user_id: number }) => row.user_id), [ownerId, userIdOf(secondMember)]);

  const unusedCode = await req('POST', rotatePath, { token: owner });
  const revokePath = `/api/knowledge/groups/${groupId}/join-code`;
  assert.equal((await req('DELETE', revokePath, { token: secondMember })).status, 403);
  assert.equal((await req('DELETE', revokePath, { token: outsider })).status, 403);
  const revoked = await req('DELETE', revokePath, { token: owner });
  assert.equal(revoked.status, 200);
  assert.equal(revoked.body.revoked, true);
  assert.equal((await req('POST', '/api/knowledge/groups/join', {
    token: lateMember, body: { joinCode: unusedCode.body.joinCode },
  })).status, 400);
});
