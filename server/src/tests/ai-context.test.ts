import './setup.js';
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, createUser, createStudent, userIdOf } from './helpers.js';
import { db } from '../config/database.js';
import {
  correctionText,
  buildPrompt,
  followUpWordRangeForParams,
  MIN_WORDS,
  MAX_WORDS,
  FollowUpGenerateParams,
} from '../services/ai.js';
import { fetchFollowUpHistory, buildGenerateParams } from '../routes/followups.ai.js';

/**
 * 注意：这里全部用直接调用被测函数的写法，不走 HTTP。
 * Node 的 test runner 在同一 describe 内并发执行用例，用全局桩（setFollowUpStreamer）
 * 抓参数的做法会被并发用例互相覆盖，结果不稳定。
 */

let token = '';
let userId = 0;
let studentId = 0;

before(async () => {
  await startServer();
  token = await createUser('ai-context-teacher');
  userId = userIdOf(token);
  const s = await createStudent(token, { name: 'AI上下文测试学员', phone: '13900139099' });
  studentId = s.id;
});
after(async () => {
  await stopServer();
});

const base: FollowUpGenerateParams = {
  studentName: '李小明',
  grade: '小学五年级',
  subject: '数学',
  topic: '分数加减法运算',
  performance: '专注度较高',
  mastery: 'good',
  images: [],
};

const BODY = {
  studentName: '李小明',
  grade: '小学五年级',
  subject: '数学',
  topic: '分数加减法运算',
  performance: '专注度较高',
  mastery: 'good',
  images: [],
};

