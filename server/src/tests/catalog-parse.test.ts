import './setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {
  normalizeTextbook,
  trackLabel,
  extractTerm,
  parseCatalogWorkbook,
} from '../utils/catalogParse.js';

// ============ 教材版本归一化 ============

describe('normalizeTextbook', () => {
  test('括号年份被去掉', () => {
    assert.equal(normalizeTextbook('人教版（2024）'), '人教版');
    assert.equal(normalizeTextbook('粤教版(2025)'), '粤教版');
    assert.equal(normalizeTextbook('人教版（2017版）'), '人教版');
  });

  test('"2024年" 形式的年份被去掉', () => {
    assert.equal(normalizeTextbook('2024年人教版'), '人教版');
  });

  test('裸数字年份被去掉', () => {
    assert.equal(normalizeTextbook('人教版2024'), '人教版');
  });

  test('人教 PEP 系列归一到人教版', () => {
    assert.equal(normalizeTextbook('人教pep版'), '人教版');
    assert.equal(normalizeTextbook('人教PEP版'), '人教版');
    assert.equal(normalizeTextbook('人教pep'), '人教版');
  });

  test('普通值原样返回，空白返回空串', () => {
    assert.equal(normalizeTextbook('部编版'), '部编版');
    assert.equal(normalizeTextbook('  人教版  '), '人教版');
    assert.equal(normalizeTextbook(''), '');
    assert.equal(normalizeTextbook(null), '');
    assert.equal(normalizeTextbook(undefined), '');
  });
});

// ============ 轨名归一化 ============

describe('trackLabel', () => {
  test('【基础进阶】归为基础轨 —— 它同时含"基础"和"进阶"两个字', () => {
    assert.equal(trackLabel('【基础进阶】内容', 0, true), '基础');
  });

  test('【拓展拔尖】归为拓展轨', () => {
    assert.equal(trackLabel('【拓展拔尖】内容', 1, true), '拓展拔尖');
  });

  test('新版写法：基础课程 / 进阶课程', () => {
    assert.equal(trackLabel('基础课程内容', 0, true), '基础');
    assert.equal(trackLabel('进阶课程内容', 1, true), '进阶');
  });

  test('新版写法：辅导内容（基础版）/（进阶版）', () => {
    assert.equal(trackLabel('辅导内容（基础版）', 0, true), '基础');
    assert.equal(trackLabel('辅导内容（进阶版）', 1, true), '进阶');
  });

  test('单轨 sheet 轨名为空', () => {
    assert.equal(trackLabel('辅导内容', 0, false), '');
  });
});

// ============ 学期识别 ============

describe('extractTerm', () => {
  test('季节学期', () => {
    assert.equal(extractTerm('星火教育个性化 高一语文 暑假 课程目录'), '暑假');
    assert.equal(extractTerm('星火教育个性化 高一语文 秋季 课程目录'), '秋季');
    assert.equal(extractTerm('星火教育个性化 高一语文 寒假 课程目录'), '寒假');
    assert.equal(extractTerm('星火教育个性化 高一语文 春季 课程目录'), '春季');
  });

  test('高三的复习轮次（原表三种写法都要能识别）', () => {
    assert.equal(extractTerm('星火教育个性化 高三语文 一轮复习 课程目录'), '一轮复习');
    assert.equal(extractTerm('星火教育个性化 高三语文 二轮复习 课程目录'), '二轮复习');
    assert.equal(extractTerm('星火教育个性化 高三语文 三轮复习 课程目录'), '三轮复习');
  });

  test('"一轮 复习" 中间有空格也能识别', () => {
    assert.equal(extractTerm('星火教育个性化 高三地理 一轮 复习 课程目录'), '一轮复习');
    assert.equal(extractTerm('星火教育个性化 高三地理 二轮  复习 课程目录'), '二轮复习');
  });

  test('只写"一轮"没有"复习"也要识别', () => {
    // 原表里"星火教育个性化 生物一轮 课程目录"就是这种写法
    assert.equal(extractTerm('星火教育个性化    生物一轮  课程目录'), '一轮复习');
    assert.equal(extractTerm('星火教育个性化 生物三轮  课程目录'), '三轮复习');
  });

  test('识别不到返回空串', () => {
    assert.equal(extractTerm('随便一段文字'), '');
    assert.equal(extractTerm(''), '');
  });
});

