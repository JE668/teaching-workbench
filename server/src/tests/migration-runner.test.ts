import './setup.js';
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { db, initDatabase } from '../config/database.js';
import { getMigrationStatus } from '../migrations/runner.js';

/**
 * 版本化迁移运行器。
 *
 * initDatabase() 每次启动都会调用 migrateUp()，所以这里直接对同一个测试库断言：
 *  - 所有迁移都已应用（user_version 推到最大）
 *  - 重复执行是幂等的（skipped 全量）
 *  - status() 报告的 applied 与 PRAGMA user_version 一致
 */
before(async () => {
  await initDatabase();
});

describe('版本化迁移运行器', () => {
  test('全部迁移已应用，version 推到最大（序号 = 迁移数）', async () => {
    const status = await getMigrationStatus();
    assert.ok(status.migrations.length >= 4, '至少应有 4 个迁移，实际 ' + status.migrations.length);
    const unapplied = status.migrations.filter((m) => !m.applied);
    assert.deepEqual(unapplied, [], '不应有未应用的迁移');

    // user_version 存的是「序号」，不是时间戳（时间戳超 int32 会静默归零）
    const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
    assert.equal(row.user_version, status.migrations.length, 'user_version 应等于迁移总数（最新序号）');
  });

  test('迁移按版本号升序排列', async () => {
    const status = await getMigrationStatus();
    const versions = status.migrations.map((m) => m.version);
    const sorted = [...versions].sort();
    assert.deepEqual(versions, sorted, '迁移应按文件名（版本号）升序执行');
  });

  test('重复执行 migrateUp 幂等：全部 skipped，不重复应用', async () => {
    const { migrateUp } = await import('../migrations/runner.js');
    const r1 = await migrateUp();
    assert.deepEqual(r1.applied, [], '首次重跑不应有新应用');
    assert.ok(r1.skipped.length >= 4, '应全部报告 skipped');

    // 再跑一遍，版本不回退、不重复
    const r2 = await migrateUp();
    assert.deepEqual(r2.applied, []);
    const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
    assert.ok(row.user_version > 0, '版本应保持不回退');
  });

  test('getMigrationStatus 与库内留痕一致', async () => {
    const status = await getMigrationStatus();
    assert.equal(status.currentVersion > 0, true, 'currentVersion 应为正');
    for (let i = 0; i < status.migrations.length; i++) {
      assert.equal(status.migrations[i].applied, i + 1 <= status.currentVersion,
        `${status.migrations[i].version} 的 applied 标记应与 currentVersion 一致`);
    }
  });
});
