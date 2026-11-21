import './setup.js';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createFollowUp,
  createStudent,
  createUser,
  req,
  startServer,
  stopServer,
  userIdOf,
} from './helpers.js';
import { createOrUpdateParentView } from '../services/ai/parentSummary.js';
import { buildParentViewResponse } from '../routes/parentView.js';

const viewData = {
  key_progress: ['已掌握异分母分数通分'],
  focus_areas: ['继续练习应用题建模'],
  action_for_parent: '本周五前检查错题整理',
  teacher_note: '保持主动思考，继续加油！',
};

let token = '';
let userId = 0;
let studentId = 0;

before(async () => {
  await startServer();
  token = await createUser('parent-view-teacher');
  userId = userIdOf(token);
  const student = await createStudent(token, { name: '家长视图学生' });
  studentId = student.id;
});

after(async () => {
  await stopServer();
});

async function seedView(topic: string, expiresDays = 30) {
  const followup = await createFollowUp(token, {
    studentId,
    studentName: '家长视图学生',
    topic,
  });
  return createOrUpdateParentView(userId, 'followup', followup.id, viewData, expiresDays);
}

describe('家长端视图', () => {
  test('教师生成接口必须登录，公开 token 查询不需要登录', async () => {
    const view = await seedView('家长视图公开访问');
    const denied = await req('POST', `/api/parent-view/followup/${view.id}`, { body: {} });
    assert.equal(denied.status, 401);

    const res = await req('GET', `/api/parent-view/${view.accessToken}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.studentName, '家长视图学生');
    assert.equal(res.body.data.subject, '数学');
    assert.deepEqual(res.body.data.viewData, viewData);
  });

  test('未知或过期 token 不可读取', async () => {
    const expired = await seedView('家长视图过期访问', -1);
    const expiredRes = await req('GET', `/api/parent-view/${expired.accessToken}`);
    assert.equal(expiredRes.status, 404);
    const missingRes = await req('GET', '/api/parent-view/not-a-real-token');
    assert.equal(missingRes.status, 404);
    const expiredRead = await req('POST', `/api/parent-view/${expired.accessToken}/read`, { body: {} });
    assert.equal(expiredRead.status, 404);
    const expiredFeedback = await req('POST', `/api/parent-view/${expired.accessToken}/feedback`, {
      body: { feedback: '过期链接不应接受反馈' },
    });
    assert.equal(expiredFeedback.status, 404);
    const unknownRead = await req('POST', '/api/parent-view/not-a-real-token/read', { body: {} });
    assert.equal(unknownRead.status, 404);
  });

  test('家长可标记已读并提交反馈', async () => {
    const view = await seedView('家长视图已读反馈');
    const readRes = await req('POST', `/api/parent-view/${view.accessToken}/read`, { body: {} });
    assert.equal(readRes.status, 200);
    const feedbackRes = await req('POST', `/api/parent-view/${view.accessToken}/feedback`, {
      body: { feedback: '请问下周需要准备哪本练习册？' },
    });
    assert.equal(feedbackRes.status, 200);

    const res = await req('GET', `/api/parent-view/${view.accessToken}`);
    assert.equal(res.status, 200);
    assert.ok(res.body.data.readAt);
    assert.equal(res.body.data.parentFeedback, '请问下周需要准备哪本练习册？');

    const emptyFeedback = await req('POST', `/api/parent-view/${view.accessToken}/feedback`, {
      body: { feedback: '   ' },
    });
    assert.equal(emptyFeedback.status, 400);
  });

  test('月报来源使用 monthly_reports 并可公开读取', async () => {
    const { db } = await import('../config/database.js');
    const inserted = db.prepare(
      `INSERT INTO monthly_reports (user_id, student_id, year_month, grade, subject, summary_intro, plan_intro)
       VALUES (?, ?, '2026-11', '小学五年级', '数学', '本月掌握分数运算', '下月学习小数')`
    ).run(userId, studentId);
    const view = await createOrUpdateParentView(
      userId,
      'report',
      Number(inserted.lastInsertRowid),
      viewData,
      30
    );
    const res = await req('GET', `/api/parent-view/${view.accessToken}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.sourceType, 'report');
    assert.equal(res.body.data.studentName, '家长视图学生');
    assert.equal(res.body.data.subject, '数学');
  });

  test('生成响应仅在提供 OpenID 时推送，并携带学生与学习摘要', async () => {
    const view = await seedView('家长视图微信响应');
    let pushCalls = 0;
    const withoutPush = await buildParentViewResponse({ ...view, viewData }, undefined, async () => {
      pushCalls += 1;
      return { status: 'sent', messageId: 1 };
    });
    assert.equal(pushCalls, 0);
    assert.equal('pushResult' in withoutPush, false);

    let pushInput: any;
    const withPush = await buildParentViewResponse({ ...view, viewData }, '  parent-open-id  ', async (input) => {
      pushCalls += 1;
      pushInput = input;
      return { status: 'sent', messageId: 42 };
    });
    assert.equal(pushCalls, 1);
    assert.equal(pushInput.recipientOpenId, 'parent-open-id');
    assert.equal(pushInput.parentUrl, `/parent-view/${view.accessToken}`);
    assert.equal(pushInput.studentName, '家长视图学生');
    assert.equal(pushInput.summary, viewData.key_progress.join('；'));
    assert.deepEqual(withPush.pushResult, { status: 'sent', messageId: 42 });
  });

  test('非法 parentOpenId 在 AI 生成前返回 400', async () => {
    const followup = await createFollowUp(token, {
      studentId,
      studentName: '家长视图学生',
      topic: '非法 OpenID 不应触发 AI',
    });
    for (const parentOpenId of ['   ', 'x'.repeat(129), 42]) {
      const res = await req('POST', `/api/parent-view/followup/${followup.id}`, {
        token,
        body: { parentOpenId },
      });
      assert.equal(res.status, 400);
    }
  });
});
