import './setup.js';
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { startServer, stopServer, req, createUser } from './helpers.js';

/**
 * 续费看板端到端测试。
 *
 * 核心验证点是「学生网格颜色状态」的复刻：Excel 里的条件格式算不出结果，
 * 解析时必须按同一判定链重算。这里造一份含全部状态分支的 xlsx，
 * 断言解析出的 status 与优先级顺序一致。
 */

let token = '';

/** 造一份覆盖颜色判定全部分支的 xlsx */
function buildWorkbook(): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();

  // ===== 教师统计表(激励)：表头第 3 行，数据第 5 行起，学生网格从 O 列(15) =====
  const wsT = wb.addWorksheet('教师统计表(激励)');
  const header: Record<number, string> = {
    2: '教师', 3: '工号', 4: '科组', 5: '学生基数', 6: '预存人数',
    7: '整体预存率', 8: '续科人数', 10: '系统续科率', 13: '激励差额',
  };
  Object.entries(header).forEach(([c, v]) => wsT.getRow(3).getCell(Number(c)).value = v);
  // 两行教师，验证科组对比会正确归并
  wsT.getRow(5).values = [null, '张老师', 'T001', '数学组', 10, 4, '40%', 3];
  wsT.getRow(5).getCell(13).value = 2;
  wsT.getRow(5).getCell(15).value = '学生A';
  wsT.getRow(5).getCell(16).value = '学生B';
  wsT.getRow(5).getCell(17).value = '学生C';
  wsT.getRow(5).getCell(18).value = '学生D';
  wsT.getRow(6).values = [null, '李老师', 'T002', '数学组', 5, 1, '20%', 0];
  wsT.getRow(6).getCell(15).value = '学生E';

  // ===== 老师学生：L=学生状态(12)，O=预存状态(15) =====
  const wsTS = wb.addWorksheet('老师学生');
  [
    ['张老师', '学生A', '在读'],
    ['张老师', '学生B', '在读'],
    ['张老师', '学生C', '结课'],   // 优先级最高：即便续科率标"是"也应判 closed
    ['张老师', '学生D', '在读'],
    ['李老师', '学生E', '停课'],
  ].forEach((row, i) => {
    const r = 2 + i;
    wsTS.getRow(r).getCell(2).value = row[0];
    wsTS.getRow(r).getCell(3).value = row[1];
    wsTS.getRow(r).getCell(12).value = row[2];
  });
  // O 列预存状态：学生E 走第二条预存路径
  wsTS.getRow(6).getCell(15).value = '是';

  // ===== 续科率：F=老师(6) H=学生(8) V=本月是否续科(22) AA=预存(27) =====
  const wsXK = wb.addWorksheet('续科率');
  [
    ['张老师', '学生A', '是', '否'],
    ['张老师', '学生B', '否', '是'],
    ['张老师', '学生C', '是', '否'],
  ].forEach((row, i) => {
    const r = 2 + i;
    wsXK.getRow(r).getCell(6).value = row[0];
    wsXK.getRow(r).getCell(8).value = row[1];
    wsXK.getRow(r).getCell(22).value = row[2];
    wsXK.getRow(r).getCell(27).value = row[3];
  });

  // ===== 在读学生明细：J=学生(10) L=年级(12) =====
  const wsSD = wb.addWorksheet('在读学生明细');
  [[ '学生A', '初一' ], [ '学生B', '初二' ], [ '学生D', '高三' ]].forEach((row, i) => {
    wsSD.getRow(2 + i).getCell(10).value = row[0];
    wsSD.getRow(2 + i).getCell(12).value = row[1];
  });

  // ===== 续生率：标题区 + A:R 主表 =====
  const wsR = wb.addWorksheet('续生率');
  wsR.getRow(1).getCell(1).value = '小榄龙山学习中心 2026年11月';
  [
    ['张学管', 'S001', '学生F', '初一', '是', '否', '是'],
    ['张学管', 'S002', '学生G', '初二', '否', '是', '否'],
    ['张学管', 'S003', '学生H', '高三', '是', '否', '否'],
  ].forEach((row, i) => {
    const r = 2 + i;
    wsR.getRow(r).getCell(5).value = row[0];   // E 学管师
    wsR.getRow(r).getCell(8).value = row[1];    // H 学生编号
    wsR.getRow(r).getCell(9).value = row[2];    // I 学生
    wsR.getRow(r).getCell(10).value = row[3];   // J 年级
    wsR.getRow(r).getCell(16).value = row[4];   // P 上1个月是否有课消
    wsR.getRow(r).getCell(17).value = row[5];   // Q 上2个月是否有课消
    wsR.getRow(r).getCell(18).value = row[6];    // R 本月是否续费
  });

  // ===== 学管业绩统计表：表头两行，数据第 5 行起 =====
  const wsP = wb.addWorksheet('学管业绩统计表');
  wsP.getRow(5).getCell(1).value = '张学管';
  wsP.getRow(5).getCell(6).value = 12000;   // F 续费汇总
  wsP.getRow(5).getCell(11).value = 3000;    // K 新签汇总
  wsP.getRow(5).getCell(12).value = 8;      // L 续生数
  wsP.getRow(5).getCell(13).value = 20;     // M 前2月辅导学生数
  wsP.getRow(5).getCell(14).value = '40%';  // N 续生率
  wsP.getRow(5).getCell(15).value = 500000; // O 任务
  wsP.getRow(5).getCell(16).value = 420000; // P 现金流合计
  wsP.getRow(5).getCell(17).value = '84%';  // Q 完成率

  return wb;
}

