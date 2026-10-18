import './setup.js';
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { startServer, stopServer, req, createUser } from './helpers.js';

let token = '';
let otherToken = '';
let importId = 0;

before(async () => {
  await startServer();
  token = await createUser('catalog-teacher');
  otherToken = await createUser('catalog-other');
});
after(async () => {
  await stopServer();
});

// ============ 造一份最小可用的课程目录 ============

/** 单轨 sheet：一个分区、两行表头、一条课程。足够验证导入链路 */
async function catalogXlsx(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('高一语文');
  const set = (r: number, c: number, v: string) => {
    ws.getCell(r, c).value = v;
  };

  ws.mergeCells(1, 1, 1, 6);
  set(1, 1, '星火教育个性化  高一语文  暑假  课程目录');
  ws.mergeCells(2, 1, 2, 6);
  set(2, 1, '【XX月课程规划】……');

  ws.mergeCells(3, 1, 4, 1);
  ws.mergeCells(3, 2, 4, 2);
  set(3, 1, '教材版本');
  set(3, 2, '序号');
  set(3, 3, '辅导内容');
  set(3, 4, '课程类型');
  set(3, 5, '学习难度');
  set(3, 6, '对后续课程影响程度');

  ws.mergeCells(5, 1, 6, 1);
  set(5, 1, '人教版（2024）');
  set(5, 2, '1'); set(5, 3, '古代诗歌鉴赏'); set(5, 4, '专题'); set(5, 5, '★★'); set(5, 6, '★★★');
  set(6, 2, '2'); set(6, 3, '记叙文写作'); set(6, 4, '专题'); set(6, 5, '★★★'); set(6, 6, '★★★★');

  return await wb.xlsx.writeBuffer() as any;
}

function form(bytes: Uint8Array, extra: Record<string, string> = {}) {
  const fd = new FormData();
  fd.append('file', new Blob([bytes as any], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'course-catalog.xlsx');
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  return fd;
}

describe('课程目录导入', () => {
  test('未登录不能导入', async () => {
    const res = await req('POST', '/api/catalog/import', { raw: form(await catalogXlsx(), { band: '高中' }) });
    assert.equal(res.status, 401);
  });

  test('没有文件返回 400', async () => {
    const res = await req('POST', '/api/catalog/import', { token, raw: new FormData() });
    assert.equal(res.status, 400);
  });

  test('非 xlsx 被拒绝', async () => {
    const fd = new FormData();
    fd.append('file', new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], { type: '' }), 'catalog.txt');
    const res = await req('POST', '/api/catalog/import', { token, raw: fd });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /xlsx/);
  });

  test('缺学段返回 400', async () => {
    const res = await req('POST', '/api/catalog/import', { token, raw: form(await catalogXlsx()) });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /学段/);
  });

  test('dryRun 只预览不落库', async () => {
    const res = await req('POST', '/api/catalog/import', { token, raw: form(await catalogXlsx(), { band: '高中', dryRun: '1' }) });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.dryRun, true);
    assert.equal(res.body.coursesTotal, 2);
    assert.deepEqual(res.body.failedSheets, []);
    assert.equal(res.body.sheets[0].courses, 2);

    const list = await req('GET', '/api/catalog/courses', { token });
    assert.equal(list.status, 200);
    assert.equal(list.body.total, 0, 'dryRun 不应落库');
  });

  test('正式导入成功，返回导入统计', async () => {
    const res = await req('POST', '/api/catalog/import', { token, raw: form(await catalogXlsx(), { band: '高中' }) });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.coursesTotal, 2);
    assert.equal(res.body.coursesImported, 2);
    assert.equal(res.body.coursesDuplicated, 0);
    assert.ok(res.body.importId > 0);
    assert.match(res.body.sha256, /^[0-9a-f]{64}$/);
    importId = res.body.importId;
  });

  test('导入的课程可以查出来，字段已归一化', async () => {
    const list = await req('GET', '/api/catalog/courses', { token });
    assert.equal(list.status, 200);
    assert.equal(list.body.total, 2);

    const c = list.body.courses.find((x: any) => x.content === '古代诗歌鉴赏');
    assert.ok(c);
    assert.equal(c.grade, '高一');
    assert.equal(c.subject, '语文');
    assert.equal(c.term, '暑假');
    assert.equal(c.band, '高中');
    assert.equal(c.type, '专题');
    assert.equal(c.difficulty, '★★');
    assert.equal(c.impact, '★★★');
    assert.equal(c.textbook, '人教版');
    assert.equal(c.seq, 1);
    assert.equal(c.mastery_star, null);
  });

  test('重复导入同一文件不会重复灌库', async () => {
    const res = await req('POST', '/api/catalog/import', { token, raw: form(await catalogXlsx(), { band: '高中' }) });
    assert.equal(res.status, 200);
    assert.equal(res.body.coursesImported, 0);
    assert.equal(res.body.coursesDuplicated, 2);

    const list = await req('GET', '/api/catalog/courses', { token });
    assert.equal(list.body.total, 2, '重复导入后条数不应变化');
  });
});

