import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {
  formatDay,
  examText,
  mergePlanSequence,
  buildReportFilename,
  buildReportXlsx,
  estimateWrapHeight,
  REPORT_COLUMNS,
  REPORT_COL_WIDTHS,
  type ReportExcelInput,
} from '../utils/reportExcel.js';

describe('mergePlanSequence', () => {
  const course = (content: string) => ({ content });

  test('课程按写入顺序原样保留，阶测接在课程之后', () => {
    const out = mergePlanSequence(
      [course('课3'), course('课1'), course('课4')],
      [{ content: '阶测 10月7日' }]
    );
    assert.deepEqual(
      out.map((e) => [e.kind, e.item.content]),
      [
        ['course', '课3'],
        ['course', '课1'],
        ['course', '课4'],
        ['exam', '阶测 10月7日'],
      ]
    );
  });

  test('多场阶测也排在课程之后，彼此保持原有顺序', () => {
    const out = mergePlanSequence([course('课1')], [
      { content: '第一次阶测' },
      { content: '第二次阶测' },
    ]);
    assert.deepEqual(
      out.map((e) => e.item.content),
      ['课1', '第一次阶测', '第二次阶测']
    );
  });

  test('一侧为空时另一侧原样返回', () => {
    assert.deepEqual(
      mergePlanSequence([course('课1'), course('课2')], []).map((e) => e.kind),
      ['course', 'course']
    );
    assert.deepEqual(
      mergePlanSequence([], [{ content: '阶测' }]).map((e) => e.kind),
      ['exam']
    );
  });

  test('两侧都为空时返回空数组', () => {
    assert.deepEqual(mergePlanSequence([], []), []);
  });
});

describe('formatDay / examText', () => {
  test('标准日期转中文', () => {
    assert.equal(formatDay('2026-10-07'), '10月7日');
    assert.equal(formatDay('2026-1-5'), '1月5日');
  });

  test('空值和非法值返回空串', () => {
    assert.equal(formatDay(''), '');
    assert.equal(formatDay(undefined), '');
    assert.equal(formatDay('明天'), '');
  });

  test('阶测填了日期时拼回文案末尾', () => {
    assert.equal(
      examText({ content: '秋季度第一次阶测安排', scheduledAt: '2026-10-07' }),
      '秋季度第一次阶测安排（10月7日）'
    );
  });

  test('文案里已经写了日期就不重复拼', () => {
    assert.equal(
      examText({ content: '秋季度第一次阶测安排：时间10月7日', scheduledAt: '2026-10-07' }),
      '秋季度第一次阶测安排：时间10月7日'
    );
  });

  test('没填日期时原样返回内容', () => {
    assert.equal(examText({ content: '  阶段测评  ' }), '阶段测评');
    assert.equal(examText({ content: '' }), '');
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

describe('REPORT_COLUMNS', () => {
  test('10 列，没有「计划上课时间」', () => {
    assert.equal(REPORT_COLUMNS.length, 10);
    assert.ok(!REPORT_COLUMNS.some((c) => c.includes('上课时间')));
    assert.equal(REPORT_COLUMNS[5], '出勤');
  });

  test('列宽数量与列数一致', () => {
    assert.equal(REPORT_COL_WIDTHS.length, REPORT_COLUMNS.length);
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
      { content: '平面镜成像规律和透镜认识', type: '专题', score: '8-10', difficulty: '★★★', attendance: '出勤', notesDone: '完成', mistakesDone: '完成', homeworkDone: '完成' },
      { content: '凸透镜成像的规律探究', type: '同步', score: '', difficulty: '★★★', attendance: '出勤', notesDone: '完成', mistakesDone: '完成', homeworkDone: '完成' },
      { content: '凸透镜成像的规律探究（补）', type: '同步', score: '', difficulty: '★★★', attendance: '出勤', notesDone: '完成', mistakesDone: '完成', homeworkDone: '完成' },
    ],
    planItems: [
      { content: '凸透镜成像的规律应用', type: '同步', score: '8-10', difficulty: '★★★' },
      { content: '凸透镜成像的规律应用', type: '同步', score: '', difficulty: '★★★' },
      { content: '凸透镜成像的规律应用', type: '同步', score: '', difficulty: '★★★' },
      { content: '质量和体积的测量和关系', type: '同步', score: '25-28', difficulty: '★★★★' },
      { content: '密度的概念、单位、测量', type: '同步', score: '', difficulty: '★★★★' },
      { content: '密度的计算', type: '同步', score: '', difficulty: '★★★★' },
      { content: '密度综合', type: '同步', score: '', difficulty: '★★★★' },
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

  test('表头文案完整、10 列', async () => {
    const ws = await read(await buildReportXlsx(input));
    for (let i = 0; i < REPORT_COLUMNS.length; i++) {
      assert.equal(ws.getCell(3, i + 1).text, REPORT_COLUMNS[i], `第 ${i + 1} 列表头`);
    }
    assert.equal(ws.getCell(3, 11).text, '');
  });

  test('阶段测评行排在规划课程之后', async () => {
    const ws = await read(await buildReportXlsx(input));
    // 规划块：第 7 行标题、第 8 行摘要、第 9 行表头、10~16 行课程、17 行阶测
    assert.equal(ws.getCell(17, 1).text, '秋季度第一次阶测安排：时间10月7日');
    assert.equal(ws.getCell(16, 1).text, '7');
  });

  test('规划块的序号连续编号', async () => {
    const ws = await read(await buildReportXlsx(input));
    const seqs = [10, 11, 12, 13, 14, 15, 16].map((r) => ws.getCell(r, 1).text);
    assert.deepEqual(seqs, ['1', '2', '3', '4', '5', '6', '7']);
  });

  test('合并区域对齐 10 列版式', async () => {
    const ws = await read(await buildReportXlsx(input));
    const got = new Set(await mergeRanges(ws));
    for (const range of ['A1:J1', 'A2:J2', 'A7:J7', 'A8:J8', 'A17:J17', 'A18:J18']) {
      assert.ok(got.has(range), `缺少合并区域 ${range}，实际 ${[...got].join(' ')}`);
    }
  });

  test('「期末考分值占比」竖向合并', async () => {
    const ws = await read(await buildReportXlsx(input));
    const ranges = new Set(await mergeRanges(ws));
    assert.ok(ranges.has('D4:D6'), '总结块 3 节同分值合并');
    assert.ok(ranges.has('D10:D12'), '规划块前 3 节同分值合并');
    assert.ok(ranges.has('D13:D16'), '后 4 节同分值合并');
  });

  test('规划块不写出勤~考试情况 5 列', async () => {
    const ws = await read(await buildReportXlsx(input));
    assert.equal(ws.getCell(4, 6).text, '出勤');
    assert.equal(ws.getCell(10, 6).text, '');
    assert.equal(ws.getCell(10, 10).text, '');
  });

  test('列宽与版式一致', async () => {
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
    const exam = ws.getCell(17, 1);
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

  test('月份标题取自报告所属月份', async () => {
    const ws = await read(await buildReportXlsx({ ...input, yearMonth: '2026-10' }));
    assert.equal(ws.getCell(1, 1).text, '星火教育个性化 一可 秋季初二物理 9月总结');
    assert.equal(ws.getCell(7, 1).text, '星火教育个性化 一可 秋季初二物理 10月规划');
  });
});
