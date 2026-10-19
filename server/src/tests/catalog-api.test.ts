import './setup.js';
import { test, before, after, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { startServer, stopServer, req, createUser, createStudent, url } from './helpers.js';
import { setStarGenerator, resetStarGenerator } from '../services/catalogStar.js';

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
beforeEach(() => {
  resetStarGenerator();
});

/** 收一条 SSE 流：返回状态码与解析后的事件序列 */
async function collectSse(
  path: string,
  body: unknown = {},
  authToken?: string
): Promise<{ status: number; contentType: string | null; events: { event: string; data: any }[]; raw: string }> {
  const res = await fetch(url(path), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: 'Bearer ' + authToken } : {}),
    },
    body: JSON.stringify(body),
  });
  const contentType = res.headers.get('content-type');
  const raw = await res.text();
  if (!contentType || !contentType.includes('text/event-stream')) {
    return { status: res.status, contentType, events: [], raw };
  }
  const events = raw
    .split('\n\n')
    .map((f) => f.trim())
    .filter(Boolean)
    .map((frame) => {
      const ev = /^event:\s*(.+)$/m.exec(frame);
      const data = /^data:\s*(.+)$/m.exec(frame);
      let parsed: any = null;
      try {
        parsed = data ? JSON.parse(data[1]) : null;
      } catch {
        parsed = data ? data[1] : null;
      }
      return { event: ev ? ev[1] : 'message', data: parsed };
    });
  return { status: res.status, contentType, events, raw };
}

/** 把目录下所有课程的星级清空，保证「未定档」场景可控 */
async function clearStars(): Promise<number[]> {
  const list = await req('GET', '/api/catalog/courses', { token });
  const ids: number[] = [];
  for (const c of list.body.courses) {
    if (c.mastery_star !== null) {
      await req('PATCH', '/api/catalog/courses/' + c.id, { token, body: { mastery_star: null } });
    }
    ids.push(c.id);
  }
  return ids;
}

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

