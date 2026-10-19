import './setup.js';
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { startServer, stopServer, req, url, createUser, createStudent } from './helpers.js';

let token = '';
let otherToken = '';
let student: any = null;
/** 各用例共享的报告与明细 id */
let report: any = null;
let summaryItem: any = null;

before(async () => {
  await startServer();
  token = await createUser('report-teacher');
  otherToken = await createUser('report-other');
  student = await createStudent(token, { name: '一可', grade: '初二', subject: '物理' });
});
after(async () => {
  await stopServer();
});

async function makeReport(overrides: Record<string, any> = {}) {
  const res = await req('POST', '/api/reports', {
    token,
    body: { studentId: student.id, yearMonth: '2026-09', term: '秋季', ...overrides },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.report;
}

describe('月度报告 · 创建与查询', () => {
  test('未登录不能访问', async () => {
    assert.equal((await req('GET', '/api/reports')).status, 401);
  });

  test('年级学科从学生带过来', async () => {
    const r = await makeReport();
    report = r;
    assert.equal(r.student_name, '一可');
    assert.equal(r.grade, '初二');
    assert.equal(r.subject, '物理');
    assert.equal(r.term, '秋季');
    assert.equal(r.year_month, '2026-09');
    // 总结与规划默认都开
    assert.equal(r.summary_enabled, true);
    assert.equal(r.plan_enabled, true);
    assert.equal(r.item_count, 0);
  });

  test('缺少学生返回 400', async () => {
    const res = await req('POST', '/api/reports', { token, body: { yearMonth: '2026-09' } });
    assert.equal(res.status, 400);
  });

  test('月份格式不合法返回 400', async () => {
    for (const bad of ['2026-13', '2026-0', '202609', '九月', '']) {
      const res = await req('POST', '/api/reports', {
        token,
        body: { studentId: student.id, yearMonth: bad },
      });
      assert.equal(res.status, 400, 'bad=' + bad);
    }
  });

  test('别人不存在的学生不能建', async () => {
    const res = await req('POST', '/api/reports', { token, body: { studentId: 999999, yearMonth: '2026-09' } });
    assert.equal(res.status, 404);
  });

  test('同名学生同月重复创建返回已存在那条', async () => {
    const again = await req('POST', '/api/reports', {
      token,
      body: { studentId: student.id, yearMonth: '2026-09', term: '秋季' },
    });
    assert.equal(again.status, 200);
    assert.equal(again.body.duplicated, true);
    assert.equal(again.body.report.id, report.id);
  });

  test('列表默认返回自己的报告，可按学生过滤', async () => {
    await makeReport({ yearMonth: '2026-10' });

    const all = await req('GET', '/api/reports', { token });
    assert.equal(all.status, 200);
    assert.equal(all.body.reports.length, 2);

    const filtered = await req('GET', '/api/reports?studentId=' + student.id, { token });
    assert.equal(filtered.body.reports.length, 2);

    const none = await req('GET', '/api/reports?studentId=424242', { token });
    assert.equal(none.body.reports.length, 0);
  });

  test('其他用户的报告看不到', async () => {
    const res = await req('GET', '/api/reports', { token: otherToken });
    assert.equal(res.status, 200);
    assert.equal(res.body.reports.length, 0);
  });

  test('详情带出明细，按 sort 排序', async () => {
    const id = report.id;
    await req('POST', `/api/reports/${id}/items`, { token, body: { kind: 'plan', content: '第一课' } });
    await req('POST', `/api/reports/${id}/items`, { token, body: { kind: 'plan', content: '第二课' } });

    const res = await req('GET', `/api/reports/${id}`, { token });
    assert.equal(res.status, 200);
    assert.equal(res.body.items.length, 2);
    assert.equal(res.body.items[0].content, '第一课');
    assert.equal(res.body.items[1].content, '第二课');
    assert.deepEqual(res.body.items.map((i: any) => i.sort), [1, 2]);
  });

  test('查不存在的报告返回 404', async () => {
    assert.equal((await req('GET', '/api/reports/999999', { token })).status, 404);
  });
});

describe('月度报告 · 修改', () => {
  test('可以改学期、两个开关与两段摘要、祝福语', async () => {
    const id = report.id;
    const res = await req('PATCH', `/api/reports/${id}`, {
      token,
      body: {
        term: '秋季学期',
        planEnabled: false,
        summaryIntro: '📚课堂情况：本月计划 3 次课\n📖学习内容：透镜成像',
        farewell: '下个月继续加油呀～',
      },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.report.term, '秋季学期');
    assert.equal(res.body.report.plan_enabled, false);
    assert.equal(res.body.report.summary_enabled, true);
    assert.match(res.body.report.summary_intro, /透镜成像/);
    assert.equal(res.body.report.farewell, '下个月继续加油呀～');
  });

  test('月份改成非法值返回 400', async () => {
    const id = report.id;
    const res = await req('PATCH', `/api/reports/${id}`, { token, body: { yearMonth: '2026-99' } });
    assert.equal(res.status, 400);
  });

  test('空 body 返回 400', async () => {
    const id = report.id;
    assert.equal((await req('PATCH', `/api/reports/${id}`, { token, body: {} })).status, 400);
  });

  test('改别人的报告返回 404', async () => {
    const id = report.id;
    assert.equal(
      (await req('PATCH', `/api/reports/${id}`, { token: otherToken, body: { term: '春季' } })).status,
      404
    );
  });
});

describe('明细行', () => {
  test('新增规划行，字段齐全', async () => {
    const id = report.id;
    const res = await req('POST', `/api/reports/${id}/items`, {
      token,
      body: {
        kind: 'plan',
        seq: 3,
        content: '眼睛与眼镜',
        type: '同步',
        score: '8-10',
        difficulty: '★★★★★',
        scheduledAt: '2026-09-13',
      },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const it = res.body.item;
    assert.equal(it.kind, 'plan');
    assert.equal(it.content, '眼睛与眼镜');
    assert.equal(it.type, '同步');
    assert.equal(it.score, '8-10');
    assert.equal(it.difficulty, '★★★★★');
    assert.equal(it.scheduled_at, '2026-09-13');
    assert.equal(it.sort, 3);
  });

  test('新增总结行可以带出勤与考试情况', async () => {
    const id = report.id;
    const res = await req('POST', `/api/reports/${id}/items`, {
      token,
      body: {
        kind: 'summary',
        content: '凸透镜成像的规律探究',
        type: '同步',
        scheduledAt: '2026-09-13',
        attendance: '请假',
        notesDone: '✅️',
        mistakesDone: '✅️',
        homeworkDone: '✅️',
        exam: '/',
      },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.item.attendance, '请假');
    assert.equal(res.body.item.exam, '/');
    summaryItem = res.body.item;
  });

  test('新增行可以带 course_id（从目录取课时记下来源）', async () => {
    const res = await req('POST', `/api/reports/${report.id}/items`, {
      token,
      body: { kind: 'summary', content: '目录里的课', courseId: 4242 },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.item.course_id, 4242);

    // camelCase 与 snake_case 都认
    const camel = await req('POST', `/api/reports/${report.id}/items`, {
      token,
      body: { kind: 'plan', content: '又一条', course_id: 77 },
    });
    assert.equal(camel.body.item.course_id, 77);
  });

  test('非法的 course_id 一律落 null，不会把脏值写进库里', async () => {
    for (const bad of [0, -5, 1.5, 'abc', '', null]) {
      const res = await req('POST', `/api/reports/${report.id}/items`, {
        token,
        body: { kind: 'plan', content: '脏值校验', courseId: bad },
      });
      assert.equal(res.status, 200, 'courseId=' + JSON.stringify(bad));
      assert.equal(res.body.item.course_id, null, 'courseId=' + JSON.stringify(bad));
    }
  });

  test('可以改单格，也可以把来源课程清成 null', async () => {
    const res = await req('POST', `/api/reports/${report.id}/items`, {
      token,
      body: { kind: 'plan', content: '手输替换掉目录课', courseId: 999 },
    });
    const itemId = res.body.item.id;

    const cleared = await req('PATCH', `/api/reports/${report.id}/items/${itemId}`, {
      token,
      body: { courseId: null },
    });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.item.course_id, null);
  });

  test('行类型不合法返回 400', async () => {
    const id = report.id;
    for (const bad of ['summarys', 'PLAN', '', 'other']) {
      const res = await req('POST', `/api/reports/${id}/items`, { token, body: { kind: bad } });
      assert.equal(res.status, 400, 'kind=' + bad);
    }
  });

  test('可以在明细里改单格', async () => {
    const id = report.id;
    const itemId = summaryItem.id;
    const res = await req('PATCH', `/api/reports/${id}/items/${itemId}`, {
      token,
      body: { attendance: '补', exam: 87 },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.item.attendance, '补');
    assert.equal(String(res.body.item.exam), '87');
  });

  test('上移下移可以调整顺序', async () => {
    const id = report.id;
    const list = (await req('GET', `/api/reports/${id}`, { token })).body.items;
    const before = list.map((i: any) => i.content);

    // 把第 3 行上移
    const res = await req('POST', `/api/reports/${id}/items/move`, {
      token,
      body: { itemId: list[2].id, dir: 'up' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.moved, true);
    const after = res.body.items.map((i: any) => i.content);
    assert.notDeepEqual(before, after);
    // 交换相邻两项，长度不变
    assert.equal(after.length, before.length);
    assert.equal(after[1], before[2]);
    assert.equal(after[2], before[1]);

    // 移到最上面后再上移，不应该越界
    const top = res.body.items[0];
    const stay = await req('POST', `/api/reports/${id}/items/move`, {
      token,
      body: { itemId: top.id, dir: 'up' },
    });
    assert.equal(stay.body.moved, false);
  });

  test('删除一行明细', async () => {
    const id = report.id;
    const list = (await req('GET', `/api/reports/${id}`, { token })).body.items;
    const target = list[0];

    const del = await req('DELETE', `/api/reports/${id}/items/${target.id}`, { token });
    assert.equal(del.status, 200);
    assert.equal(del.body.deleted, 1);

    const again = await req('GET', `/api/reports/${id}`, { token });
    assert.equal(again.body.items.length, list.length - 1);
    assert.ok(!again.body.items.some((i: any) => i.id === target.id));
  });

  test('删别人的明细返回 404', async () => {
    const id = report.id;
    const list = (await req('GET', `/api/reports/${id}`, { token })).body.items;
    if (!list.length) return;
    assert.equal(
      (await req('DELETE', `/api/reports/${id}/items/${list[0].id}`, { token: otherToken })).status,
      404
    );
  });
});

describe('阶测安排自动生成', () => {
  test('规划里还没有上课时间时拒绝', async () => {
    const fresh = await makeReport({ yearMonth: '2027-01', term: '寒假' });
    const res = await req('POST', `/api/reports/${fresh.id}/exams`, { token, body: {} });
    assert.equal(res.status, 422);
    assert.match(res.body.error, /计划上课时间/);
  });

  test('按排课跨度自动推算，可以直接落库', async () => {
    const fresh = await makeReport({ yearMonth: '2026-10', term: '秋季' });

    // 10 月 7 次课的排期，跨度 09-30 → 11-16
    const plan = [
      { seq: 1, content: '凸透镜成像的规律应用', scheduledAt: '2026-09-30' },
      { seq: 2, content: '眼睛与眼镜', scheduledAt: '2026-10-01' },
      { seq: 3, content: '第5章总复习', scheduledAt: '2026-10-02' },
      { seq: 4, content: '质量和体积的测量', scheduledAt: '2026-10-17' },
      { seq: 5, content: '测量固体、液体的密度', scheduledAt: '2026-10-24' },
      { seq: 6, content: '密度与生活', scheduledAt: '2026-10-31' },
      { seq: 7, content: '第六章章节复习', scheduledAt: '2026-11-16' },
    ];
    for (const row of plan) {
      await req('POST', `/api/reports/${fresh.id}/items`, {
        token,
        body: { kind: 'plan', ...row },
      });
    }

    const res = await req('POST', `/api/reports/${fresh.id}/exams`, { token, body: { insert: true } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.startDate, '2026-09-30');
    assert.equal(res.body.endDate, '2026-11-16');
    assert.ok(res.body.suggestions.length >= 2);
    assert.equal(res.body.inserted, res.body.suggestions.length);
    assert.match(res.body.suggestions[0].content, /^秋季度第一次阶测安排：.*时间\d+月\d+日：$/);

    const items = (await req('GET', `/api/reports/${fresh.id}`, { token })).body.items;
    const exams = items.filter((i: any) => i.kind === 'exam');
    assert.equal(exams.length, res.body.suggestions.length);
    for (const e of exams) {
      assert.ok(/阶测安排/.test(e.content));
      assert.match(e.scheduled_at, /^\d{4}-\d{2}-\d{2}$/);
    }
  });

  test('可以手动指定跨度，不传 insert 就不落库', async () => {
    const fresh = await makeReport({ yearMonth: '2026-07', term: '暑假' });
    const res = await req('POST', `/api/reports/${fresh.id}/exams`, {
      token,
      body: { startDate: '2026-07-06', endDate: '2026-08-31' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.suggestions.length, 4);
    assert.equal(res.body.inserted, 0);
    assert.equal(res.body.suggestions[0].content, '暑假第一次阶测安排：时间7月20日：');

    const items = (await req('GET', `/api/reports/${fresh.id}`, { token })).body.items;
    assert.equal(items.length, 0, '不传 insert 不应落库');
  });

  test('跨度太短排不下一次阶测', async () => {
    const fresh = await makeReport({ yearMonth: '2026-11', term: '春季' });
    const res = await req('POST', `/api/reports/${fresh.id}/exams`, {
      token,
      body: { startDate: '2026-11-01', endDate: '2026-11-20' },
    });
    assert.equal(res.status, 422);
    assert.match(res.body.error, /跨度不够/);
  });

  test('每场阶测带上它覆盖的课，落库后文案里也带着', async () => {
    // yearMonth 要用别的用例没占过的月份：同月报告是 upsert，撞了会把上一条用例的规划带进来
    const fresh = await makeReport({ yearMonth: '2025-09', term: '秋季' });
    for (const row of [
      { kind: 'plan', content: '整式的加减', scheduledAt: '2026-09-08' },
      { kind: 'plan', content: '一元一次方程', scheduledAt: '2026-09-15' },
      { kind: 'plan', content: '二元一次方程组', scheduledAt: '2026-09-29' },
      { kind: 'summary', content: '本月总结', scheduledAt: '2026-09-01' },
    ]) {
      await req('POST', `/api/reports/${fresh.id}/items`, { token, body: row });
    }

    const res = await req('POST', `/api/reports/${fresh.id}/exams`, { token, body: { insert: true } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.startDate, '2026-09-08');
    assert.equal(res.body.endDate, '2026-09-29');
    assert.equal(res.body.suggestions.length, 1);
    assert.deepEqual(
      res.body.suggestions[0].courses.map((c: any) => c.content),
      ['整式的加减', '一元一次方程', '二元一次方程组']
    );
    assert.equal(res.body.suggestions[0].courseCount, 3);
    assert.equal(
      res.body.suggestions[0].content,
      '秋季度第一次阶测安排：覆盖整式的加减、一元一次方程、二元一次方程组（共3课）；时间9月29日：'
    );

    // 覆盖写进阶测行文案，Excel 导出的日期解析靠它，不能被覆盖文案挤掉
    const items = (await req('GET', `/api/reports/${fresh.id}`, { token })).body.items;
    const exams = items.filter((i: any) => i.kind === 'exam');
    assert.equal(exams.length, 1);
    assert.match(exams[0].content, /覆盖整式的加减.*9月29日：/);
    assert.equal(exams[0].scheduled_at, '2026-09-29');
  });

  test('手输跨度但规划里有课，覆盖照样算出来', async () => {
    const fresh = await makeReport({ yearMonth: '2026-07', term: '暑假' });
    await req('POST', `/api/reports/${fresh.id}/items`, {
      token,
      body: { kind: 'plan', content: '声现象', scheduledAt: '2026-07-10' },
    });
    const res = await req('POST', `/api/reports/${fresh.id}/exams`, {
      token,
      body: { startDate: '2026-07-06', endDate: '2026-08-31' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.suggestions.length, 4);
    assert.equal(res.body.inserted, 0);
    assert.equal(res.body.suggestions[0].coverage, '覆盖声现象（共1课）');
  });
});

describe('删除整块报告', () => {
  test('连带删掉它的明细', async () => {
    const fresh = await makeReport({ yearMonth: '2026-06', term: '春季' });
    await req('POST', `/api/reports/${fresh.id}/items`, { token, body: { kind: 'plan', content: '课程A' } });
    await req('POST', `/api/reports/${fresh.id}/items`, { token, body: { kind: 'exam', content: '阶段测试' } });

    const del = await req('DELETE', `/api/reports/${fresh.id}`, { token });
    assert.equal(del.status, 200);
    assert.equal(del.body.deleted, 1);
    assert.equal(del.body.itemsDeleted, 2);

    assert.equal((await req('GET', `/api/reports/${fresh.id}`, { token })).status, 404);
    const list = await req('GET', '/api/reports?studentId=' + student.id, { token });
    assert.ok(!list.body.reports.some((r: any) => r.id === fresh.id));
  });

  test('删别人的报告无效果', async () => {
    const fresh = await makeReport({ yearMonth: '2027-02', term: '春季' });
    const del = await req('DELETE', `/api/reports/${fresh.id}`, { token: otherToken });
    assert.equal(del.body.deleted, 0);
    assert.equal((await req('GET', `/api/reports/${fresh.id}`, { token })).status, 200);
  });
});

describe('导出 Excel', () => {
  async function downloadXlsx(id: number, auth: string) {
    const res = await fetch(url(`/api/reports/${id}/xlsx`), {
      headers: auth ? { Authorization: 'Bearer ' + auth } : undefined,
    });
    return { status: res.status, headers: res.headers, buf: Buffer.from(await res.arrayBuffer()) };
  }

  test('返回 xlsx 二进制与下载头', async () => {
    const res = await downloadXlsx(report.id, token);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const disp = res.headers.get('content-disposition') || '';
    assert.match(disp, /filename\*=UTF-8/);
    assert.ok(decodeURIComponent(disp.split("''")[1]).endsWith('.xlsx'));
    // xlsx 是 zip，magic 是 PK
    assert.equal(res.buf.subarray(0, 2).toString(), 'PK');
    assert.ok(res.buf.length > 2000);
  });

  test('文件名带学生名与学期年级学科', async () => {
    const fresh = await makeReport({ yearMonth: '2026-03', term: '春季' });
    const res = await downloadXlsx(fresh.id, token);
    const name = decodeURIComponent((res.headers.get('content-disposition') || '').split("''")[1]);
    assert.equal(name, '一可 春季初二物理 3月总结与4月规划.xlsx');
  });

  test('月份标题以 year_month 为准，不会被手动上移的跨月明细带跑', async () => {
    // 用独立的年月，避开共享报告被别的用例改过 term 的情况
    const fresh = await makeReport({ yearMonth: '2026-04', term: '秋季' });
    // 报告挂在 4 月名下。总结里既有 4 月的课也有 5 月的课，
    // 把 5 月那条上移到最前面 —— 标题必须还是「4月总结」，不能变成「5月总结」。
    await req('POST', `/api/reports/${fresh.id}/items`, {
      token,
      body: { kind: 'summary', content: '4月的课', scheduledAt: '2026-04-06', type: '同步' },
    });
    const may = await req('POST', `/api/reports/${fresh.id}/items`, {
      token,
      body: { kind: 'summary', content: '5月的课', scheduledAt: '2026-05-03', type: '同步' },
    });
    await req('POST', `/api/reports/${fresh.id}/items`, {
      token,
      body: { kind: 'plan', content: '5月规划课', scheduledAt: '2026-05-17' },
    });

    const moved = await req('POST', `/api/reports/${fresh.id}/items/move`, {
      token,
      body: { itemId: may.body.item.id, dir: 'up' },
    });
    assert.equal(moved.status, 200);
    assert.equal(moved.body.moved, true, '必须先真的把 5 月的课上移，测试才有意义');

    const res = await downloadXlsx(fresh.id, token);
    assert.equal(res.status, 200);
    const name = decodeURIComponent((res.headers.get('content-disposition') || '').split("''")[1]);
    assert.equal(name, '一可 秋季初二物理 4月总结与5月规划.xlsx');

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.buf as unknown as ArrayBuffer);
    const ws = wb.getWorksheet(1)!;

    // 版式：总结标题在第 1 行；规划标题位置随总结条数浮动，按内容找
    assert.equal(ws.getCell(1, 1).text, '一可 秋季初二物理 4月总结');
    const titles: string[] = [];
    for (let n = 1; n <= ws.rowCount; n++) titles.push((ws.getRow(n).getCell(1).text as string) || '');
    assert.ok(titles.includes('一可 秋季初二物理 5月规划'), '规划块标题应为 5月规划，实际标题: ' + JSON.stringify(titles));
    assert.ok(!titles.some((t) => /5月总结/.test(t)), '总结标题不应被上移的 5 月课带成 5月');
  });

  test('未登录 401、非法 id 400、不存在 404', async () => {
    assert.equal((await downloadXlsx(report.id, '')).status, 401);
    assert.equal((await req('GET', '/api/reports/abc/xlsx', { token })).status, 400);
    assert.equal((await req('GET', '/api/reports/999999/xlsx', { token })).status, 404);
  });

  test('别人建不了的报告导不出', async () => {
    const res = await downloadXlsx(report.id, otherToken);
    assert.equal(res.status, 404);
  });

  test('关掉规划开关时导出的文件里没有规划区块', async () => {
    const fresh = await makeReport({ yearMonth: '2026-12', term: '秋季' });
    await req('PATCH', `/api/reports/${fresh.id}`, { token, body: { planEnabled: false } });
    await req('POST', `/api/reports/${fresh.id}/items`, {
      token,
      body: { kind: 'summary', content: '光的反射', scheduledAt: '2026-12-05', type: '同步' },
    });
    await req('POST', `/api/reports/${fresh.id}/items`, {
      token,
      body: { kind: 'plan', content: '不该出现', scheduledAt: '2027-01-02' },
    });

    const res = await downloadXlsx(fresh.id, token);
    assert.equal(res.status, 200);
    // 规划开关关了，文件名也不能再提规划区块
    assert.equal(
      decodeURIComponent((res.headers.get('content-disposition') || '').split("''")[1]),
      '一可 秋季初二物理 12月总结.xlsx'
    );
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.buf as unknown as ArrayBuffer);
    const ws = wb.getWorksheet(1)!;
    assert.equal(ws.getCell(1, 1).text, '一可 秋季初二物理 12月总结');
    assert.equal(ws.getCell(3, 1).text, '序号');
    assert.equal(ws.getCell(4, 2).text, '光的反射');
    assert.equal(ws.getCell(4, 6).text, '12月5日');
    // 只剩总结块 4 行
    assert.equal(ws.rowCount, 4);
  });

  test('两个开关都关掉时文件名退化成「总结与规划.xlsx」', async () => {
    const fresh = await makeReport({ yearMonth: '2027-01', term: '寒假' });
    await req('PATCH', `/api/reports/${fresh.id}`, { token, body: { summaryEnabled: false, planEnabled: false } });
    await req('POST', `/api/reports/${fresh.id}/items`, {
      token,
      body: { kind: 'summary', content: '寒假的课', scheduledAt: '2027-01-05' },
    });

    const res = await downloadXlsx(fresh.id, token);
    assert.equal(res.status, 200);
    assert.equal(
      decodeURIComponent((res.headers.get('content-disposition') || '').split("''")[1]),
      '一可 寒假初二物理 总结与规划.xlsx'
    );
  });
});
