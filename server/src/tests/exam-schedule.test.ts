import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  termKind,
  intervalDays,
  cnOrdinal,
  examPrefix,
  generateExamSchedule,
  dateSpan,
} from '../utils/examSchedule.js';

describe('termKind / intervalDays', () => {
  test('寒暑假走两周一次', () => {
    assert.equal(termKind('暑假'), 'break');
    assert.equal(termKind('寒假'), 'break');
    assert.equal(intervalDays('暑假'), 14);
    assert.equal(intervalDays('寒假'), 14);
  });

  test('学期与高三复习轮次走三周一次', () => {
    assert.equal(termKind('秋季'), 'term');
    assert.equal(termKind('春季'), 'term');
    assert.equal(termKind('一轮复习'), 'term');
    assert.equal(intervalDays('秋季'), 21);
    assert.equal(intervalDays('一轮复习'), 21);
  });

  test('空学期按学期处理', () => {
    assert.equal(intervalDays(''), 21);
  });
});

describe('cnOrdinal', () => {
  test('一到十', () => {
    assert.equal(cnOrdinal(1), '第一次');
    assert.equal(cnOrdinal(9), '第九次');
    assert.equal(cnOrdinal(10), '第十次');
  });

  test('十一到十九用「十X」', () => {
    assert.equal(cnOrdinal(11), '第十一次');
    assert.equal(cnOrdinal(15), '第十五次');
    assert.equal(cnOrdinal(19), '第十九次');
  });

  test('二十以上直接数字', () => {
    assert.equal(cnOrdinal(20), '第二十次');
    assert.equal(cnOrdinal(25), '第二十五次');
  });

  test('非正数返回空串', () => {
    assert.equal(cnOrdinal(0), '');
    assert.equal(cnOrdinal(-3), '');
  });
});

describe('examPrefix', () => {
  test('学期 → 第X季度', () => {
    assert.equal(examPrefix('秋季'), '秋季度');
    assert.equal(examPrefix('春季'), '春季度');
  });

  test('寒暑假保持原样', () => {
    assert.equal(examPrefix('暑假'), '暑假');
    assert.equal(examPrefix('寒假'), '寒假');
  });

  test('高三复习轮次', () => {
    assert.equal(examPrefix('一轮复习'), '一轮复习');
    assert.equal(examPrefix('二轮复习'), '二轮复习');
    assert.equal(examPrefix('三轮复习'), '三轮复习');
  });

  test('不认识的值兜底加「季度」', () => {
    assert.equal(examPrefix('期中考试'), '期中考试季度');
    assert.equal(examPrefix(''), '');
  });
});

describe('generateExamSchedule', () => {
  test('秋季 13 周跨度排 4 次阶测', () => {
    // 2026-09-06 → 2026-12-06，正好 92 天，21 天一次 → 4 次
    const out = generateExamSchedule('秋季', '2026-09-06', '2026-12-06');
    assert.equal(out.length, 4);
    assert.deepEqual(
      out.map((x) => x.date),
      ['2026-09-27', '2026-10-18', '2026-11-08', '2026-11-29']
    );
    assert.deepEqual(
      out.map((x) => x.ordinal),
      ['第一次', '第二次', '第三次', '第四次']
    );
  });

  test('阶测行文案可以直接填进模板', () => {
    const out = generateExamSchedule('秋季', '2026-09-06', '2026-12-06');
    // 对齐真实模板写法：「秋季度第一次阶测安排：时间10月7日：14：00-15：30」
    assert.equal(out[0].content, '秋季度第一次阶测安排：时间9月27日：');
    assert.equal(out[3].content, '秋季度第四次阶测安排：时间11月29日：');
  });

  test('暑假两周一次，2 个月跨度排 4 次', () => {
    // 2026-07-06 → 2026-08-31，56 天，14 天一次 → 4 次
    const out = generateExamSchedule('暑假', '2026-07-06', '2026-08-31');
    assert.equal(out.length, 4);
    assert.deepEqual(
      out.map((x) => x.date),
      ['2026-07-20', '2026-08-03', '2026-08-17', '2026-08-31']
    );
  });

  test('高一寒假 4 周排 2 次', () => {
    const out = generateExamSchedule('寒假', '2026-12-21', '2027-01-18');
    assert.equal(out.length, 2);
    assert.equal(out[0].prefix, '寒假');
    assert.equal(out[0].content, '寒假第一次阶测安排：时间1月4日：');
  });

  test('跨度不够一次阶测就返回空', () => {
    // 秋季 21 天一次，只有 20 天排不下
    assert.deepEqual(generateExamSchedule('秋季', '2026-09-06', '2026-09-26'), []);
    // 正好 20 天，边界外
    assert.deepEqual(generateExamSchedule('秋季', '2026-09-06', '2026-09-26'), []);
    // 正好 21 天，能排 1 次
    assert.equal(generateExamSchedule('秋季', '2026-09-06', '2026-09-27').length, 1);
  });

  test('日期格式非法直接返回空，不抛错', () => {
    assert.deepEqual(generateExamSchedule('秋季', '不对', '2026-12-06'), []);
    assert.deepEqual(generateExamSchedule('秋季', '2026-09-06', '9月13日'), []);
    assert.deepEqual(generateExamSchedule('秋季', '', ''), []);
  });

  test('截止早于开始返回空', () => {
    assert.deepEqual(generateExamSchedule('秋季', '2026-12-06', '2026-09-06'), []);
  });

  test('跨月跨年都能算对', () => {
    // 一轮复习：2026-12-13 → 2027-03-21（98 天）→ 4 次
    const out = generateExamSchedule('一轮复习', '2026-12-13', '2027-03-21');
    assert.equal(out.length, 4);
    assert.deepEqual(
      out.map((x) => x.date),
      ['2027-01-03', '2027-01-24', '2027-02-14', '2027-03-07']
    );
    assert.equal(out[2].content, '一轮复习第三次阶测安排：时间2月14日：');
  });
});

describe('dateSpan', () => {
  test('从一串日期里取最小与最大', () => {
    const span = dateSpan(['2026-10-12', '2026-09-06', '2026-11-02', '2026-10-26']);
    assert.deepEqual(span, { startDate: '2026-09-06', endDate: '2026-11-02' });
  });

  test('忽略空值与非法日期', () => {
    const span = dateSpan(['', '2026-10-12', '不是日期', null as any, '2026-09-06']);
    assert.deepEqual(span, { startDate: '2026-09-06', endDate: '2026-10-12' });
  });

  test('全为空或全非法返回 null', () => {
    assert.equal(dateSpan([]), null);
    assert.equal(dateSpan(['', null as any]), null);
    assert.equal(dateSpan(['不是日期']), null);
  });

  test('只有一个日期也能返回', () => {
    assert.deepEqual(dateSpan(['2026-10-12']), { startDate: '2026-10-12', endDate: '2026-10-12' });
  });

  test('短日期写法会被规范化成补零格式', () => {
    assert.deepEqual(dateSpan(['2026-9-6']), { startDate: '2026-09-06', endDate: '2026-09-06' });
  });
});
