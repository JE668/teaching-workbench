import './setup.js';
import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, url, createUser, createStudent, createFollowUp, req } from './helpers.js';
import { setChatStreamer, setChatGenerator, resetChatGenerator } from '../services/ai.js';
import { buildReportAiMessages, generateReportAiOnce, streamReportAi, type ReportAiParams } from '../services/reportAi.js';

describe('月度总结 / 课程规划 · AI 提示词', () => {
  const base: ReportAiParams = {
    field: 'summary',
    studentName: '李小明',
    grade: '初二',
    subject: '物理',
    term: '秋季',
    yearMonth: '2026-10',
    summaryCourses: [
      { content: '凸透镜成像的规律', type: '同步', difficulty: '★★★★★' },
      { content: '眼睛与眼镜', type: '同步' },
    ],
    planCourses: [],
    followUps: [{ topic: '分数加减法运算', content: '小明通分原理理解得比较到位。' }],
  };

  function messages(p: ReportAiParams): string[] {
    return buildReportAiMessages(p).map((m) => m.content);
  }

  function userOf(p: ReportAiParams): string {
    return messages(p)[1];
  }

  test('system + user 两条消息，user 开头就是任务指令', () => {
    const msgs = messages(base);
    assert.equal(msgs.length, 2);
    assert.ok(msgs[0].includes('1对1'));
    assert.ok(msgs[1].includes('请写这一块报告的本月总结'));
  });

  test('7 个 emoji 段落跟输入框占位符一一对应', () => {
    const u = userOf(base);
    for (const line of [
      '📚课堂情况：',
      '📖学习内容：',
      '🎯本月收获：',
      '🏆进步表现：',
      '📝本月不足：',
      '💡建议：',
      '🎯下月目标：',
    ]) {
      assert.ok(u.includes(line), '缺少 ' + line);
    }
  });

  test('课程内容按编号列出，带类型和难度', () => {
    const u = userOf(base);
    assert.ok(u.includes('1. 凸透镜成像的规律（同步，★★★★★）'));
    assert.ok(u.includes('2. 眼睛与眼镜（同步）'));
    // 只有一个属性的课不写空括号
    assert.ok(!u.includes('（，）'));
  });

  test('空内容的课被过滤掉', () => {
    const u = userOf({
      ...base,
      summaryCourses: [{ content: '   ' }, { content: '真内容' }],
    });
    assert.ok(u.includes('1. 真内容'));
    assert.ok(!u.includes('   '));
  });

  test('没有课程内容时给占位文案，不让模型瞎编', () => {
    assert.ok(userOf({ ...base, summaryCourses: [] }).includes('（没有课程内容）'));
  });

  test('没有回访记录时同样给占位文案', () => {
    assert.ok(userOf({ ...base, followUps: [] }).includes('（没有回访记录）'));
  });

  test('总结讲的是本月，月份写成「10月」', () => {
    const u = userOf(base);
    assert.ok(u.includes('总结月份：2026-10（10月）'));
    assert.ok(u.includes('# 10月上过的内容'));
  });

  test('称呼用昵称，不写学生全名', () => {
    const u = userOf({ ...base, studentName: '李小明' });
    assert.ok(u.includes('小明'));
    assert.ok(!u.includes('李小明'));
  });

  test('称呼优先级：显式称呼 > 从姓名推导 > 孩子', () => {
    const bare: ReportAiParams = { ...base, followUps: [] };
    const whoOf = (p: ReportAiParams) =>
      userOf(p).split('\n').find((l) => l.includes('，初二·物理·秋季')) as string;

    assert.equal(whoOf({ ...bare, nickname: '小星' }), '小星，初二·物理·秋季');
    // 三个字的名字去掉姓氏
    assert.ok(whoOf(bare).includes('小明'));
    assert.ok(!whoOf(bare).includes('李小明'));
    // 两个字的名字不敢硬切，保持原样
    assert.ok(whoOf({ ...bare, studentName: '李一' }).includes('李一'));
    // 姓名是空的兜底成「孩子」
    assert.ok(whoOf({ ...bare, studentName: '' }).includes('孩子'));
  });

  test('规划讲的是下个月，不带 emoji', () => {
    const p = {
      ...base,
      field: 'plan' as const,
      planCourses: [{ content: '异分母分数加减法练习巩固' }],
    };
    const u = userOf(p);
    assert.ok(u.includes('请写这一块报告的课程规划说明'));
    assert.ok(u.includes('规划月份：2026-11（11月）'));
    assert.ok(u.includes('不要用 emoji'));
    assert.ok(!u.includes('📚'));
  });

  test('12 月的规划滚到次年 1 月', () => {
    const u = userOf({ ...base, field: 'plan', yearMonth: '2026-12' });
    assert.ok(u.includes('规划月份：2027-01（1月）'));
    // 总结那一段仍然是 12 月
    assert.ok(userOf({ ...base, yearMonth: '2026-12' }).includes('总结月份：2026-12（12月）'));
  });
});

