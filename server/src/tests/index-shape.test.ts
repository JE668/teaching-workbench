import './setup.js';
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { db, initDatabase } from '../config/database.js';

/**
 * 课程目录索引形状。
 *
 * 背景：#40 把目录改成全局共享（所有账号看同一份），`courseFilter` 不再带 user_id。
 * 于是原来 user_id 打头的三个索引全成了死索引——查询用不上，但每次写入
 * （尤其是启动时批量灌 3589 条内置目录）都要白更新几棵 B-tree。
 */
function indexColumns(name: string): string[] {
  return (db.prepare('PRAGMA index_info(' + name + ')').all() as any[]).map((r) => r.name);
}

function indexExists(name: string): boolean {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'index' AND name = ?")
    .get(name) as { n: number };
  return row.n === 1;
}

before(() => {
  initDatabase();
});

describe('课程目录索引', () => {
  test('三个目录索引都不再按 user_id 打头', () => {
    assert.ok(!indexExists('idx_course_catalog_user'), 'user_id 单列索引应该被删掉');
    assert.deepEqual(indexColumns('idx_course_catalog_filter'), ['grade', 'subject', 'term']);
    assert.deepEqual(indexColumns('idx_course_catalog_content'), [
      'band',
      'grade',
      'subject',
      'track',
      'term',
      'seq',
    ]);
  });

  test('跨账号去重用的索引不带 user_id（保持原样）', () => {
    assert.deepEqual(indexColumns('idx_course_catalog_dedupe'), [
      'band',
      'grade',
      'subject',
      'track',
      'term',
      'seq',
      'content',
    ]);
  });

  test('initDatabase 可重复执行，索引形状不变', () => {
    initDatabase();
    initDatabase();
    assert.deepEqual(indexColumns('idx_course_catalog_filter'), ['grade', 'subject', 'term']);
    assert.ok(!indexExists('idx_course_catalog_user'));
  });

  test('旧库的 user_id 打头索引会被自动订正', () => {
    // 模拟 #40 之前的库
    db.exec('DROP INDEX IF EXISTS idx_course_catalog_filter');
    db.exec(
      'CREATE INDEX idx_course_catalog_filter ON course_catalog(user_id, grade, subject, term)'
    );
    assert.deepEqual(indexColumns('idx_course_catalog_filter'), [
      'user_id',
      'grade',
      'subject',
      'term',
    ]);

    initDatabase();

    assert.deepEqual(indexColumns('idx_course_catalog_filter'), ['grade', 'subject', 'term']);
  });
});
