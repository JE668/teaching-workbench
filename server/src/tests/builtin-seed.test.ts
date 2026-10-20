import './setup.js';
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { startServer, stopServer, req, createUser } from './helpers.js';
import {
  seedBuiltInCatalog,
  seedDir,
  BUILTIN_CATALOGS,
  CATALOG_SYSTEM_USER,
  type SeedResult,
} from '../seed/builtinCatalog.js';

let token = '';
let otherToken = '';
let seedResult: SeedResult;
let builtinIds: number[] = [];
let primaryParsed = 0; // 小初文件解析出的课程数
let totalInserted = 0; // 两份文件去重后真正入库的条数

before(async () => {
  await startServer();
  token = await createUser('catalog-shared-teacher');
  otherToken = await createUser('catalog-shared-other');

  seedResult = await seedBuiltInCatalog({ force: true });
  const list = await req('GET', '/api/catalog/imports', { token });
  builtinIds = list.body.imports.map((i: any) => i.id);
  totalInserted = list.body.imports.reduce((n: number, i: any) => n + i.courses_imported, 0);
  primaryParsed = list.body.imports
    .filter((i: any) => i.band === '小初')
    .reduce((n: number, i: any) => n + i.courses_total, 0);
});
after(async () => {
  await stopServer();
});

/** 目录页看到的课程总数 */
async function courseCount(authToken: string): Promise<number> {
  const res = await req('GET', '/api/catalog/courses', { token: authToken });
  return res.body.total;
}

describe('内置课程目录灌库', () => {
  test('两份全年目录都灌进库，重复行被去重', async () => {
    assert.equal(seedResult.imports, BUILTIN_CATALOGS.length);
    assert.equal(seedResult.skipped, '');
    assert.equal(seedResult.courses, totalInserted);
    assert.ok(totalInserted > 3000, '两份全年目录应该有几千条课程，实际 ' + totalInserted);

    // 小初文件里五年级英语的秋季那一块被复制粘贴了两遍，18 条会被判重——
    // 这是源文件的问题，去重口径是对的，所以入库数略小于解析数。
    const list = await req('GET', '/api/catalog/imports', { token });
    const parsed = list.body.imports.reduce((n: number, i: any) => n + i.courses_total, 0);
    const duplicated = list.body.imports.reduce((n: number, i: any) => n + i.courses_duplicated, 0);
    assert.equal(totalInserted + duplicated, parsed);
    assert.equal(duplicated, 18);
  });

  test('重复灌库是幂等的，不会重复灌', async () => {
    const again = await seedBuiltInCatalog({ force: true });
    assert.deepEqual(again, { imports: 0, courses: 0, skipped: '' });

    const list = await req('GET', '/api/catalog/imports', { token });
    assert.equal(list.body.imports.length, 2);
    assert.equal(await courseCount(token), totalInserted);
  });

  test('任何账号都能看到全量目录，不再按人隔离', async () => {
    assert.equal(await courseCount(token), totalInserted);
    assert.equal(await courseCount(otherToken), totalInserted);
  });

  test('导入历史带上导入人和内置标记', async () => {
    const list = await req('GET', '/api/catalog/imports', { token });
    assert.equal(list.body.imports.length, 2);
    for (const im of list.body.imports) {
      assert.equal(im.is_builtin, true);
      assert.equal(im.importer, CATALOG_SYSTEM_USER);
    }
  });

  test('内置课程目录不能删除', async () => {
    for (const id of builtinIds) {
      const del = await req('DELETE', '/api/catalog/imports/' + id, { token });
      assert.equal(del.status, 403);
      assert.match(del.body.error, /内置/);
    }
  });

  test('内置目录里能正常改掌握星级', async () => {
    const list = await req('GET', '/api/catalog/courses', { token });
    const id = list.body.courses[0].id;
    const patch = await req('PATCH', '/api/catalog/courses/' + id, { token, body: { mastery_star: 4 } });
    assert.equal(patch.status, 200);
    assert.equal(patch.body.course.mastery_star, 4);
    await req('PATCH', '/api/catalog/courses/' + id, { token, body: { mastery_star: null } });
  });
});