describe('月度总结 / 课程规划 · AI 通道注入', () => {
  beforeEach(() => {
    resetChatGenerator();
  });

  test('非流式把提示词透传给注入的实现，返回完整正文', async () => {
    let seen: string[] = [];
    setChatGenerator(async (_userId: number, messages: { role: string; content: string }[]) => {
      seen = messages.map((m) => m.content);
      return '这是总结正文';
    });
    const text = await generateReportAiOnce(1, {
      field: 'summary',
      studentName: '李小明',
      grade: '初二',
      subject: '物理',
      term: '秋季',
      yearMonth: '2026-10',
      summaryCourses: [{ content: '凸透镜成像' }],
      planCourses: [],
      followUps: [],
    } as ReportAiParams);
    assert.equal(text, '这是总结正文');
    assert.ok(seen[1].includes('请写这一块报告的本月总结'));
  });

  test('流式把增量逐块产出，按顺序拼起来就是完整正文', async () => {
    setChatStreamer(async function* () {
      yield '第一块';
      yield '第二块';
      yield '第三块';
    });
    const chunks: string[] = [];
    for await (const c of streamReportAi(1, {
      field: 'plan',
      studentName: '李小明',
      grade: '初二',
      subject: '物理',
      term: '秋季',
      yearMonth: '2026-10',
      summaryCourses: [],
      planCourses: [{ content: '分数混合运算' }],
      followUps: [],
    } as ReportAiParams)) {
      chunks.push(c);
    }
    assert.deepEqual(chunks, ['第一块', '第二块', '第三块']);
    assert.equal(chunks.join(''), '第一块第二块第三块');
  });
});

