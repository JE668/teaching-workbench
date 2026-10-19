import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {
  formatDay,
  parseExamDate,
  mergePlanSequence,
  buildReportFilename,
  buildReportXlsx,
  estimateWrapHeight,
  REPORT_COLUMNS,
  REPORT_COL_WIDTHS,
  type ReportExcelInput,
} from '../utils/reportExcel.js';

describe('formatDay', () => {
  test('标准日期转中文', () => {
    assert.equal(formatDay('2026-10-07'), '10月7日');
    assert.equal(formatDay('2026-12-25'), '12月25日');
  });

  test('单位数月日不补零', () => {
    assert.equal(formatDay('2026-1-5'), '1月5日');
  });

  test('空值返回空串', () => {
    assert.equal(formatDay(''), '');
    assert.equal(formatDay(undefined), '');
  });

  test('带时间的 ISO 原样返回', () => {
    assert.equal(formatDay('2026-10-07T03:00:00.000Z'), '2026-10-07T03:00:00.000Z');
  });
});

describe('parseExamDate', () => {
  test('从模板文案里抠出「时间10月7日」', () => {
    assert.equal(parseExamDate('秋季度第一次阶测安排：时间10月7日', '2026-10'), '2026-10-07');
  });

  test('支持「时间 11月1日」和「10.7」写法', () => {
    assert.equal(parseExamDate('第二次阶测 时间 11月1日', '2026-10'), '2026-11-01');
    assert.equal(parseExamDate('阶测时间10.7', '2026-10'), '2026-10-07');
  });

  test('阶测行带了覆盖文案也照样能抠出日期（覆盖在时间前面）', () => {
    assert.equal(
      parseExamDate('秋季度第一次阶测安排：覆盖整式的加减、一元一次方程（共2课）；时间11月8日：', '2026-10'),
      '2026-11-08'
    );
    assert.equal(
      parseExamDate('秋季度第二次阶测安排：覆盖声现象等6课；时间12月1日：', '2026-10'),
      '2026-12-01'
    );
  });

  test('拿不到年月时用当前年份', () => {
    const got = parseExamDate('时间12月20日', '');
    assert.equal(got, `${new Date().getFullYear()}-12-20`);
  });

  test('没有日期或日期非法时返回 undefined', () => {
    assert.equal(parseExamDate('秋季度第一次阶测安排', '2026-10'), undefined);
    assert.equal(parseExamDate('', '2026-10'), undefined);
    assert.equal(parseExamDate('时间13月40日', '2026-10'), undefined);
  });
});

describe('mergePlanSequence', () => {
  const course = (date: string, content: string) => ({ content, scheduledAt: date });

  test('阶测按日期插进课程之间', () => {
    const out = mergePlanSequence(
      [course('2026-10-03', '课3'), course('2026-10-01', '课1'), course('2026-10-18', '课4')],
      [{ content: '阶测 10月7日', scheduledAt: '2026-10-07' }]
    );
    assert.deepEqual(
      out.map((e) => [e.kind, e.item.content]),
      [
        ['course', '课1'],
        ['course', '课3'],
        ['exam', '阶测 10月7日'],
        ['course', '课4'],
      ]
    );
  });

  test('没有日期的阶测排在最后（文案解析在 buildReportXlsx 里做）', () => {
    const out = mergePlanSequence(
      [course('2026-10-03', '课3'), course('2026-10-18', '课4')],
      [{ content: '时间10月7日' }]
    );
    assert.equal(out.length, 3);
    assert.equal(out[out.length - 1].item.content, '时间10月7日');
  });

  test('所有阶测都在课程之后时排到最后', () => {
    const out = mergePlanSequence([course('2026-10-01', '课1')], [
      { content: '阶测A', scheduledAt: '2026-11-01' },
      { content: '阶测B', scheduledAt: '2026-11-15' },
    ]);
    assert.deepEqual(
      out.map((e) => e.item.content),
      ['课1', '阶测A', '阶测B']
    );
  });

  test('一侧为空时另一侧原样返回', () => {
    const courses = [course('2026-10-02', '课2'), course('2026-10-01', '课1')];
    assert.deepEqual(
      mergePlanSequence(courses, []).map((e) => e.item.content),
      ['课1', '课2']
    );
    assert.deepEqual(
      mergePlanSequence([], [{ content: '阶测' }]).map((e) => e.kind),
      ['exam']
    );
  });
});

describe('estimateWrapHeight', () => {
  test('空串按一行算', () => {
    assert.equal(estimateWrapHeight(''), 35);
  });

  test('换行分段累加', () => {
    const one = estimateWrapHeight('你好');
    const two = estimateWrapHeight('你好\n再见');
    assert.ok(two > one);
  });

  test('超长文本封顶', () => {
    assert.ok(estimateWrapHeight('长'.repeat(2000)) <= 420);
  });
});