async function uploadWorkbook(wb: ExcelJS.Workbook, name: string) {
  // exceljs 的 Buffer 声明遮蔽了 node 全局 Buffer，这里跟仓库其它测试一致地跳过类型
  // exceljs 的 Buffer 声明遮蔽了 node 全局 Buffer，跟仓库其它上传测试一致地跳过类型
  const buf = await wb.xlsx.writeBuffer() as any;
  const form = new FormData();
  form.append('file', new Blob([buf as any], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }), name);
  return req('POST', '/api/renewal/upload', { token, raw: form });
}

before(async () => {
  await startServer();
  token = await createUser('renewal-user');
});
after(async () => {
  await stopServer();
});

describe('续费看板', () => {
  test('未登录访问被拒', async () => {
    const r = await req('GET', '/api/renewal/reports');
    assert.equal(r.status, 401);
  });

  test('上传后能列出报表并带出月份与中心名', async () => {
    const up = await uploadWorkbook(buildWorkbook(), '续费统计表.xlsx');
    assert.equal(up.status, 201, JSON.stringify(up.body));
    const reportId = (up.body.report as any).reportId as number;
    assert.ok(reportId > 0);
    assert.equal((up.body.report as any).statMonth, '2026-11');
    assert.equal((up.body.report as any).centerName, '小榄龙山学习中心');

    const list = await req('GET', '/api/renewal/reports', { token });
    assert.equal(list.status, 200);
    assert.equal((list.body.reports as any[]).length, 1);
    // 中文文件名不能是 mojibake
    assert.equal((list.body.reports[0] as any).fileName, '续费统计表.xlsx');
  });

  test('教师统计明细：指标 + 学生网格颜色状态按优先级复刻', async () => {
    const r = await req('GET', '/api/renewal/dashboard/teacher-stats?tab=incentive', { token });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const rows = r.body.rows as any[];
    assert.equal(rows.length, 2);

    const zhang = rows.find(x => x.teacherName === '张老师')!;
    assert.equal(zhang.subjectGroup, '数学组');
    assert.equal(zhang.baseCount, 10);
    assert.equal(zhang.prepaidCount, 4);
    assert.equal(zhang.renewedCount, 3);
    assert.equal(zhang.studentCount, 4);

    // 颜色状态：判定链优先级 结课 > 续费 > 预存 > 高三
    const byName = Object.fromEntries(zhang.students.map((s: any) => [s.name, s.status]));
    assert.equal(byName['学生A'], 'renewed', '续科率 V 列"是"→ 已续费（绿）');
    assert.equal(byName['学生B'], 'prepaid', '续科率 AA 列"是"→ 已预存（紫）');
    assert.equal(byName['学生C'], 'closed', '老师学生 L 列结课优先于续科率标记');
    assert.equal(byName['学生D'], 'grade3', '在读学生明细年级高三');
  });

  test('学生网格状态分布', async () => {
    const r = await req('GET', '/api/renewal/analytics/student-status', { token });
    assert.equal(r.status, 200);
    const rows = r.body.rows as any[];
    const total = rows.reduce((s, x) => s + x.count, 0);
    assert.equal(total, 5);   // 张老师 4 个 + 李老师 1 个
    const stopped = rows.find(x => x.status === 'stopped');
    assert.ok(stopped, '李老师的学生E 应判为停课');
  });

  test('科组对比把同科组老师归并', async () => {
    const r = await req('GET', '/api/renewal/analytics/group-compare?tab=incentive', { token });
    assert.equal(r.status, 200);
    const rows = r.body.rows as any[];
    assert.equal(rows.length, 1);
    const math = rows[0];
    assert.equal(math.subjectGroup, '数学组');
    assert.equal(math.teacherCount, 2);
    assert.equal(math.baseCount, 15);
    assert.equal(math.prepaidCount, 5);
  });

  test('学管业绩读出现金流大数', async () => {
    const r = await req('GET', '/api/renewal/analytics/manager-perf', { token });
    assert.equal(r.status, 200);
    const rows = r.body.rows as any[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0].managerName, '张学管');
    assert.equal(rows[0].renew.total, 12000);
    assert.equal(rows[0].taskAmount, 500000, 'O 列"任务"是现金流大数，不是人数');
    assert.equal(rows[0].cashflowTotal, 420000);
  });

  test('续生漏斗按学管聚合', async () => {
    const r = await req('GET', '/api/renewal/analytics/funnel', { token });
    assert.equal(r.status, 200);
    const rows = r.body.rows as any[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0].managerName, '张学管');
    assert.equal(rows[0].students, 3);
    assert.equal(rows[0].renewed, 1);
    assert.ok(Math.abs(rows[0].renewRate - 33.33) < 0.01);
  });

  test('风险清单只收"未续费且上1个月无课消"的学生', async () => {
    const r = await req('GET', '/api/renewal/analytics/risk-list', { token });
    assert.equal(r.status, 200);
    const rows = r.body.rows as any[];
    const names = rows.map(x => x.studentName);
    assert.ok(!names.includes('学生F'), '已续费的学生F 不应进风险清单');
    assert.ok(names.includes('学生G'), '学生G 上1个月无课消且未续费，应入选');
    assert.ok(!names.includes('学生H'), '学生H 上1个月有课消，不算风险');
  });

  test('删除报表后明细级联清空', async () => {
    const list = await req('GET', '/api/renewal/reports', { token });
    const reportId = (list.body.reports[0] as any).reportId as number;
    const del = await req('DELETE', '/api/renewal/reports/' + reportId, { token });
    assert.equal(del.status, 200);

    const empty = await req('GET', '/api/renewal/reports', { token });
    assert.equal((empty.body.reports as any[]).length, 0);
    // 没有报表时看板返回 404，而不是 500
    const dash = await req('GET', '/api/renewal/dashboard/teacher-stats?tab=incentive', { token });
    assert.equal(dash.status, 404);
  });

  test('删除不存在的报表返回 404', async () => {
    const r = await req('DELETE', '/api/renewal/reports/99999', { token });
    assert.equal(r.status, 404);
  });

  test('非法 tab 返回 400 而不是 500', async () => {
    const up = await uploadWorkbook(buildWorkbook(), '再传一份.xlsx');
    assert.equal(up.status, 201);
    const r = await req('GET', '/api/renewal/dashboard/teacher-stats?tab=bogus', { token });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /tab/);
  });

  test('上传非 xlsx 被拒', async () => {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array([1, 2, 3])], { type: 'text/plain' }), 'a.txt');
    const r = await req('POST', '/api/renewal/upload', { token, raw: form });
    assert.equal(r.status, 400);
  });

  test('缺少文件字段返回 400', async () => {
    const form = new FormData();
    const r = await req('POST', '/api/renewal/upload', { token, raw: form });
    assert.equal(r.status, 400);
  });
});