describe('掌握星级 AI 初评', () => {
  test('未登录不能定档', async () => {
    const sse = await collectSse('/api/catalog/courses/suggest-stars', {});
    assert.equal(sse.status, 401);
    assert.ok(!String(sse.contentType || '').includes('text/event-stream'), '未登录不应返回 SSE');
  });

  test('SSE 下发 start / progress / done，并把星级落库', async () => {
    await clearStars();
    const list = await req('GET', '/api/catalog/courses', { token });
    const ids: number[] = list.body.courses.map((c: any) => c.id);
    setStarGenerator(async () =>
      JSON.stringify({ results: ids.map((id, i) => ({ id, star: 3 + (i % 2) })) })
    );

    const sse = await collectSse('/api/catalog/courses/suggest-stars', {}, token);
    assert.equal(sse.status, 200);
    assert.ok(String(sse.contentType).includes('text/event-stream'));

    const names = sse.events.map((e) => e.event);
    assert.deepEqual(names, ['start', 'progress', 'done']);
    assert.equal(sse.events[0].data.total, 2);
    assert.equal(sse.events[1].data.batch, 1);
    assert.equal(sse.events[1].data.totalBatches, 1);
    assert.equal(sse.events[2].data.updated, 2);

    const after = await req('GET', '/api/catalog/courses', { token });
    assert.ok(after.body.courses.every((c: any) => c.mastery_star === 3 || c.mastery_star === 4));
  });

  test('默认只补未定档的，手改过的不会被 AI 覆盖', async () => {
    const ids = await clearStars();
    const [a, b] = ids;
    await req('PATCH', '/api/catalog/courses/' + a, { token, body: { mastery_star: 4 } });

    setStarGenerator(async () =>
      JSON.stringify({ results: [{ id: a, star: 1 }, { id: b, star: 2 }] })
    );
    const sse = await collectSse('/api/catalog/courses/suggest-stars', {}, token);
    assert.equal(sse.events[0].data.total, 1, '应只处理未定档的那门');
    assert.equal(sse.events[2].data.updated, 1);

    const after = await req('GET', '/api/catalog/courses', { token });
    const byId = Object.fromEntries(after.body.courses.map((c: any) => [c.id, c.mastery_star]));
    assert.equal(byId[a], 4, '手改的 4 星不应被 AI 改成 1 星');
    assert.equal(byId[b], 2);
  });

  test('onlyEmpty=false 会覆盖已有星级', async () => {
    const ids = await clearStars();
    const [a, b] = ids;
    await req('PATCH', '/api/catalog/courses/' + a, { token, body: { mastery_star: 4 } });

    setStarGenerator(async () => JSON.stringify({ results: [{ id: a, star: 2 }, { id: b, star: 3 }] }));
    const sse = await collectSse('/api/catalog/courses/suggest-stars', { onlyEmpty: false }, token);
    assert.equal(sse.events[0].data.onlyEmpty, false);
    assert.equal(sse.events[0].data.total, 2);

    const after = await req('GET', '/api/catalog/courses', { token });
    const byId = Object.fromEntries(after.body.courses.map((c: any) => [c.id, c.mastery_star]));
    assert.equal(byId[a], 2);
    assert.equal(byId[b], 3);
  });

  test('没有未定档的课程时不下发 progress', async () => {
    const ids = await clearStars();
    for (const id of ids) {
      await req('PATCH', '/api/catalog/courses/' + id, { token, body: { mastery_star: 3 } });
    }
    let called = 0;
    setStarGenerator(async () => {
      called++;
      return '{"results":[]}';
    });

    const sse = await collectSse('/api/catalog/courses/suggest-stars', {}, token);
    assert.deepEqual(
      sse.events.map((e) => e.event),
      ['start', 'done']
    );
    assert.equal(sse.events[0].data.total, 0);
    assert.equal(sse.events[1].data.updated, 0);
    assert.equal(called, 0, '不该请求模型');
  });

  test('按筛选范围取数，并受 limit 限制', async () => {
    await clearStars();
    setStarGenerator(async () => '{"results":[]}');

    const math = await collectSse('/api/catalog/courses/suggest-stars', { subject: '数学' }, token);
    assert.equal(math.events[0].data.total, 0, '没有数学课');

    const limited = await collectSse('/api/catalog/courses/suggest-stars', { limit: 1 }, token);
    assert.equal(limited.events[0].data.total, 1, 'limit=1 只取一门');
    assert.equal(limited.events[0].data.limit, 1);
  });

  test('别人的账号看不到别人的课程', async () => {
    await clearStars();
    setStarGenerator(async () => '{"results":[]}');
    const sse = await collectSse('/api/catalog/courses/suggest-stars', {}, otherToken);
    assert.equal(sse.status, 200);
    assert.equal(sse.events[0].data.total, 0);
    assert.equal(sse.events[1].data.updated, 0);
  });

  test('模型失败时下发 error 事件，不写库', async () => {
    await clearStars();
    setStarGenerator(async () => {
      const err = new Error('request timed out');
      Object.assign(err, { name: 'APIConnectionTimeoutError' });
      throw err;
    });

    const sse = await collectSse('/api/catalog/courses/suggest-stars', {}, token);
    assert.deepEqual(sse.events.map((e) => e.event), ['start', 'error']);
    assert.match(sse.events[1].data.error, /超时/);

    const after = await req('GET', '/api/catalog/courses', { token });
    assert.ok(after.body.courses.every((c: any) => c.mastery_star === null), '失败批次不应落库');
  });
});