/** 直接向库里塞一条回访，绕过路由校验（小组课经路由建不出来） */
function insertFollowUp(overrides: Record<string, any> = {}) {
  const row = db
    .prepare(
      `INSERT INTO followups (user_id, student_id, student_name, grade, subject, topic, performance, mastery, course_type, images, content)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      overrides.userId ?? userId,
      overrides.studentId ?? studentId,
      overrides.studentName ?? '学员',
      overrides.grade ?? '小学五年级',
      overrides.subject ?? '数学',
      overrides.topic ?? '分数加减法',
      overrides.performance ?? '专注度较高',
      overrides.mastery ?? 'good',
      overrides.courseType ?? 'one_on_one',
      '[]',
      overrides.content ?? '回访内容'
    );
  return Number(row.lastInsertRowid);
}

/** 另开一个用户来验证跨用户隔离 */
function otherUserId(): number {
  return Number(
    db
      .prepare(`INSERT INTO users (username, password, created_at) VALUES (?, ?, datetime('now'))`)
      .run('other-user-' + Date.now(), 'irrelevant')
      .lastInsertRowid
  );
}

describe('字数纠偏文案（第 6 项）', () => {
  test('太短：说明还差多少字并提示往哪个方向补充', () => {
    const text = correctionText(15, { min: 50, max: 120 });
    assert.ok(text.includes('50-120'), '应带目标区间');
    assert.ok(text.includes('35'), '应说明还差多少字');
    assert.ok(text.includes('补'), '应提示补充方向');
  });

  test('太长：说明超出多少字并提示压缩方向', () => {
    const text = correctionText(200, { min: 50, max: 120 });
    assert.ok(text.includes('80'), '应说明超了多少字');
    assert.ok(text.includes('压缩'), '应提示压缩方向');
  });

  test('略超上限：按实际超出量提示压缩', () => {
    // 上限是硬性约束，略超也要提示压缩而不是"微调"
    const text = correctionText(130, { min: 50, max: 120 });
    assert.ok(text.includes('压缩'), '略超上限仍应压缩');
  });

  test('区间内：提示调整到目标区间', () => {
    // isWordCountOk 判定的值不会走到这里，此分支是防御性兜底
    const text = correctionText(110, { min: 100, max: 120 });
    assert.ok(text.includes('100-120'), '应给出目标区间');
    assert.ok(text.includes('调整到'), '区间内应提示调整');
  });
});

describe('多板块字数区间（第 6 项修复）', () => {
  test('多板块时区间随板块数放宽', () => {
    const single = followUpWordRangeForParams({ module: 'class_content' });
    const triple = followUpWordRangeForParams({
      modules: ['class_content', 'class_performance', 'homework_review'],
    });
    assert.ok(triple.min > single.min, '多板块下限应更高');
    assert.ok(triple.max > single.max, '多板块上限应更高');
  });

  test('未给板块时按单板块计算', () => {
    assert.deepEqual(followUpWordRangeForParams({}), { min: MIN_WORDS, max: MAX_WORDS });
  });
});

describe('回访历史上下文 prompt（第 1 项）', () => {
  test('历史上下文会进入 prompt，含防重复与呼应进步双指令', () => {
    const prompt = buildPrompt({
      ...base,
      history: [
        { content: '上次重点讲了分数加减法，孩子通分步骤掌握得不错。', when: '上一次', topic: '分数加减法运算' },
      ],
    });
    assert.ok(prompt.includes('历史回访记录'), '应出现历史区块标题');
    assert.ok(prompt.includes('上一次'), '应标注时间');
    assert.ok(prompt.includes('不要照搬'), '应有防重复指令');
    assert.ok(prompt.includes('呼应'), '应有呼应进步指令');
    assert.ok(prompt.includes('通分步骤掌握得不错'), '应包含上次回访内容');
    assert.ok(prompt.includes('分数加减法运算'), '应带上次回访的主题');
  });

  test('多条历史按时间倒序逐条列出', () => {
    const prompt = buildPrompt({
      ...base,
      history: [
        { content: '第二次回访内容A', when: '上两次' },
        { content: '第一次回访内容B', when: '上一次' },
      ],
    });
    assert.ok(prompt.indexOf('内容A') < prompt.indexOf('内容B'), '倒序：更早的在前');
  });

  test('无历史时不出现历史区块', () => {
    const prompt = buildPrompt(base);
    assert.ok(!prompt.includes('历史回访记录'), '无历史不应有该区块');
    assert.ok(!prompt.includes('上一次'), '无历史不应出现时间标注');
  });

  test('小组课不带历史（小组课无按学生的回访记录）', () => {
    const prompt = buildPrompt({
      ...base,
      courseType: 'group',
      history: [{ content: '不应出现', when: '上一次' }],
    });
    assert.ok(!prompt.includes('不应出现'), '小组课不应带历史');
    assert.ok(!prompt.includes('历史回访记录'));
  });
});

describe('历史查询口径（第 1 项）', () => {
  test('只取 1 对 1，小组课被排除，按时间倒序，最多 5 条', () => {
    const name = '历史口径学员A';
    // 3 条 1 对 1 + 1 条小组课（同名学生，验证小组课被排除）
    for (let i = 1; i <= 3; i++) {
      insertFollowUp({ studentName: name, topic: '第' + i + '次', content: '历史内容-' + i });
    }
    insertFollowUp({ studentName: name, courseType: 'group', content: '小组课内容-应排除' });

    const history = fetchFollowUpHistory(userId, studentId, name);
    assert.equal(history.length, 3, '只取 1 对 1 的 3 条，小组课被排除');
    assert.ok(!JSON.stringify(history).includes('小组课'), '历史里不应出现小组课内容');
    assert.equal(history[0].when, '上一次');
    assert.equal(history[2].when, '上3次');
    assert.ok(history.every((h) => h.content && h.content.length > 0), '每条都应有内容');
  });

  test('超出 5 条时截断，保留最新的 5 条', () => {
    const name = '历史口径学员B';
    for (let i = 1; i <= 8; i++) {
      insertFollowUp({ studentName: name, topic: '第' + i + '次', content: 'B-内容-' + i });
    }

    const history = fetchFollowUpHistory(userId, studentId, name);
    assert.equal(history.length, 5, '超出部分应被截断到 5 条');
    // 同秒插入时按 id DESC 兜底排序：最新的 5 条 = 后插的 5 条
    assert.ok(!JSON.stringify(history).includes('B-内容-1'), '最旧的应被裁掉');
    assert.ok(JSON.stringify(history).includes('B-内容-8'), '最新的一条应保留');
  });

  test('studentId 或姓名缺失时不查库、返回空', () => {
    assert.deepEqual(fetchFollowUpHistory(userId, undefined, '某人'), []);
    assert.deepEqual(fetchFollowUpHistory(userId, 0, '某人'), []);
    assert.deepEqual(fetchFollowUpHistory(userId, 5, ''), []);
    assert.deepEqual(fetchFollowUpHistory(userId, 5, '   '), []);
  });

  test('同名不同人的记录不会被带进来（跨用户隔离）', () => {
    const name = '历史口径学员C';
    insertFollowUp({ studentName: name, content: '我自己的历史' });
    insertFollowUp({ userId: otherUserId(), studentName: name, content: '别人的历史' });

    const history = fetchFollowUpHistory(userId, studentId, name);
    assert.equal(history.length, 1, '只应查到本用户的记录');
    assert.equal(history[0].content, '我自己的历史');
  });
});

describe('生成参数构建（第 1、5 项）', () => {
  test('小组课不查历史', () => {
    const params = buildGenerateParams(userId, { ...BODY, courseType: 'group' });
    assert.deepEqual(params.history, [], '小组课 history 应为空数组');
  });

  test('1 对 1 带历史', () => {
    const name = '历史口径学员D';
    insertFollowUp({ studentName: name, content: '之前的一次回访' });

    const params = buildGenerateParams(userId, { ...BODY, studentId, studentName: name });
    assert.equal(params.history!.length, 1);
    assert.equal(params.history![0].content, '之前的一次回访');
  });

  test('图片上限 4 张（第 5 项）', () => {
    const params = buildGenerateParams(userId, {
      ...BODY,
      images: Array.from({ length: 10 }, (_, i) => '/u/f/' + i + '.jpg'),
    });
    assert.equal(params.images.length, 4, '超过 4 张应截断');
    assert.equal(params.images[0], '/u/f/0.jpg', '应保留最早的 4 张');
    assert.equal(params.images[3], '/u/f/3.jpg');
  });

  test('不传图片时为空数组', () => {
    const params = buildGenerateParams(userId, BODY);
    assert.deepEqual(params.images, []);
  });
});