describe('课程目录查询', () => {
  test('按年级 / 学科 / 学期筛选', async () => {
    const all = await req('GET', '/api/catalog/courses', { token });
    assert.equal(all.body.total, 2);

    const g = await req('GET', '/api/catalog/courses?grade=%E9%AB%98%E4%B8%80', { token });
    assert.equal(g.body.total, 2);

    const math = await req('GET', '/api/catalog/courses?subject=%E6%95%B0%E5%AD%A6', { token });
    assert.equal(math.body.total, 0);

    const q = await req('GET', '/api/catalog/courses?q=%E5%8F%A4%E4%BB%A3%E8%AF%97%E6%AD%8C', { token });
    assert.equal(q.body.total, 1);
    assert.equal(q.body.courses[0].content, '古代诗歌鉴赏');
  });

  test('facets 给出筛选项取值', async () => {
    const res = await req('GET', '/api/catalog/facets', { token });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.grades, ['高一']);
    assert.deepEqual(res.body.subjects, ['语文']);
    assert.deepEqual(res.body.terms, ['暑假']);
    assert.deepEqual(res.body.types, ['专题']);
    assert.deepEqual(res.body.textbooks, ['人教版']);
    assert.deepEqual(res.body.tracks, []);
  });

  test('不同用户的数据互不可见', async () => {
    const res = await req('GET', '/api/catalog/courses', { token: otherToken });
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 0);
  });
});

describe('掌握星级手改', () => {
  test('可以设置 1-5 的星级', async () => {
    const list = await req('GET', '/api/catalog/courses', { token });
    const id = list.body.courses[0].id;

    const res = await req('PATCH', '/api/catalog/courses/' + id, { token, body: { mastery_star: 4 } });
    assert.equal(res.status, 200);
    assert.equal(res.body.course.mastery_star, 4);

    const again = await req('GET', '/api/catalog/courses', { token });
    assert.equal(again.body.courses[0].mastery_star, 4);
  });

  test('超出范围被拒绝', async () => {
    const list = await req('GET', '/api/catalog/courses', { token });
    const id = list.body.courses[0].id;

    for (const bad of [0, 6, -1, 'abc']) {
      const res = await req('PATCH', '/api/catalog/courses/' + id, { token, body: { mastery_star: bad } });
      assert.equal(res.status, 400, 'bad=' + bad);
    }
  });

  test('星级可以清空', async () => {
    const list = await req('GET', '/api/catalog/courses', { token });
    const id = list.body.courses[0].id;

    const res = await req('PATCH', '/api/catalog/courses/' + id, { token, body: { mastery_star: null } });
    assert.equal(res.status, 200);
    assert.equal(res.body.course.mastery_star, null);
  });

  test('可以顺手改分节', async () => {
    const list = await req('GET', '/api/catalog/courses', { token });
    const id = list.body.courses[0].id;

    const res = await req('PATCH', '/api/catalog/courses/' + id, { token, body: { section: '秋季第一次阶段性测试' } });
    assert.equal(res.status, 200);
    assert.equal(res.body.course.section, '秋季第一次阶段性测试');
  });

  test('改别人的课程会 404', async () => {
    const list = await req('GET', '/api/catalog/courses', { token });
    const id = list.body.courses[0].id;

    const res = await req('PATCH', '/api/catalog/courses/' + id, { token: otherToken, body: { mastery_star: 3 } });
    assert.equal(res.status, 404);
  });

  test('空 body 返回 400', async () => {
    const res = await req('PATCH', '/api/catalog/courses/1', { token, body: {} });
    assert.equal(res.status, 400);
  });
});

describe('导入历史与删除', () => {
  test('导入历史按时间倒序', async () => {
    const res = await req('GET', '/api/catalog/imports', { token });
    assert.equal(res.status, 200);
    assert.equal(res.body.imports.length, 2);
    assert.equal(res.body.imports[0].band, '高中');
    assert.equal(res.body.imports[0].courses_imported, 0);
    assert.equal(res.body.imports[1].courses_imported, 2);
    assert.ok(Array.isArray(res.body.imports[0].failed_sheets));
  });

  test('删除一次导入会连带删掉它导入的课程', async () => {
    const before = await req('GET', '/api/catalog/courses', { token });
    assert.equal(before.body.total, 2);

    const del = await req('DELETE', '/api/catalog/imports/' + importId, { token });
    assert.equal(del.status, 200);
    assert.equal(del.body.deleted, 2);

    const after = await req('GET', '/api/catalog/courses', { token });
    assert.equal(after.body.total, 0);

    const list = await req('GET', '/api/catalog/imports', { token });
    assert.equal(list.body.imports.length, 1);
  });

  test('删除不存在的导入不影响数据', async () => {
    const del = await req('DELETE', '/api/catalog/imports/999999', { token });
    assert.equal(del.status, 200);
    assert.equal(del.body.deleted, 0);
  });
});