describe('目录 ↔ 报告打通：课程使用情况', () => {
  let student: any = null;
  let courseId = 0;

  before(async () => {
    // 注意：本块要放在「导入历史与删除」之前 —— 那里会删掉全部课程
    student = await createStudent(token, { name: '打通小明', grade: '高二', subject: '物理' });
    const cs = await req('GET', '/api/catalog/courses', { token });
    assert.equal(cs.status, 200);
    assert.ok(cs.body.courses.length >= 1, '前序用例应已导入课程');
    courseId = cs.body.courses[0].id;
  });

  test('还没有任何报告时返回空映射', async () => {
    const res = await req('GET', '/api/catalog/usage', { token });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.usage, {});
  });

  test('未登录 401', async () => {
    assert.equal((await req('GET', '/api/catalog/usage')).status, 401);
  });

  test('能按课程聚合出已上/计划次数与学生明细，阶测行不计入', async () => {
    const mk = (body: any) => req('POST', '/api/reports', { token, body });
    const r1 = await mk({ studentId: student.id, yearMonth: '2026-09', term: '秋季' });
    const r2 = await mk({ studentId: student.id, yearMonth: '2026-10', term: '秋季' });

    const put = (reportId: number, body: any) =>
      req('POST', `/api/reports/${reportId}/items`, { token, body });

    await put(r1.body.report.id, { kind: 'summary', content: 'A', courseId });
    await put(r1.body.report.id, { kind: 'summary', content: 'A', courseId });
    await put(r1.body.report.id, { kind: 'plan', content: 'A', courseId });
    await put(r1.body.report.id, { kind: 'exam', content: '阶测安排', courseId });
    await put(r2.body.report.id, { kind: 'plan', content: 'A', courseId });
    // 手输的内容（没带 course_id）不该出现在聚合里
    await put(r1.body.report.id, { kind: 'summary', content: '临时加的课' });

    const res = await req('GET', '/api/catalog/usage', { token });
    assert.equal(res.status, 200);
    const u = res.body.usage[String(courseId)];
    assert.ok(u, '应聚合出这门课的使用情况');
    assert.equal(u.course_id, courseId);
    assert.equal(u.taught, 2);
    assert.equal(u.planned, 2);
    assert.equal(u.entries.length, 4);
    for (const e of u.entries) {
      assert.equal(e.student_name, '打通小明');
      assert.ok(e.year_month === '2026-09' || e.year_month === '2026-10');
      assert.ok(e.kind === 'summary' || e.kind === 'plan');
    }
  });

  test('别人的报告里的用量看不到', async () => {
    // 另一个账号拿同一个 courseId 造一条明细（外键不校验，正好测隔离）
    const otherStudent = await createStudent(otherToken, { name: '隔壁班同学' });
    const otherReport = await req('POST', '/api/reports', {
      token: otherToken,
      body: { studentId: otherStudent.id, yearMonth: '2026-09' },
    });
    await req('POST', `/api/reports/${otherReport.body.report.id}/items`, {
      token: otherToken,
      body: { kind: 'summary', content: 'A', courseId },
    });

    const res = await req('GET', '/api/catalog/usage', { token });
    const u = res.body.usage[String(courseId)];
    for (const e of u.entries) assert.equal(e.student_name, '打通小明');

    const otherView = await req('GET', '/api/catalog/usage', { token: otherToken });
    assert.equal(otherView.body.usage[String(courseId)].taught, 1);
    assert.equal(otherView.body.usage[String(courseId)].entries[0].student_name, '隔壁班同学');
  });

  test('传 student_id 只算这个学生的进度，非法值回退全量聚合', async () => {
    const second = await createStudent(token, { name: '进度小红', grade: '高二', subject: '物理' });
    const rep = await req('POST', '/api/reports', {
      token,
      body: { studentId: second.id, yearMonth: '2026-11', term: '秋季' },
    });
    await req('POST', `/api/reports/${rep.body.report.id}/items`, {
      token,
      body: { kind: 'summary', content: 'A', courseId },
    });
    await req('POST', `/api/reports/${rep.body.report.id}/items`, {
      token,
      body: { kind: 'plan', content: 'A', courseId },
    });

    const mine = await req('GET', `/api/catalog/usage?student_id=${second.id}`, { token });
    assert.equal(mine.status, 200);
    const u = mine.body.usage[String(courseId)];
    assert.ok(u, '这个学生的用量也应聚合出来');
    assert.equal(u.taught, 1);
    assert.equal(u.planned, 1);
    assert.equal(u.entries.length, 2);
    for (const e of u.entries) {
      assert.equal(e.student_id, second.id);
      assert.equal(e.student_name, '进度小红');
      assert.equal(e.year_month, '2026-11');
    }

    // 另一个学生的口径里看不到小红那两个月
    const otherMine = await req('GET', `/api/catalog/usage?student_id=${student.id}`, { token });
    const u2 = otherMine.body.usage[String(courseId)];
    assert.ok(u2);
    for (const e of u2.entries) {
      assert.equal(e.student_id, student.id);
      assert.notEqual(e.year_month, '2026-11');
    }

    // 非法值一律忽略，回退成全量聚合
    for (const bad of ['0', '-1', 'abc', '', '1.5']) {
      const r = await req('GET', '/api/catalog/usage?student_id=' + bad, { token });
      assert.equal(r.status, 200);
      assert.ok(
        r.body.usage[String(courseId)].entries.length > u.entries.length,
        'student_id=' + bad + ' 应回退成全量聚合'
      );
    }
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
