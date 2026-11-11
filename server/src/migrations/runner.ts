/**
 * 数据库迁移运行器
 * 
 * 使用 PRAGMA user_version 记录当前迁移版本
 * 迁移文件命名：YYYYMMDDHHMMSS_description.ts
 * 
 * 使用方式：
 *   import { migrateUp } from './migrations/runner.js';
 *   await migrateUp(); // 应用所有未执行的迁移
 *   await migrateUp({ dryRun: true }); // 仅预览
 */
import { db } from '../config/database.js';
import { log } from '../utils/logger.js';
import type { Database } from 'better-sqlite3';

/**
 * 迁移接口
 */
export interface Migration {
  version: string;      // YYYYMMDDHHMMSS
  description: string;  // 人类可读的描述
  up: (db: Database) => void;
  down?: (db: Database) => void;
  irreversible?: boolean; // 标记不可回滚
}

/**
 * 获取当前数据库版本
 *
 * SQLite 的 PRAGMA user_version 是 **32 位有符号整数**（上限 2147483647），
 * 而 YYYYMMDDHHMMSS 时间戳（20240101000000 ≈ 2×10¹³）远超上限，直接写入会静默归零
 * —— 表现为「每次启动都重新应用全部迁移」。因此库里存的是迁移在文件列表中的
 * **序号**（1, 2, 3...，int32 内绝对安全），完整版本串仍以文件为准。
 */
function getCurrentVersion(): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  return row.user_version;
}

/**
 * 设置数据库版本（写入的是序号，不是时间戳）
 */
function setVersion(seq: number): void {
  db.prepare('PRAGMA user_version = ' + seq).run();
}

/**
 * 加载所有迁移文件
 */
/**
 * 判断目录项是否为「可加载的迁移文件」。
 *
 * 抽成导出函数是为了让它可被测试直接验证 —— 这里曾经出过一次生产事故级的问题：
 * 只认 `.ts` 时，生产（node dist）目录下全是编译产物 `.js`，于是静默加载 0 个迁移、
 * user_version 恒 0、migrateUp 空转，而本地用 tsx 跑测试全是绿的。
 *
 * 规则：
 *   - `.ts` 与 `.js` 都加载（开发用 tsx，生产用 node）
 *   - 排除 runner 自身（runner.ts / runner.js）
 *   - 排除类型声明 `.d.ts`（没有运行时实现，import 会失败）
 */
export function isMigrationFile(name: string): boolean {
  if (name === 'runner.ts' || name === 'runner.js') return false;
  if (name.endsWith('.d.ts')) return false;
  return name.endsWith('.ts') || name.endsWith('.js');
}

async function loadMigrations(): Promise<Migration[]> {
  const { readdirSync } = await import('fs');
  const { join } = await import('path');
  const { fileURLToPath } = await import('url');
  const { dirname } = await import('path');
  
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  
  const files = readdirSync(__dirname)
    .filter(isMigrationFile)
    .sort(); // 按版本号排序（文件名以时间戳开头）
  
  const migrations: Migration[] = [];
  for (const file of files) {
    const module = await import(join(__dirname, file));
    const migration = module.default;
    if (migration && migration.version && migration.up) {
      migrations.push(migration);
    }
  }
  return migrations;
}

/**
 * 执行迁移
 */
export async function migrateUp(options: { dryRun?: boolean } = {}): Promise<{ applied: string[]; skipped: string[] }> {
  const migrations = await loadMigrations();
  const currentVersion = getCurrentVersion();

  log.info({ currentVersion, migrationCount: migrations.length }, '开始检查迁移');

  const applied: string[] = [];
  const skipped: string[] = [];

  // 库里存的是「序号」（1 起），时间戳版本串只是文件名；序号 = 列表下标 + 1
  for (let i = 0; i < migrations.length; i++) {
    const migration = migrations[i];
    const seq = i + 1;

    if (seq <= currentVersion) {
      skipped.push(`${migration.version} - ${migration.description} (已应用)`);
      continue;
    }

    if (options.dryRun) {
      log.info({ version: migration.version, description: migration.description }, '待应用迁移');
      applied.push(`${migration.version} - ${migration.description} (dry-run)`);
      continue;
    }

    log.info({ version: migration.version, description: migration.description }, '应用迁移');

    try {
      const tx = db.transaction(() => {
        migration.up(db);
        setVersion(seq);
      });
      tx();

      applied.push(`${migration.version} - ${migration.description}`);
      log.info({ version: migration.version }, '迁移应用成功');
    } catch (error: any) {
      log.error({ version: migration.version, error: error.message }, '迁移失败');
      throw new Error(`迁移 ${migration.version} 失败: ${error.message}`);
    }
  }

  return { applied, skipped };
}

/**
 * 回滚迁移（可选）
 *
 * targetSeq 是「序号」（1 起），含义是回滚到该序号之后的状态。
 */
export async function migrateDown(targetSeq: number): Promise<string[]> {
  const migrations = (await loadMigrations()).reverse(); // 逆序回滚
  const currentVersion = getCurrentVersion();

  if (targetSeq >= currentVersion) {
    log.warn({ targetVersion: targetSeq, currentVersion }, '目标版本不小于当前版本，无需回滚');
    return [];
  }

  const rolledBack: string[] = [];

  for (const migration of migrations) {
    const idx = migrations.length - migrations.indexOf(migration); // 逆序后的原序号
    void idx;

    if (!migration.down) {
      throw new Error(`迁移 ${migration.version} 没有定义 down 方法`);
    }

    // 逆序数组里：下标 0 是最新迁移。原始序号 = 总数 - 逆序下标
    const originalSeq = migrations.length - (migrations.indexOf(migration));

    if (originalSeq <= targetSeq || originalSeq > currentVersion) {
      continue;
    }

    if (migration.irreversible) {
      throw new Error(`迁移 ${migration.version} 标记为不可回滚`);
    }

    log.info({ version: migration.version, description: migration.description }, '回滚迁移');

    try {
      const tx = db.transaction(() => {
        migration.down!(db);
        setVersion(originalSeq - 1);
      });
      tx();

      rolledBack.push(`${migration.version} - ${migration.description}`);
      log.info({ version: migration.version }, '迁移回滚成功');
    } catch (error: any) {
      log.error({ version: migration.version, error: error.message }, '回滚失败');
      throw new Error(`回滚 ${migration.version} 失败: ${error.message}`);
    }
  }

  return rolledBack;
}

/**
 * 获取迁移状态
 */
export async function getMigrationStatus(): Promise<{
  currentVersion: number;
  migrations: Array<{ version: string; description: string; applied: boolean }>;
}> {
  const migrations = await loadMigrations();
  const currentVersion = getCurrentVersion();

  return {
    currentVersion,
    migrations: migrations.map((m, i) => ({
      version: m.version,
      description: m.description,
      applied: i + 1 <= currentVersion,
    })),
  };
}