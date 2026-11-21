import './setup.js';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../config/database.js';
import {
  createFollowUp,
  createStudent,
  createUser,
  req,
  startServer,
  stopServer,
  userIdOf,
} from './helpers.js';
import {
  ownsEntity,
  recordChangeEvent,
  resolveEntityOwner,
} from '../services/content/references.js';

let ownerToken = '';
let otherToken = '';
let ownerId = 0;
let otherId = 0;
let ownerFollowupId = 0;
let otherFollowupId = 0;

before(async () => {
  await startServer();
  ownerToken = await createUser('content-security-owner');
  otherToken = await createUser('content-security-other');
  ownerId = userIdOf(ownerToken);
  otherId = userIdOf(otherToken);
  ownerFollowupId = (await createFollowUp(ownerToken, { topic: '本人回访' })).id as number;
  otherFollowupId = (await createFollowUp(otherToken, { topic: '他人回访' })).id as number;
});

after(async () => {
  await stopServer();
});

describe('content references 用户归属隔离', () => {
  test('stats 只统计本人引用，历史 NULL 归属不计入他人仪表盘', async () => {
    const ownCreate = await req('POST', '/api/content/references', {
      token: ownerToken,
      body: {
        sourceType: 'followup',
        sourceId: ownerFollowupId,
        targetType: 'followup',
        targetId: ownerFollowupId,
        refRole: 'cites',
      },
    });
    assert.equal(ownCreate.status, 200, JSON.stringify(ownCreate.body));
    const ownOutgoing = await req('GET', `/api/content/references/outgoing/followup/${ownerFollowupId}`, { token: ownerToken });
    assert.equal(ownOutgoing.status, 200, JSON.stringify(ownOutgoing.body));
    assert.equal(ownOutgoing.body.references.length, 1);
    const ownIncoming = await req('GET', `/api/content/references/incoming/followup/${ownerFollowupId}`, { token: ownerToken });
    assert.equal(ownIncoming.status, 200, JSON.stringify(ownIncoming.body));
    assert.equal(ownIncoming.body.references.length, 1);
    const crossOutgoing = await req('GET', `/api/content/references/outgoing/followup/${ownerFollowupId}`, { token: otherToken });
    assert.equal(crossOutgoing.status, 403, JSON.stringify(crossOutgoing.body));
    const otherCreate = await req('POST', '/api/content/references', {
      token: otherToken,
      body: {
        sourceType: 'followup',
        sourceId: otherFollowupId,
        targetType: 'followup',
        targetId: otherFollowupId,
        refRole: 'cites',
      },
    });
    assert.equal(otherCreate.status, 200, JSON.stringify(otherCreate.body));
    db.prepare(`INSERT INTO content_references
      (source_type, source_id, target_type, target_id, ref_role, user_id)
      VALUES ('followup', ?, 'followup', ?, 'supplements', NULL)`).run(ownerFollowupId, ownerFollowupId);

    const ownStats = await req('GET', '/api/content/references/stats', { token: ownerToken });
    const otherStats = await req('GET', '/api/content/references/stats', { token: otherToken });
    assert.equal(ownStats.status, 200, JSON.stringify(ownStats.body));
    assert.equal(otherStats.status, 200, JSON.stringify(otherStats.body));
    assert.equal(ownStats.body.stats.totalRefs, 1);
    assert.equal(otherStats.body.stats.totalRefs, 1);
    assert.deepEqual(ownStats.body.stats.byRole, { cites: 1 });
    assert.deepEqual(ownStats.body.stats.bySourceType, { followup: 1 });
    const legacyStats = await req('GET', '/api/content/stats', { token: ownerToken });
    assert.equal(legacyStats.status, 200, JSON.stringify(legacyStats.body));
    assert.equal(legacyStats.body.stats.totalRefs, 1);
  });

  test('change-events 只返回本人事件，虚拟 knowledge id=0 也按操作人隔离', async () => {
    db.prepare('DELETE FROM content_change_events').run();
    const ownEventId = recordChangeEvent('knowledge_index', 0, ['owner_virtual_event'], 1, ownerId)!;
    const otherEventId = recordChangeEvent('knowledge_chunk', 0, ['other_virtual_event'], 1, otherId)!;
    const legacyEventId = Number(db.prepare(`INSERT INTO content_change_events
      (entity_type, entity_id, changed_fields, version, notified, user_id)
      VALUES ('knowledge_index', 0, '["legacy_unowned"]', 1, 0, NULL)`).run().lastInsertRowid);
    assert.ok(ownEventId > 0 && otherEventId > 0 && legacyEventId > 0);

    const ownEvents = await req('GET', '/api/content/references/change-events', { token: ownerToken });
    const otherEvents = await req('GET', '/api/content/references/change-events', { token: otherToken });
    assert.equal(ownEvents.status, 200, JSON.stringify(ownEvents.body));
    assert.equal(otherEvents.status, 200, JSON.stringify(otherEvents.body));
    assert.deepEqual(ownEvents.body.events.map((event: any) => event.id), [ownEventId]);
    assert.deepEqual(otherEvents.body.events.map((event: any) => event.id), [otherEventId]);
    assert.equal(ownEvents.body.events[0].user_id, ownerId);
    assert.equal(otherEvents.body.events[0].user_id, otherId);
  });

  test('mark-notified 不能标记他人或 NULL 事件，非管理员不能全局清理', async () => {
    db.prepare('DELETE FROM content_change_events').run();
    const ownEventId = recordChangeEvent('followup', ownerFollowupId, ['own'], 1, ownerId)!;
    const otherEventId = recordChangeEvent('followup', otherFollowupId, ['other'], 1, otherId)!;
    const legacyEventId = Number(db.prepare(`INSERT INTO content_change_events
      (entity_type, entity_id, changed_fields, version, notified, user_id)
      VALUES ('knowledge_index', 0, '["legacy"]', 1, 0, NULL)`).run().lastInsertRowid);

    const forbiddenMark = await req('POST', '/api/content/references/change-events/mark-notified', {
      token: ownerToken,
      body: { eventIds: [otherEventId, legacyEventId] },
    });
    assert.equal(forbiddenMark.status, 200, JSON.stringify(forbiddenMark.body));
    assert.equal(forbiddenMark.body.marked, 0);
    const remaining = db.prepare('SELECT id FROM content_change_events WHERE id IN (?, ?) AND notified = 0')
      .all(otherEventId, legacyEventId) as Array<{ id: number }>;
    assert.equal(remaining.length, 2);

    const ownMark = await req('POST', '/api/content/references/change-events/mark-notified', {
      token: ownerToken,
      body: { eventIds: [ownEventId] },
    });
    assert.equal(ownMark.status, 200, JSON.stringify(ownMark.body));
    assert.equal(ownMark.body.marked, 1);

    const cleanup = await req('POST', '/api/content/references/change-events/cleanup', {
      token: ownerToken,
      body: { retainDays: 0 },
    });
    assert.equal(cleanup.status, 404, JSON.stringify(cleanup.body));
    const afterCleanup = db.prepare('SELECT COUNT(*) AS count FROM content_change_events').get() as { count: number };
    assert.equal(afterCleanup.count, 3);
  });

  test('观察更新可同步到月报，且每条引用的同步进度互不影响', async () => {
    const student = await createStudent(ownerToken, { name: '引用同步学生' });
    const observationId = Number(db.prepare(
      "INSERT INTO observations (user_id, topic, report, class_notes, status) VALUES (?, '观察同步来源', '最新评课报告', '课堂笔记', 'final')"
    ).run(ownerId).lastInsertRowid);
    const reportId = Number(db.prepare(
      "INSERT INTO monthly_reports (user_id, student_id, year_month, summary_intro, plan_intro) VALUES (?, ?, '2026-11', '旧总结', '旧规划')"
    ).run(ownerId, student.id).lastInsertRowid);
    const secondReportId = Number(db.prepare(
      "INSERT INTO monthly_reports (user_id, student_id, year_month, summary_intro, plan_intro) VALUES (?, ?, '2026-11', '另一份总结', '另一份规划')"
    ).run(ownerId, student.id).lastInsertRowid);
    const createRef = async (sourceId: number) => req('POST', '/api/content/references', {
      token: ownerToken,
      body: { sourceType: 'report', sourceId, targetType: 'observation', targetId: observationId, refRole: 'derives_from' },
    });
    const firstRef = await createRef(reportId);
    const secondRef = await createRef(secondReportId);
    assert.equal(firstRef.status, 200, JSON.stringify(firstRef.body));
    assert.equal(secondRef.status, 200, JSON.stringify(secondRef.body));
    recordChangeEvent('observation', observationId, ['updated'], 2, ownerId);
    recordChangeEvent('observation', observationId, ['updated'], 3, ownerId);

    const beforeSync = await req('GET', '/api/content/references/outgoing/report/' + reportId, { token: ownerToken });
    assert.equal(beforeSync.status, 200, JSON.stringify(beforeSync.body));
    assert.equal(beforeSync.body.references[0].pendingEvents.length, 2);
    const forbidden = await req('POST', '/api/content/references/' + firstRef.body.refId + '/sync', {
      token: otherToken,
      body: { targetField: 'summary_intro' },
    });
    assert.equal(forbidden.status, 404, JSON.stringify(forbidden.body));
    const invalidField = await req('POST', '/api/content/references/' + firstRef.body.refId + '/sync', {
      token: ownerToken,
      body: { targetField: 'summary_intro; DROP TABLE users; --' },
    });
    assert.equal(invalidField.status, 400, JSON.stringify(invalidField.body));

    const synced = await req('POST', '/api/content/references/' + firstRef.body.refId + '/sync', {
      token: ownerToken,
      body: { targetField: 'summary_intro', sourceField: 'report' },
    });
    assert.equal(synced.status, 200, JSON.stringify(synced.body));
    assert.equal(synced.body.content, '最新评课报告');
    const reportRow = db.prepare('SELECT summary_intro, plan_intro FROM monthly_reports WHERE id = ?').get(reportId) as { summary_intro: string; plan_intro: string };
    assert.deepEqual(reportRow, { summary_intro: '最新评课报告', plan_intro: '旧规划' });
    const afterSync = await req('GET', '/api/content/references/outgoing/report/' + reportId, { token: ownerToken });
    const otherReference = await req('GET', '/api/content/references/outgoing/report/' + secondReportId, { token: ownerToken });
    assert.equal(afterSync.body.references[0].pendingEvents.length, 0);
    assert.equal(otherReference.body.references[0].pendingEvents.length, 2, '同步一份月报不能清除另一份月报的提醒');

    recordChangeEvent('observation', observationId, ['updated'], 4, ownerId);
    const afterNewChange = await req('GET', '/api/content/references/outgoing/report/' + reportId, { token: ownerToken });
    assert.equal(afterNewChange.body.references[0].pendingEvents.length, 1);
    const syncNotes = await req('POST', '/api/content/references/' + firstRef.body.refId + '/sync', {
      token: ownerToken,
      body: { targetField: 'plan_intro', sourceField: 'class_notes' },
    });
    assert.equal(syncNotes.status, 200, JSON.stringify(syncNotes.body));
    assert.equal(syncNotes.body.content, '课堂笔记');
    assert.equal((db.prepare('SELECT plan_intro FROM monthly_reports WHERE id = ?').get(reportId) as { plan_intro: string }).plan_intro, '课堂笔记');
  });

  test('student_profile 只按 profile.id 判定归属，不用 student_id 猜测', async () => {
    const student = await createStudent(ownerToken, { name: '画像归属学生' });
    const aliasedStudentId = 9000;
    db.prepare('UPDATE students SET id = ? WHERE id = ? AND user_id = ?')
      .run(aliasedStudentId, student.id, ownerId);
    const profileId = Number(db.prepare(`INSERT INTO student_profiles
      (user_id, student_id, profile_json, source_summary, confidence, generated_at, confirmed_by_teacher, teacher_notes)
      VALUES (?, ?, '{}', '', 0.5, '2026-10-01 10:00:00', 0, '')`)
      .run(ownerId, aliasedStudentId).lastInsertRowid);

    assert.equal(resolveEntityOwner('student_profile', aliasedStudentId), undefined);
    assert.equal(ownsEntity(ownerId, 'student_profile', aliasedStudentId), false);
    assert.equal(resolveEntityOwner('student_profile', profileId), ownerId);
    assert.equal(ownsEntity(ownerId, 'student_profile', profileId), true);
    assert.equal(ownsEntity(otherId, 'student_profile', profileId), false);
  });
});