describe('目录全局共享后的去重口径', () => {
  test('老师再传一遍同一份文件，全部判为重复', async () => {
    const bytes = readFileSync(join(seedDir(), '2026-2027-primary.xlsx'));
    const fd = new FormData();
    fd.append(
      'file',
      new Blob([bytes as any], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      '2026-2027个性化小初全年课程体系目录.xlsx'
    );
    fd.append('band', '小初');

    const res = await req('POST', '/api/catalog/import', { token, raw: fd });
    assert.equal(res.status, 200);
    // 中文文件名不能被 multer 的 latin1 解码搞成乱码
    assert.equal(res.body.filename, '2026-2027个性化小初全年课程体系目录.xlsx');
    assert.equal(res.body.coursesTotal, primaryParsed);
    assert.equal(res.body.coursesImported, 0);
    assert.equal(res.body.coursesDuplicated, primaryParsed);
    assert.equal(res.body.failedSheets.length, 0);

    // 目录总数不变——第二份文件一条都没加进去
    assert.equal(await courseCount(token), totalInserted);
  });

  test('自己导入的记录可以删除，不影响内置目录', async () => {
    const list = await req('GET', '/api/catalog/imports', { token });
    const mine = list.body.imports.find((i: any) => i.is_builtin === false);
    assert.ok(mine, '应该有一条用户自己导入的记录');
    // 导入人带出来，好知道哪份是谁传的
    assert.equal(mine.importer, 'catalog-shared-teacher');
    assert.equal(mine.is_builtin, false);

    const del = await req('DELETE', '/api/catalog/imports/' + mine.id, { token });
    assert.equal(del.status, 200);
    assert.equal(del.body.deleted, 0);

    assert.equal(await courseCount(token), totalInserted);
  });
});

describe('目录排序口径', () => {
  test('筛选项按教学顺序排，不是字典序', async () => {
    const res = await req('GET', '/api/catalog/facets', { token });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.grades, ['四年级', '五年级', '六年级', '初一', '初二', '初三', '高一', '高二', '高三']);
    assert.deepEqual(res.body.terms, ['暑假', '秋季', '寒假', '春季', '一轮复习', '二轮复习', '三轮复习']);
    assert.deepEqual(res.body.tracks, ['基础', '进阶', '拓展拔尖']);
  });

  test('课程清单按年级→学科→学期→轨→序号排', async () => {
    const res = await req('GET', '/api/catalog/courses', { token });
    const courses = res.body.courses;
    assert.ok(courses.length > 3000);
    assert.equal(courses[0].grade, '四年级');
    assert.equal(courses[courses.length - 1].grade, '高三');

    // 初中不能排在小学前面（SQLite 默认字典序会把「初一」排在「四年级」前面）
    const idxSixth = courses.findIndex((c: any) => c.grade === '六年级');
    const idxJunior1 = courses.findIndex((c: any) => c.grade === '初一');
    assert.ok(idxSixth < idxJunior1, '六年级应在初一之前');

    // 同一 (年级, 学科, 学期, 轨) 分组内按序号升序
    const group = courses.filter(
      (c: any) => c.grade === '初一' && c.subject === '数学' && c.term === '暑假' && c.track === '基础'
    );
    assert.ok(group.length > 0);
    for (let i = 1; i < group.length; i++) {
      assert.ok(group[i].seq >= group[i - 1].seq, '分组内序号应递增');
    }
  });
});

// ============ 批量删除导入 ============

/** 造一份单轨两课的目录，sheet 名带标记好区分 */
async function miniCatalog(worksheet: string, content: string): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(worksheet);
  const set = (r: number, c: number, v: string) => {
    ws.getCell(r, c).value = v;
  };
  ws.mergeCells(1, 1, 1, 6);
  set(1, 1, '星火教育个性化  高二数学  春季  课程目录');
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
  set(5, 2, '1');
  set(5, 3, content + '（第 1 课）');
  set(5, 4, '专题');
  set(5, 5, '★★');
  set(5, 6, '★★★');
  set(6, 2, '2');
  set(6, 3, content + '（第 2 课）');
  set(6, 4, '专题');
  set(6, 5, '★★★');
  set(6, 6, '★★★★');
  return await wb.xlsx.writeBuffer() as any;
}

async function uploadMini(tokenStr: string, worksheet: string, content: string): Promise<{ id: number; courses: number }> {
  const fd = new FormData();
  fd.append(
    'file',
    new Blob([await miniCatalog(worksheet, content) as any], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    'mini.xlsx'
  );
  fd.append('band', '高中');
  const res = await req('POST', '/api/catalog/import', { token: tokenStr, raw: fd });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return { id: res.body.importId, courses: res.body.coursesImported };
}

describe('批量删除导入', () => {
  test('非法入参直接 400', async () => {
    for (const body of [{}, { ids: [] }, { ids: 'x' }, { ids: [0, -1] }, { ids: ['abc'] }]) {
      const res = await req('DELETE', '/api/catalog/imports/batch', { token, body });
      assert.equal(res.status, 400, JSON.stringify(body) + ' -> ' + JSON.stringify(res.body));
      assert.equal(typeof res.body.error, 'string');
    }
  });

  test('batch 不会被当成 :id 吃掉', async () => {
    // 如果路由顺序写反了，这里会走 DELETE /imports/:id 报「非法的导入 id」
    const res = await req('DELETE', '/api/catalog/imports/batch', { token, body: { ids: [9999999] } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.deleted, 0);
    assert.equal(res.body.removed.length, 0);
    assert.equal(res.body.skipped.length, 1);
    assert.equal(res.body.skipped[0].reason, '已不存在');
  });

  test('一次删掉多条用户导入，内置目录和已不存在的 id 被跳过并上报', async () => {
    const a = await uploadMini(token, '高二数学春季甲', '甲题');
    const b = await uploadMini(otherToken, '高二数学春季乙', '乙题');
    assert.equal(a.courses, 2);
    assert.equal(b.courses, 2);
    const before = await courseCount(token);

    const res = await req('DELETE', '/api/catalog/imports/batch', {
      token,
      body: { ids: [a.id, b.id, builtinIds[0], 9999999] },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.deleted, 4);
    assert.deepEqual(res.body.removed, [a.id, b.id]);
    assert.equal(res.body.skipped.length, 2);
    const reasons = res.body.skipped.map((s: any) => s.reason).sort();
    assert.deepEqual(reasons, ['内置目录不能删除', '已不存在']);

    // 两份用户目录的课程都清掉了，内置的还在
    assert.equal(await courseCount(token), before - 4);
    const list = await req('GET', '/api/catalog/imports', { token });
    assert.equal(list.body.imports.length, 2);
    for (const im of list.body.imports) assert.equal(im.is_builtin, true);
  });

  test('全部 id 都是内置时不删任何东西', async () => {
    const before = await courseCount(token);
    const res = await req('DELETE', '/api/catalog/imports/batch', {
      token,
      body: { ids: builtinIds },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.deleted, 0);
    assert.deepEqual(res.body.removed, []);
    assert.equal(res.body.skipped.length, builtinIds.length);
    assert.equal(await courseCount(token), before);
  });
});