describe('buildReportFilename', () => {
  const base = { studentName: '一可', term: '秋季', grade: '初二', subject: '物理', summaryMonth: '9月', planMonth: '10月' };

  test('字段齐全', () => {
    assert.equal(buildReportFilename(base), '一可 秋季初二物理 9月总结与10月规划.xlsx');
  });

  test('只有总结或只有规划时只写那一个月份', () => {
    assert.equal(buildReportFilename({ ...base, planMonth: undefined }), '一可 秋季初二物理 9月总结.xlsx');
    assert.equal(buildReportFilename({ ...base, summaryMonth: undefined }), '一可 秋季初二物理 10月规划.xlsx');
  });

  test('缺字段时不出现空段', () => {
    assert.equal(buildReportFilename({ studentName: '一可' }), '一可 总结与规划.xlsx');
  });
});

describe('buildReportXlsx', () => {
  const input: ReportExcelInput = {
    studentName: '一可',
    term: '秋季',
    grade: '初二',
    subject: '物理',
    summaryMonth: '9月',
    planMonth: '10月',
    orgName: '星火教育个性化',
    yearMonth: '2026-10',
    summaryIntro: '9月整体学习情况：一可上课出勤正常，笔记整理完成。',
    planIntro: '国庆期间安排3节课，巩固透镜的规律应用。',
    farewell: '感谢一可一整个学期的坚持和努力，继续保持！期待下个月再见！',
    summaryItems: [
      { content: '平面镜成像规律和透镜认识', type: '专题', score: '8-10', difficulty: '★★★', scheduledAt: '2026-09-06', attendance: '出勤', notesDone: '完成', mistakesDone: '完成', homeworkDone: '完成' },
      { content: '凸透镜成像的规律探究', type: '同步', score: '', difficulty: '★★★', scheduledAt: '2026-09-13', attendance: '出勤', notesDone: '完成', mistakesDone: '完成', homeworkDone: '完成' },
      { content: '凸透镜成像的规律探究（补）', type: '同步', score: '', difficulty: '★★★', scheduledAt: '2026-09-26', attendance: '出勤', notesDone: '完成', mistakesDone: '完成', homeworkDone: '完成' },
    ],
    planItems: [
      { content: '凸透镜成像的规律应用', type: '同步', score: '8-10', difficulty: '★★★', scheduledAt: '2026-10-01' },
      { content: '凸透镜成像的规律应用', type: '同步', score: '', difficulty: '★★★', scheduledAt: '2026-10-02' },
      { content: '凸透镜成像的规律应用', type: '同步', score: '', difficulty: '★★★', scheduledAt: '2026-10-03' },
      { content: '质量和体积的测量和关系', type: '同步', score: '25-28', difficulty: '★★★★', scheduledAt: '2026-10-18' },
      { content: '密度的概念、单位、测量', type: '同步', score: '', difficulty: '★★★★', scheduledAt: '2026-10-25' },
      { content: '密度的计算', type: '同步', score: '', difficulty: '★★★★', scheduledAt: '2026-11-01' },
      { content: '密度综合', type: '同步', score: '', difficulty: '★★★★', scheduledAt: '2026-11-08' },
    ],
    examItems: [{ content: '秋季度第一次阶测安排：时间10月7日' }],
  };

  async function read(buf: Buffer): Promise<ExcelJS.Worksheet> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    return wb.getWorksheet(1)!;
  }

  async function mergeRanges(ws: ExcelJS.Worksheet): Promise<string[]> {
    return [...ws.model.merges];
  }

  test('工作表名是学生姓名', async () => {
    const ws = await read(await buildReportXlsx(input));
    assert.equal(ws.name, '一可');
  });

  test('总行数与版式一致（18 行）', async () => {
    const ws = await read(await buildReportXlsx(input));
    assert.equal(ws.rowCount, 18);
    assert.equal(ws.columnCount, REPORT_COLUMNS.length);
  });

  test('标题行文案对齐模板', async () => {
    const ws = await read(await buildReportXlsx(input));
    assert.equal(ws.getCell(1, 1).text, '星火教育个性化 一可 秋季初二物理 9月总结');
    assert.equal(ws.getCell(7, 1).text, '星火教育个性化 一可 秋季初二物理 10月规划');
  });

  test('表头文案完整', async () => {
    const ws = await read(await buildReportXlsx(input));
    for (let i = 0; i < REPORT_COLUMNS.length; i++) {
      assert.equal(ws.getCell(3, i + 1).text, REPORT_COLUMNS[i], `第 ${i + 1} 列表头`);
    }
  });

  test('阶测行按文案日期插进规划课程中间', async () => {
    const ws = await read(await buildReportXlsx(input));
    assert.equal(ws.getCell(13, 1).text, '秋季度第一次阶测安排：时间10月7日');
    assert.equal(ws.getCell(12, 6).text, '10月3日');
    assert.equal(ws.getCell(14, 6).text, '10月18日');
  });

  test('规划块的序号跨阶测连续编号', async () => {
    const ws = await read(await buildReportXlsx(input));
    const seqs = [10, 11, 12, 14, 15, 16, 17].map((r) => ws.getCell(r, 1).text);
    assert.deepEqual(seqs, ['1', '2', '3', '4', '5', '6', '7']);
  });

  test('合并区域与模板一致', async () => {
    const ws = await read(await buildReportXlsx(input));
    const got = new Set(await mergeRanges(ws));
    for (const range of ['A1:K1', 'A2:K2', 'A7:K7', 'A8:K8', 'A13:K13', 'A18:K18']) {
      assert.ok(got.has(range), `缺少合并区域 ${range}，实际 ${[...got].join(' ')}`);
    }
  });

  test('「期末考分值占比」竖向合并', async () => {
    const ws = await read(await buildReportXlsx(input));
    const ranges = new Set(await mergeRanges(ws));
    assert.ok(ranges.has('D4:D6'), '总结块 3 节同分值合并');
    assert.ok(ranges.has('D10:D12'), '规划块前 3 节同分值合并');
    assert.ok(ranges.has('D14:D17'), '阶测后面的 4 节同分值合并');
  });

  test('日期列渲染成中文日期', async () => {
    const ws = await read(await buildReportXlsx(input));
    assert.equal(ws.getCell(4, 6).text, '9月6日');
    assert.equal(ws.getCell(15, 6).text, '10月25日');
  });

  test('规划块不写出勤~考试情况 5 列', async () => {
    const ws = await read(await buildReportXlsx(input));
    assert.equal(ws.getCell(4, 7).text, '出勤');
    assert.equal(ws.getCell(10, 7).text, '');
    assert.equal(ws.getCell(10, 11).text, '');
  });

  test('列宽与模板一致', async () => {
    const ws = await read(await buildReportXlsx(input));
    REPORT_COL_WIDTHS.forEach((w, i) => {
      assert.equal(
        Math.round((ws.getColumn(i + 1).width ?? 0) * 10) / 10,
        w,
        `第 ${i + 1} 列宽`
      );
    });
  });

  test('阶测行是红字加粗、标题行是绿底加粗', async () => {
    const ws = await read(await buildReportXlsx(input));
    const title = ws.getCell(1, 1);
    assert.equal(title.font.bold, true);
    assert.equal(title.font.size, 12);
    const exam = ws.getCell(13, 1);
    assert.equal(exam.font.bold, true);
    assert.equal(exam.font.color?.argb, 'FFFF0000');
  });

  test('不隐藏网格线', async () => {
    const ws = await read(await buildReportXlsx(input));
    assert.equal(ws.views[0]?.showGridLines, false);
  });

  test('两个区块都关掉时仍然生成合法文件', async () => {
    const ws = await read(
      await buildReportXlsx({ studentName: '空学生', term: '秋季', summaryMonth: '9月', planMonth: '10月' })
    );
    assert.equal(ws.getCell(1, 1).text, '空学生 秋季 9月总结');
    assert.equal(ws.getCell(3, 1).text, '序号');
  });

  test('没有祝福语时不出结尾行', async () => {
    const noFarewell = await read(await buildReportXlsx({ ...input, farewell: '' }));
    assert.equal(noFarewell.rowCount, 17);
    const withFarewell = await read(await buildReportXlsx(input));
    assert.equal(withFarewell.rowCount, 18);
  });

  test('摘要为空时占位行仍保留', async () => {
    const ws = await read(await buildReportXlsx({ ...input, summaryIntro: '' }));
    assert.equal(ws.getCell(2, 1).text, '');
    assert.equal(ws.getCell(7, 1).text, '星火教育个性化 一可 秋季初二物理 10月规划');
  });

  test('关掉一个区块时不出那一段', async () => {
    const ws = await read(await buildReportXlsx({ ...input, planEnabled: false }));
    assert.equal(ws.getCell(1, 1).text, '星火教育个性化 一可 秋季初二物理 9月总结');
    // 总结块 6 行 + 祝福语 1 行
    assert.equal(ws.rowCount, 7);
    assert.equal(ws.getCell(7, 1).text, input.farewell);

    const ws2 = await read(await buildReportXlsx({ ...input, summaryEnabled: false }));
    assert.equal(ws2.getCell(1, 1).text, '星火教育个性化 一可 秋季初二物理 10月规划');
  });

  test('两个区块都关掉时只剩祝福语', async () => {
    const ws = await read(await buildReportXlsx({ ...input, summaryEnabled: false, planEnabled: false }));
    assert.equal(ws.rowCount, 1);
    assert.equal(ws.getCell(1, 1).text, input.farewell);
  });

  test('月份标题取自明细里的真实上课日期', async () => {
    const ws = await read(await buildReportXlsx({ ...input, yearMonth: '2026-10' }));
    assert.equal(ws.getCell(1, 1).text, '星火教育个性化 一可 秋季初二物理 9月总结');
    assert.equal(ws.getCell(7, 1).text, '星火教育个性化 一可 秋季初二物理 10月规划');
  });
});
