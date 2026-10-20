import './setup.js';
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../config/database.js';
import {
  dedupeCourseCatalog,
  lastDedupeAt,
  CATALOG_DEDUPE_VERSION,
} from '../migrations/catalogDedupe.js';
import { startServer, stopServer, req, createUser } from './helpers.js';

/**
 * 课程目录去重。
 *
 * 背景：#40 之前目录按账号隔离、去重键里带 user_id；改成全局共享后，
 * 早期导入的行和内置灌库的行是同一门课、却各自占一份，页面上就是
 * 「内置 3589 条 + 自己导的 3589 条」叠成七千多条。
 */

let token = '';
let uid = 0;
let studentId = 0;

/** 直接落库一条导入记录（走导入接口太慢，这里只关心去重） */
function addImport(filename: string, sha: string, isBuiltin = 0): number {
  return db
    .prepare(
      `INSERT INTO catalog_imports (user_id, band, filename, file_sha256, courses_total, courses_imported, courses_duplicated, failed_sheets, is_builtin)
       VALUES (?, ?, ?, ?, 2, 2, 0, '[]', ?)`
    )
    .run(uid, '小初', filename, sha, isBuiltin)
    .lastInsertRowid as number;
}

/** 直接落库一条课程。默认是「初二物理秋季第 1 课 声现象」，用 over 覆盖 */
function addCourse(importId: number, over: Record<string, unknown> = {}): number {
  const c = {
    user_id: uid,
    import_id: importId,
    band: '小初',
    term: '秋季',
    grade: '初二',
    subject: '物理',
    track: '',
    seq: 1,
    content: '声现象',
    type: '同步',
    score: '',
    difficulty: '★★',
    impact: '',
    textbook: '人教版',
    section: '',
    sheet: '初二物理',
    source_row: 5,
    ...over,
  };
  return db
    .prepare(
      `INSERT INTO course_catalog
         (user_id, import_id, band, term, grade, subject, track, seq, content,
          type, score, difficulty, impact, textbook, section, sheet, source_row)
       VALUES
         (@user_id, @import_id, @band, @term, @grade, @subject, @track, @seq, @content,
          @type, @score, @difficulty, @impact, @textbook, @section, @sheet, @source_row)`
    )
    .run(c)
    .lastInsertRowid as number;
}

/** 落库一条指向某门课的月度总结明细，用来验「引用被改指」 */
function addReportItem(courseId: number): number {
  const reportId = db
    .prepare(
      `INSERT INTO monthly_reports (user_id, student_id, year_month, term, grade, subject)
       VALUES (?, ?, '2026-10', '秋季', '初二', '物理')`
    )
    .run(uid, studentId)
    .lastInsertRowid as number;
  return db
    .prepare(
      `INSERT INTO report_items (user_id, report_id, kind, seq, content, course_id)
       VALUES (?, ?, 'summary', 1, '上月已上课程', ?)`
    )
    .run(uid, reportId, courseId)
    .lastInsertRowid as number;
}

const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;

before(async () => {
  await startServer();
  token = await createUser('catalog-dedupe-teacher');
  const row = db.prepare('SELECT id FROM users WHERE username = ?').get('catalog-dedupe-teacher') as {
    id: number;
  };
  uid = row.id;
  studentId = db
    .prepare(`INSERT INTO students (user_id, name, grade, subject) VALUES (?, '去重学生', '初二', '物理')`)
    .run(uid)
    .lastInsertRowid as number;
});

after(async () => {
  await stopServer();
});

// 用例之间互不串扰：目录、导入记录、留痕都清空重来（保留测试账号和学生）
beforeEach(() => {
  db.exec('DELETE FROM course_catalog');
  db.exec('DELETE FROM report_items');
  db.exec('DELETE FROM monthly_reports');
  db.exec('DELETE FROM observations');
  db.exec('DELETE FROM catalog_imports');
  db.prepare('DELETE FROM schema_migrations WHERE name = ?').run(CATALOG_DEDUPE_VERSION);
});

