import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseSections, hasAllSections } from '../utils/sections.js';

describe('parseSections', () => {
  test('解析标准三段', () => {
    const content =
      '【课堂内容】本节课讲了通分。\n【学生收获】小明专注度高。\n【课后任务】完成第12页练习。';
    const s = parseSections(content);
    assert.equal(s.content, '本节课讲了通分。');
    assert.equal(s.gains, '小明专注度高。');
    assert.equal(s.task, '完成第12页练习。');
  });

  test('段内跨行、多余空行被规范化', () => {
    const content = '【课堂内容】第一行\n第二行  \n【学生收获】x\n【课后任务】y';
    const s = parseSections(content);
    assert.equal(s.content, '第一行\n第二行'); // 只去尾部空白，保留内部换行
    assert.equal(s.task, 'y');
  });

  test('缺少某段时为 null', () => {
    const s = parseSections('【课堂内容】只有这一段');
    assert.equal(s.content, '只有这一段');
    assert.equal(s.gains, null);
    assert.equal(s.task, null);
  });

  test('空内容全为 null，raw 保留', () => {
    const s = parseSections('');
    assert.equal(s.content, null);
    assert.equal(s.task, null);
    assert.equal(s.raw, '');
  });

  test('非标准标题不影响已知段', () => {
    const s = parseSections('【乱写的】x\n【课后任务】任务A');
    assert.equal(s.task, '任务A');
    assert.equal(s.content, null);
  });

  test('hasAllSections 判定', () => {
    assert.ok(hasAllSections('【课堂内容】a【学生收获】b【课后任务】c'));
    assert.ok(!hasAllSections('【课后任务】c'));
  });
});
