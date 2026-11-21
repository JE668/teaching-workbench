import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import './setup.js';
import { initDatabase } from '../config/database.js';
import { createUser, startServer, stopServer, userIdOf } from './helpers.js';
import {
  createBranch,
  getCurrentDraft,
  getDraftById,
  getDraftGraph,
  getDraftVersions,
  mergeBranch,
  resolveMerge,
  rollbackToVersion,
  upsertDraft,
} from '../services/drafts/unifiedDrafts.js';

before(async () => {
  await initDatabase();
  await startServer();
});

after(async () => {
  await stopServer();
});

test('主版本保存追加不可变历史，回滚生成新主版本', async () => {
  const userId = userIdOf(await createUser('draft-history'));
  const first = upsertDraft({ userId, entityType: 'followup', entityId: 9101, content: { text: '原始', keep: true }, label: '初稿' });
  const second = upsertDraft({ userId, entityType: 'followup', entityId: 9101, content: { text: '修改', keep: true }, label: '第二版' });

  assert.notEqual(second.id, first.id);
  assert.equal(first.version, 1);
  assert.equal(second.version, 2);
  assert.equal(JSON.parse(getDraftById(first.id)!.content_json).text, '原始');
  assert.equal(getCurrentDraft(userId, 'followup', 9101)!.id, second.id);
  assert.equal(getDraftVersions(userId, 'followup', 9101).length, 2);

  const rolledBack = rollbackToVersion(userId, 'followup', 9101, 1)!;
  assert.equal(rolledBack.version, 3);
  assert.equal(rolledBack.is_branch, 0);
  assert.equal(JSON.parse(rolledBack.content_json).text, '原始');
  assert.equal(getCurrentDraft(userId, 'followup', 9101)!.id, rolledBack.id);
  assert.equal(getDraftVersions(userId, 'followup', 9101).length, 3);
  assert.equal(rollbackToVersion(userId, 'followup', 9101, 99), null);
});

test('分支不会覆盖主版本，无冲突合并保留完整版本图', async () => {
  const userId = userIdOf(await createUser('draft-branch'));
  const main = upsertDraft({ userId, entityType: 'report', entityId: 9201, content: { summary: '原始', keep: '不变' } });
  const branch = createBranch(userId, 'report', 9201, main.id, '家长版', { summary: '分支补充', keep: '不变' });

  assert.equal(branch.is_branch, 1);
  assert.equal(branch.fork_from, main.id);
  assert.equal(getCurrentDraft(userId, 'report', 9201)!.id, main.id);
  assert.equal(JSON.parse(getDraftById(main.id)!.content_json).summary, '原始');

  const merged = mergeBranch(userId, branch.id, 9201);
  assert.equal(merged.success, true);
  const mergedMain = getDraftById(merged.draftId!)!;
  assert.equal(mergedMain.is_branch, 0);
  assert.equal(mergedMain.fork_from, branch.id);
  assert.equal(JSON.parse(mergedMain.content_json).summary, '分支补充');
  assert.ok(getDraftById(branch.id), '合并后仍保留分支历史');

  const graph = getDraftGraph(userId, 'report', 9201);
  assert.ok(graph.nodes.some(node => node.id === branch.id && node.isBranch));
  assert.ok(graph.edges.some(edge => edge.from === main.id && edge.to === branch.id));
  assert.ok(graph.edges.some(edge => edge.from === branch.id && edge.to === mergedMain.id));
});

test('三方合并返回字段冲突并允许人工解决', async () => {
  const userId = userIdOf(await createUser('draft-conflict'));
  const base = upsertDraft({ userId, entityType: 'observation', entityId: 9301, content: { summary: '原始', keep: '不变' } });
  const branch = createBranch(userId, 'observation', 9301, base.id, '评课文案', { summary: '分支', keep: '不变' });
  upsertDraft({ userId, entityType: 'observation', entityId: 9301, content: { summary: '主线', keep: '不变' } });

  const result = mergeBranch(userId, branch.id, 9301);
  assert.equal(result.success, false);
  assert.deepEqual(result.conflicts, [{ path: 'summary', base: '原始', current: '主线', incoming: '分支' }]);

  const resolved = resolveMerge(userId, branch.id, 9301, { summary: '人工合并', keep: '不变' });
  assert.equal(resolved.is_branch, 0);
  assert.equal(resolved.fork_from, branch.id);
  assert.equal(JSON.parse(getCurrentDraft(userId, 'observation', 9301)!.content_json).summary, '人工合并');
  assert.ok(getDraftById(branch.id));
});

test('分支与合并严格限制用户和实体边界', async () => {
  const ownerId = userIdOf(await createUser('draft-owner'));
  const otherId = userIdOf(await createUser('draft-other'));
  const main = upsertDraft({ userId: ownerId, entityType: 'followup', entityId: 9401, content: { text: '私有' } });

  assert.throws(() => createBranch(otherId, 'followup', 9401, main.id, '越权', { text: '越权' }), /不存在|无权限/);
  assert.throws(() => createBranch(ownerId, 'followup', 9402, main.id, '跨实体', { text: '跨实体' }), /不属于当前实体/);

  const branch = createBranch(ownerId, 'followup', 9401, main.id, '合法分支', { text: '分支' });
  assert.throws(() => mergeBranch(ownerId, branch.id, 9402), /不属于目标实体/);
  assert.throws(() => resolveMerge(ownerId, branch.id, 9402, { text: '跨实体合并' }), /不属于目标实体/);
  assert.equal(getDraftVersions(otherId, 'followup', 9401).length, 0);
});
