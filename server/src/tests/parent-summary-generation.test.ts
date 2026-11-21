import assert from 'node:assert/strict';
import { after, before, mock, test } from 'node:test';
import './setup.js';
import { db, initDatabase } from '../config/database.js';
import { env } from '../config/env.js';
import { createStudent, createUser, startServer, stopServer, userIdOf } from './helpers.js';
import { generateParentView } from '../services/ai/parentSummary.js';

env.SENSENOVA_API_KEY = 'test-only-ai-key';
const originalFetch = globalThis.fetch;
let requests: any[] = [];
let responder: (() => Response) | null = null;

before(async () => {
  await initDatabase();
  await startServer();
  // OpenAI 客户端缓存 fetch；稳定分发器确保每个用例都能替换响应且不串租户。
  mock.method(globalThis, 'fetch', async (input: any, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith(env.SENSENOVA_BASE_URL)) return originalFetch(input, init);
    assert.ok(url.includes('/chat/completions'));
    requests.push(JSON.parse(String(init?.body)));
    if (!responder) throw new Error('缺少家长摘要响应夹具');
    return responder();
  });
});

after(async () => {
  await stopServer();
  mock.restoreAll();
});

function mockChat(content: string) {
  requests = [];
  responder = () => Response.json({
    id: 'parent-view-chat', object: 'chat.completion', created: 1, model: 'test-chat',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
  });
}

function insertFollowup(userId: number, student: any) {
  return Number(db.prepare(`INSERT INTO followups
    (user_id, student_id, student_name, grade, subject, topic, performance, mastery, content,
     knowledge_gain, class_performance, homework_assign, next_plan, teacher_remark, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, '分数复习', '主动参与', 'good', ?, ?, ?, ?, ?, ?, '2026-04-01 08:00:00', '2026-04-01 08:00:00')`)
    .run(
      userId, student.id, student.name, student.grade, student.subject,
      '原始回访：订正第3题通分，仍需每天检查约分。',
      '已能说明通分依据', '能主动订正错题', '完成分数练习并复查', '下周巩固约分', '继续保持主动提问',
    ).lastInsertRowid);
}

test('回访生成家长视图时携带结构化板块，返回严格的三条进展和两条配合事项', async () => {
  const teacher = await createUser('parent-generation-followup');
  const userId = userIdOf(teacher);
  const student = await createStudent(teacher, { name: '回访摘要学生', subject: '数学' });
  const followupId = insertFollowup(userId, student);
  const expected = {
    key_progress: ['已掌握通分依据', '已能主动订正', '计算检查更稳定'],
    focus_areas: ['每天练习约分', '完成作业后主动复查'],
    action_for_parent: '下周检查分数练习的订正与复查记录',
    teacher_note: '孩子最近愿意主动提问，值得肯定。',
  };
  mockChat(JSON.stringify(expected));

  const result = await generateParentView(userId, 'followup', followupId);
  assert.deepEqual(result, expected);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].response_format.type, 'json_object');
  assert.equal(requests[0].temperature, 0.4);
  const prompt = requests[0].messages[1].content;
  assert.match(prompt, /课后回访/);
  assert.match(prompt, /回访摘要学生/);
  assert.match(prompt, /已能说明通分依据/);
  assert.match(prompt, /完成分数练习并复查/);
  assert.match(prompt, /原始回访：订正第3题通分/);
});

test('月报汇总 summary、plan、exam 条目，坏 JSON 时返回完整兜底而不推送半份摘要', async () => {
  const teacher = await createUser('parent-generation-report');
  const userId = userIdOf(teacher);
  const student = await createStudent(teacher, { name: '月报摘要学生', subject: '数学' });
  const reportId = Number(db.prepare(`INSERT INTO monthly_reports
    (user_id, student_id, year_month, grade, subject, created_at)
    VALUES (?, ?, '2026-04', '五年级', '数学', '2026-04-30 08:00:00')`)
    .run(userId, student.id).lastInsertRowid);
  const addItem = db.prepare('INSERT INTO report_items (user_id, report_id, kind, content, sort, seq) VALUES (?, ?, ?, ?, ?, ?)');
  addItem.run(userId, reportId, 'summary', '本月掌握异分母分数加减。', 1, 1);
  addItem.run(userId, reportId, 'plan', '下月重点练习应用题建模。', 2, 1);
  addItem.run(userId, reportId, 'exam', '阶测中约分步骤仍有遗漏。', 3, 1);
  mockChat('这不是 JSON');

  const result = await generateParentView(userId, 'report', reportId);
  assert.equal(result.key_progress.length, 3);
  assert.equal(result.focus_areas.length, 2);
  assert.ok(result.action_for_parent.trim());
  assert.ok(result.teacher_note.includes('月报摘要学生'));
  const prompt = requests[0].messages[1].content;
  assert.match(prompt, /月度总结规划/);
  assert.match(prompt, /【总结】\n本月掌握异分母分数加减/);
  assert.match(prompt, /【规划】\n下月重点练习应用题建模/);
  assert.match(prompt, /【阶测】\n阶测中约分步骤仍有遗漏/);
});

test('缺失或跨租户来源拒绝生成，上游错误保留给调用方并记录失败路径', async () => {
  const teacher = await createUser('parent-generation-errors');
  const other = await createUser('parent-generation-other');
  const userId = userIdOf(teacher);
  const student = await createStudent(teacher, { name: '异常摘要学生' });
  const followupId = insertFollowup(userId, student);
  requests = [];
  await assert.rejects(generateParentView(userId, 'followup', 999999), /Source data not found/);
  await assert.rejects(generateParentView(userIdOf(other), 'followup', followupId), /Source data not found/);
  assert.equal(requests.length, 0);

  responder = () => Response.json(
    { error: { message: 'parent upstream rejected', type: 'server_error' } },
    { status: 500 },
  );
  await assert.rejects(generateParentView(userId, 'followup', followupId), /parent upstream rejected/);
  // OpenAI SDK 可对 500 自动重试；关键是确实走了上游失败路径，而非写死重试次数。
  assert.ok(requests.length >= 1);
});