// ============ 合成工作簿 ============

/** exceljs 返回的 Buffer 与新版 @types/node 的类型定义不一致，统一在这里转成 Uint8Array */
async function workbookBytes(wb: ExcelJS.Workbook): Promise<Uint8Array> {
  return await wb.xlsx.writeBuffer() as any;
}

async function buildSingleTrackWorkbook(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('高一语文');

  const set = (r: number, c: number, v: string) => {
    ws.getCell(r, c).value = v;
  };

  // 首个分区标题（在表头之上，暑假那段）
  ws.mergeCells(1, 1, 1, 6);
  set(1, 1, '星火教育个性化  高一语文  暑假  课程目录');

  // 填写指引行（必须被跳过，不能当数据）
  ws.mergeCells(2, 1, 2, 6);
  set(2, 1, '【XX月课程规划】请写出本学期课程的整体安排……');

  // 两行表头（A/B 列纵向合并）
  ws.mergeCells(3, 1, 4, 1);
  ws.mergeCells(3, 2, 4, 2);
  set(3, 1, '教材版本');
  set(3, 2, '序号');
  set(3, 3, '辅导内容');
  set(3, 4, '课程类型');
  set(3, 5, '学习难度');
  set(3, 6, '对后续课程影响程度');

  // 教材版本纵向合并（只有左上角有值）
  ws.mergeCells(5, 1, 9, 1);
  set(5, 1, '人教版（2024）');

  set(5, 2, '1'); set(5, 3, '古代诗歌鉴赏'); set(5, 4, '专题'); set(5, 5, '★★'); set(5, 6, '★★★');
  set(6, 2, '2'); set(6, 3, '记叙文写作'); set(6, 4, '专题'); set(6, 5, '★★★'); set(6, 6, '★★★★');
  set(7, 2, '3'); set(7, 3, '文言文阅读'); set(7, 4, '同步'); set(7, 5, '★★★★'); set(7, 6, '★★★★★');

  // 分节行（单轨时整行合并），插在数据中间 —— 必须被识别成分节，而不是课程
  ws.mergeCells(8, 3, 8, 6);
  set(8, 2, '3');
  set(8, 3, '秋季第一次阶段性测试');

  set(9, 2, '4'); set(9, 3, '现代文阅读'); set(9, 4, '专题'); set(9, 5, '★★★'); set(9, 6, '★★★★');

  // 第二个分区：重复标题 + 指引 + 表头（必须全部被跳过）
  ws.mergeCells(10, 1, 10, 6);
  set(10, 1, '星火教育个性化  高一语文  秋季  课程目录');
  ws.mergeCells(11, 1, 11, 6);
  set(11, 1, '【XX月课程规划】……');
  ws.mergeCells(12, 1, 13, 1);
  ws.mergeCells(12, 2, 13, 2);
  set(12, 1, '教材版本');
  set(12, 2, '序号');
  set(12, 3, '辅导内容');
  set(12, 4, '课程类型');
  set(12, 5, '学习难度');
  set(12, 6, '对后续课程影响程度');

  set(14, 1, '部编版');
  set(14, 2, '1'); set(14, 3, '说明文阅读'); set(14, 4, '预习'); set(14, 5, '★★'); set(14, 6, '★★★');

  return await workbookBytes(wb);
}

