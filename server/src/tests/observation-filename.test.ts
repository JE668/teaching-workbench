import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDocxFilename, formatDateForFilename } from '../utils/observationDocx.js';

/**
 * 听评课 Word 导出文件名。
 *
 * 格式约定（用户指定）：星火个性化教学听评课表 日期 被听课老师.docx
 * 例如：星火个性化教学听评课表 10.17 周江凌.docx
 *
 * 第三段是**被听课老师**，不是评课人签名——签名只写进 Word 正文表末的
 * 「评课人签名：」后面。历史上这里传过 signature，导致导出文件名和约定不符。
 */

test('文件名 = 标题 + 日期(MM.DD) + 被听课老师', () => {
  assert.equal(
    buildDocxFilename('2026-10-17', '周江凌'),
    '星火个性化教学听评课表 10.17 周江凌.docx',
  );
});

test('带时间戳的 observed_at 也能解析出日期', () => {
  assert.equal(
    buildDocxFilename('2026-10-17 14:30:00', '周江凌'),
    '星火个性化教学听评课表 10.17 周江凌.docx',
  );
});

test('日期月份/日期补零', () => {
  assert.equal(buildDate('2026-3-5'), '03.05');
});

test('老师姓名缺省时回落「被听课老师」，不再拿签名顶上', () => {
  assert.equal(
    buildDocxFilename('2026-10-17', ''),
    '星火个性化教学听评课表 10.17 被听课老师.docx',
  );
  assert.equal(
    buildDocxFilename('2026-10-17', '   '),
    '星火个性化教学听评课表 10.17 被听课老师.docx',
  );
});

test('姓名里的非法文件名字符被清掉（Windows 打不开那种）', () => {
  assert.equal(
    buildDocxFilename('2026-10-17', '周/江凌:副*主'),
    '星火个性化教学听评课表 10.17 周 江凌 副 主.docx',
  );
});

test('日期解析不出来时不硬塞空格', () => {
  assert.equal(buildDocxFilename('', '周江凌'), '星火个性化教学听评课表 周江凌.docx');
  assert.equal(buildDocxFilename('还没填', '周江凌'), '星火个性化教学听评课表 周江凌.docx');
});

test('formatDateForFilename 只认本地日期，不做 UTC 偏移', () => {
  assert.equal(formatDateForFilename('2026-10-17'), '10.17');
  assert.equal(formatDateForFilename('2026-12-01 23:59:59'), '12.01');
  assert.equal(formatDateForFilename('乱写的'), '');
});

function buildDate(raw: string): string {
  return formatDateForFilename(raw);
}