describe('dedupeCourseCatalog', () => {
  test('同一门课两份时合并成一条，优先留系统内置那份', () => {
    const mine = addImport('我自己导的目录.xlsx', 'a'.repeat(64));
    const builtin = addImport('2026-2027个性化小初全年课程体系目录.xlsx', 'b'.repeat(64), 1);

    // 用户的行 id 更小，但保留的应该是内置那份
    const mineA = addCourse(mine);
    const mineB = addCourse(mine, { seq: 2, content: '物态变化' });
    const builtinA = addCourse(builtin, { textbook: '沪科版' });
    const builtinB = addCourse(builtin, { seq: 2, content: '物态变化' });

    const r = dedupeCourseCatalog({ force: true });
    assert.equal(r.groups, 2);
    assert.equal(r.removed, 2);
    assert.equal(r.fresh, true);

    const kept = db.prepare('SELECT id, textbook FROM course_catalog ORDER BY seq').all() as any[];
    assert.deepEqual(
      kept.map((k) => k.id).sort(),
      [builtinA, builtinB].sort()
    );
    // 保留行带着内置那份的字段（教材版本没被用户的行覆盖）
    assert.equal(kept.find((k) => k.id === builtinA).textbook, '沪科版');
    assert.equal(count('SELECT COUNT(*) AS n FROM course_catalog'), 2);
  });

  test('指向重复行的月度总结被改指到保留行，不变成孤儿', () => {
    const mine = addImport('用户目录.xlsx', 'c'.repeat(64));
    const builtin = addImport('内置目录.xlsx', 'd'.repeat(64), 1);
    const mineRow = addCourse(mine);
    const builtinRow = addCourse(builtin);
    const item = addReportItem(mineRow);

    const r = dedupeCourseCatalog({ force: true });
    assert.equal(r.removed, 1);
    assert.equal(r.reassigned, 1);

    const row = db.prepare('SELECT course_id FROM report_items WHERE id = ?').get(item) as {
      course_id: number;
    };
    assert.equal(row.course_id, builtinRow, '应该指向保留下来的那一条');
    assert.ok(!db.prepare('SELECT id FROM course_catalog WHERE id = ?').get(mineRow));
  });

  test('课程内容带空格差异也算同一门课', () => {
    const a = addImport('带空格.xlsx', 'e'.repeat(64));
    const b = addImport('没空格.xlsx', 'f'.repeat(64));
    const withSpace = addCourse(a, { content: '光现象 ' });
    addCourse(b, { content: '光现象' });

    const r = dedupeCourseCatalog({ force: true });
    assert.equal(r.removed, 1);
    // 都不是内置时留最早的（id 最小）
    const kept = db.prepare('SELECT id FROM course_catalog').all() as { id: number }[];
    assert.deepEqual(kept.map((k) => k.id), [withSpace]);
  });

  test('合并后一条课都不剩的导入记录会被清掉', () => {
    const gone = addImport('完全重复的那份.xlsx', '1'.repeat(64));
    const kept = addImport('保留的那份.xlsx', '2'.repeat(64), 1);
    addCourse(gone, { seq: 3, content: '电学入门' });
    addCourse(kept, { seq: 3, content: '电学入门' });

    const r = dedupeCourseCatalog({ force: true });
    assert.equal(r.importsRemoved, 1);
    const rows = db
      .prepare('SELECT id FROM catalog_imports WHERE id IN (?, ?)')
      .all(gone, kept) as { id: number }[];
    assert.deepEqual(rows.map((x) => x.id), [kept]);
  });

  test('幂等：跑过一次后按留痕跳过，不再动数据', () => {
    const a = addImport('第一份.xlsx', '3'.repeat(64));
    const b = addImport('第二份.xlsx', '4'.repeat(64), 1);
    addCourse(a, { seq: 4, content: '热现象' });
    addCourse(b, { seq: 4, content: '热现象' });

    const first = dedupeCourseCatalog({ force: true });
    assert.equal(first.removed, 1);

    // 再造一批重复行，不传 force 就不该动它们
    const c = addImport('第三份.xlsx', '5'.repeat(64));
    addCourse(c, { seq: 5, content: '压强' });
    addCourse(b, { seq: 5, content: '压强' });
    const skipped = dedupeCourseCatalog();
    assert.equal(skipped.removed, 0);
    assert.equal(skipped.fresh, false);
    assert.ok(lastDedupeAt());
    assert.equal(count('SELECT COUNT(*) AS n FROM course_catalog'), 3, '未传 force 时不该合并');

    assert.ok(
      db.prepare('SELECT name FROM schema_migrations WHERE name = ?').get(CATALOG_DEDUPE_VERSION),
      '应该留痕'
    );
  });

  test('没有重复时返回全 0', () => {
    const im = addImport('干净.xlsx', '6'.repeat(64));
    addCourse(im, { seq: 6, content: '唯一的一门课' });

    const r = dedupeCourseCatalog({ force: true });
    assert.deepEqual({ groups: r.groups, removed: r.removed, reassigned: r.reassigned }, {
      groups: 0,
      removed: 0,
      reassigned: 0,
    });
    assert.equal(count('SELECT COUNT(*) AS n FROM course_catalog'), 1);
  });
});

describe('POST /api/catalog/dedupe', () => {
  test('手工入口能跑，并把结果带回来', async () => {
    const a = addImport('用户那份.xlsx', '7'.repeat(64));
    const b = addImport('内置那份.xlsx', '8'.repeat(64), 1);
    addCourse(a, { seq: 7, content: '力的合成' });
    addCourse(b, { seq: 7, content: '力的合成' });

    const res = await req('POST', '/api/catalog/dedupe', { token });
    assert.equal(res.status, 200);
    assert.equal(res.body.removed, 1);
    assert.equal(count('SELECT COUNT(*) AS n FROM course_catalog'), 1);
  });
  test('未登录 401', async () => {
    assert.equal((await req('POST', '/api/catalog/dedupe')).status, 401);
  });
});