async function buildDualTrackWorkbook(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('高一数学');

  const set = (r: number, c: number, v: string) => {
    ws.getCell(r, c).value = v;
  };

  ws.mergeCells(1, 1, 1, 10);
  set(1, 1, '星火教育个性化  高一数学  暑假  课程目录');

  ws.mergeCells(2, 1, 3, 1);
  ws.mergeCells(2, 2, 3, 2);
  set(2, 1, '教材版本');
  set(2, 2, '序号');
  set(2, 3, '【基础进阶】内容');
  set(2, 4, '课程类型');
  set(2, 5, '期末考分值占比');
  set(2, 6, '学习难度');
  set(2, 7, '【拓展拔尖】内容');
  set(2, 8, '课程类型');
  set(2, 9, '期末考分值占比');
  set(2, 10, '学习难度');

  ws.mergeCells(4, 1, 7, 1);
  set(4, 1, '人教版');

  set(4, 2, '1');
  set(4, 3, '集合与常用逻辑'); set(4, 4, '专题'); set(4, 5, '10-15分'); set(4, 6, '★★');
  set(4, 7, '数学竞赛导论'); set(4, 8, '专题'); set(4, 9, '20-25分'); set(4, 10, '★★★★★');

  set(5, 2, '2');
  set(5, 3, '函数概念'); set(5, 4, '同步'); set(5, 5, '15-20分'); set(5, 6, '★★★');
  set(5, 7, '不等式恒成立'); set(5, 8, '专题'); set(5, 9, '15-20分'); set(5, 10, '★★★★');

  // 关键场景：基础轨插了分节行，但拓展轨同一行还有正常课程。
  // 分节行只覆盖左半部分，右半部分不空 —— 这是双轨 sheet 最常见的坑。
  ws.mergeCells(6, 3, 6, 6);
  set(6, 3, '秋季期中阶测');
  set(6, 7, '导数零点问题'); set(6, 8, '专题'); set(6, 9, '25-30分'); set(6, 10, '★★★★★');

  set(7, 2, '4');
  set(7, 3, '指对数运算'); set(7, 4, '专题'); set(7, 5, '10-15分'); set(7, 6, '★★★');

  return await workbookBytes(wb);
}

async function load(buf: Uint8Array): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  // exceljs 与新版 @types/node 的 Buffer 泛型定义不一致，直接跳过类型检查
  await wb.xlsx.load(buf as any);
  return wb;
}

describe('parseCatalogWorkbook · 单轨 sheet', () => {
  test('课程全部解析出来，字段完整', async () => {
    const r = await parseCatalogWorkbook(await buildSingleTrackWorkbook(), '高中', load);
    assert.deepEqual(r.failedSheets, []);
    assert.equal(r.courses.length, 5);

    const c = r.courses.find((x) => x.content === '古代诗歌鉴赏')!;
    assert.equal(c.grade, '高一');
    assert.equal(c.subject, '语文');
    assert.equal(c.term, '暑假');
    assert.equal(c.type, '专题');
    assert.equal(c.difficulty, '★★');
    assert.equal(c.impact, '★★★');
    assert.equal(c.textbook, '人教版');
    assert.equal(c.track, '');
    assert.equal(c.seq, 1);
    assert.equal(c.sourceRow, 5);
  });

  test('纵向合并的教材版本会被填充到每一行', async () => {
    const r = await parseCatalogWorkbook(await buildSingleTrackWorkbook(), '高中', load);
    const summer = r.courses.filter((c) => c.term === '暑假');
    assert.ok(summer.length >= 4, '暑假段应有 4 条课程');
    for (const c of summer) assert.equal(c.textbook, '人教版', c.content);
  });

  test('分节行被识别为分节，不混进课程里', async () => {
    const r = await parseCatalogWorkbook(await buildSingleTrackWorkbook(), '高中', load);
    const leaked = r.courses.filter((c) => c.content.includes('阶测') || c.content.includes('课程规划') || c.content.includes('教材版本'));
    assert.deepEqual(leaked, [], '不应有分节行 / 指引行 / 表头行漏进数据');

    const withSection = r.courses.filter((c) => c.section === '秋季第一次阶段性测试');
    assert.equal(withSection.length, 1);
    assert.equal(withSection[0].content, '现代文阅读');
    assert.equal(withSection[0].term, '暑假');
  });

  test('第二个分区的学期被正确切换', async () => {
    const r = await parseCatalogWorkbook(await buildSingleTrackWorkbook(), '高中', load);
    const autumn = r.courses.filter((c) => c.term === '秋季');
    assert.equal(autumn.length, 1);
    assert.equal(autumn[0].content, '说明文阅读');
    assert.equal(autumn[0].textbook, '部编版');
    // 分节状态随分区重置
    assert.equal(autumn[0].section, '');
  });

  test('每个分区的 sheet 摘要正常', async () => {
    const r = await parseCatalogWorkbook(await buildSingleTrackWorkbook(), '高中', load);
    assert.equal(r.sheets.length, 1);
    assert.equal(r.sheets[0].sheet, '高一语文');
    assert.equal(r.sheets[0].trackCount, 1);
    assert.equal(r.sheets[0].courses, 5);
    assert.equal(r.sheets[0].error, undefined);
  });
});