describe('POST /api/reports/:id/ai/stream · SSE', () => {
  let token = '';
  let studentId: number;
  let reportId: number;

  before(async () => {
    await startServer();
    token = await createUser('report-ai-teacher');
    const student = await createStudent(token, { name: '李小明', grade: '初二', subject: '物理' });
    studentId = student.id as number;
    const created = await req('POST', '/api/reports', {
      token,
      body: { studentId, yearMonth: '2026-10', term: '秋季' },
    });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    reportId = created.body.report.id as number;

    await req('POST', `/api/reports/${reportId}/items`, {
      token,
      body: { kind: 'summary', content: '凸透镜成像的规律', type: '同步' },
    });
    await req('POST', `/api/reports/${reportId}/items`, {
      token,
      body: { kind: 'plan', content: '分数混合运算' },
    });
    await createFollowUp(token, { studentId, topic: '分数加减法运算' });
  });

  after(async () => {
    await stopServer();
  });

  beforeEach(() => {
    resetChatGenerator();
    // 任何触发「字数重试」的用例都走这条：按 field 返回达标正文（总结 250 / 规划 100），
    // 避免重试打到真实网络。专门测重试的用例会在自身里再覆盖 setChatGenerator。
    setChatGenerator(async (_userId: number, messages: { role: string; content: string }[]) => {
      const isPlan = (messages[1]?.content || '').includes('课程规划说明');
      return isPlan ? '规'.repeat(100) : '总'.repeat(250);
    });
  });

  async function streamField(
    field: 'summary' | 'plan',
    streamer?: (
      userId: number,
      messages: { role: string; content: string }[]
    ) => AsyncGenerator<string>
  ) {
    setChatStreamer(
      streamer ??
        (async function* () {
          // 默认给达标正文（总结 250 字），不触发字数重试
          yield '总'.repeat(250);
        })
    );
    const res = await fetch(url(`/api/reports/${reportId}/ai/stream`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ field }),
    });
    const contentType = res.headers.get('content-type');
    const raw = await res.text();
    const events = raw
      .split('\n\n')
      .map((f) => f.trim())
      .filter(Boolean)
      .map((frame) => {
        const evMatch = /^event:\s*(.+)$/m.exec(frame);
        const dataMatch = /^data:\s*(.+)$/m.exec(frame);
        let data: any = null;
        try {
          data = dataMatch ? JSON.parse(dataMatch[1]) : null;
        } catch {
          data = dataMatch ? dataMatch[1] : null;
        }
        return { event: evMatch ? evMatch[1] : 'message', data };
      });
    return { status: res.status, contentType, events, raw };
  }

  test('未登录不能生成', async () => {
    const res = await fetch(url(`/api/reports/${reportId}/ai/stream`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ field: 'summary' }),
    });
    assert.equal(res.status, 401);
  });

  test('非法 field 返回 400', async () => {
    const res = await req('POST', `/api/reports/${reportId}/ai/stream`, {
      token,
      body: { field: 'haha' },
    });
    assert.equal(res.status, 400);
  });

  test('不存在的报告返回 404', async () => {
    const res = await req('POST', `/api/reports/999999/ai/stream`, {
      token,
      body: { field: 'summary' },
    });
    assert.equal(res.status, 404);
  });

  test('总结流式返回 delta 事件并在 done 里给出完整正文', async () => {
    const { status, contentType, events } = await streamField('summary');
    assert.equal(status, 200);
    assert.ok(contentType && contentType.includes('text/event-stream'));
    assert.ok(events.some((e) => e.event === 'delta'));
    const done = events.find((e) => e.event === 'done');
    assert.ok(done, '应有 done 事件');
    assert.equal(done.data.content, '总'.repeat(250));
    assert.equal(done.data.wordCount, 250);
    assert.ok(!events.some((e) => e.event === 'regenerating'), '字数达标不应触发重试');
  });

  test('字数不达标时发出 regenerating 并以重试结果收尾', async () => {
    const tooShort = '太短了。';
    const good = '总'.repeat(250);
    setChatGenerator(async () => good);

    const { events } = await streamField(
      'summary',
      async function* () {
        yield tooShort;
      }
    );
    const regen = events.find((e) => e.event === 'regenerating');
    assert.ok(regen, '应发出 regenerating 事件');
    assert.equal(regen.data.wordCount, 3, '「太短了。」去标点应为 3 字');
    const done = events.find((e) => e.event === 'done');
    assert.ok(done);
    assert.equal(done.data.content, good, '应以重试版本收尾');
    assert.equal(done.data.wordCount, 250);
    assert.equal(events[events.length - 1].event, 'done', 'done 必须是最后一个事件');
  });

  test('重试的纠偏指令追加为一条 user 消息', async () => {
    const seen: { role: string; content: string }[] = [];
    setChatGenerator(async (_userId: number, messages: { role: string; content: string }[]) => {
      seen.push(...messages);
      return '总'.repeat(250);
    });

    await streamField(
      'summary',
      async function* () {
        yield '太短了。';
      }
    );
    const last = seen[seen.length - 1];
    assert.equal(last.role, 'user');
    assert.ok(last.content.includes('太短了'), '纠偏指令应指出太短');
    assert.ok(seen.length > 2, '应在 system + user 之外追加纠偏消息');
  });

  test('总结与规划的提示词不是同一份（任务指令都不同）', async () => {
    const captured: string[] = [];
    await streamField('summary', async function* (_userId: number, messages: { role: string; content: string }[]) {
      captured.push((messages[1].content || '').includes('课程规划说明') ? 'plan' : 'summary');
      yield '正文';
    });
    assert.equal(captured[0], 'summary');
    await streamField('plan', async function* (_userId: number, messages: { role: string; content: string }[]) {
      captured.push((messages[1].content || '').includes('课程规划说明') ? 'plan' : 'summary');
      yield '正文';
    });
    assert.equal(captured[1], 'plan');
  });

  test('提示词里带上了这块报告的课程明细和最近回访', async () => {
    let prompt = '';
    await streamField(
      'summary',
      async function* (_userId: number, messages: { role: string; content: string }[]) {
        prompt = messages[1].content || '';
        yield '正文';
      }
    );
    assert.ok(prompt.includes('凸透镜成像的规律'));
    assert.ok(prompt.includes('2026-10（10月）'));
    assert.ok(prompt.includes('分数加减法运算'));
    // 学生姓名只用来推导称呼，正文里不该出现全名
    assert.ok(!prompt.includes('李小明'));
  });
});