describe('parseCatalogWorkbook · 双轨 sheet', () => {
  test('左右两轨的课程各自解析，轨名归一化', async () => {
    const r = await parseCatalogWorkbook(await buildDualTrackWorkbook(), '高中', load);
    assert.deepEqual(r.failedSheets, []);
    // 2 行双轨数据(各2条) + 分节行恢复的1条拓展轨 + 末尾1条基础轨 = 6
    assert.equal(r.courses.length, 6);

    const base = r.courses.filter((c) => c.track === '基础');
    const ext = r.courses.filter((c) => c.track === '拓展拔尖');
    assert.equal(base.length, 3);
    assert.equal(ext.length, 3);

    const ext1 = r.courses.find((c) => c.content === '数学竞赛导论')!;
    assert.equal(ext1.type, '专题');
    assert.equal(ext1.score, '20-25分');
    assert.equal(ext1.difficulty, '★★★★★');
  });

  test('分节行只覆盖一轨且序号列为空时，另一轨同一行的课程不丢失', async () => {
    // 这是双轨 sheet 最容易翻车的地方
    const r = await parseCatalogWorkbook(await buildDualTrackWorkbook(), '高中', load);

    const leaked = r.courses.filter((c) => c.content === '秋季期中阶测');
    assert.deepEqual(leaked, [], '分节行不应进数据');

    const survivor = r.courses.find((c) => c.content === '导数零点问题');
    assert.ok(survivor, '拓展轨在同一行的课程必须保留');
    assert.equal(survivor!.track, '拓展拔尖');
    assert.equal(survivor!.score, '25-30分');
    // 该行序号列为空，恢复出来的课程 seq 记 0
    assert.equal(survivor!.seq, 0);
    // 拓展轨在分节行之前没有自己的分节标题，所以 section 为空
    assert.equal(survivor!.section, '');

    const afterBase = r.courses.find((c) => c.content === '指对数运算');
    assert.ok(afterBase, '基础轨在分节行之后的课程必须保留');
    assert.equal(afterBase!.section, '秋季期中阶测');
  });
});

describe('parseCatalogWorkbook · 异常输入', () => {
  test('没有表头的 sheet 报明确错误，且不炸其它 sheet', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('随便一个sheet');
    ws.getCell(1, 1).value = '这里没有表头';
    ws.getCell(1, 2).value = '一些数据';

    const r = await parseCatalogWorkbook(await workbookBytes(wb), '高中', load);

    assert.equal(r.failedSheets.length, 1);
    assert.equal(r.failedSheets[0], '随便一个sheet');
    assert.equal(r.courses.length, 0);
    assert.match(r.sheets[0].error!, /未找到表头行/);
  });
});
