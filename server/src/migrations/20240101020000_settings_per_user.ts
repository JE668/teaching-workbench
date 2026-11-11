/**
 * 20240101020000 - settings 全局表迁移到 per-user 表
 * 
 * 旧版 settings 表（key 全局唯一）改为 settings_user（按 user_id 分区）
 * 首次启动将旧值复制给每一个已有账号
 * 拷贝完成后旧表重命名为 settings_global_backup 留档
 */

const migration = {
  version: '20240101020000',
  description: 'Settings 表迁移 - 全局变 per-user',
  up: (db: any) => {
    // 检查旧表是否存在
    const hasLegacy = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='settings'"
    ).get();
    if (!hasLegacy) {
      console.log('Settings 迁移：旧表不存在，跳过');
      return;
    }

    // 检查新表是否已有数据（幂等检查）
    const newHasData = db.prepare('SELECT 1 FROM settings_user LIMIT 1').get();
    if (newHasData) {
      console.log('Settings 迁移：目标表已有数据，跳过');
      return;
    }

    // 获取所有用户
    const users = db.prepare('SELECT id FROM users').all() as { id: number }[];
    if (users.length === 0) {
      console.log('Settings 迁移：无用户，跳过');
      return;
    }

    // 获取旧配置
    const oldSettings = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
    if (oldSettings.length === 0) {
      console.log('Settings 迁移：旧表无数据，跳过');
      return;
    }

    // 为每个用户插入配置副本
    const stmt = db.prepare('INSERT INTO settings_user (user_id, key, value) VALUES (?, ?, ?)');
    const tx = db.transaction(() => {
      for (const user of users) {
        for (const s of oldSettings) {
          stmt.run(user.id, s.key, s.value);
        }
      }
      // 留档 + 幂等标记：改名后上面的 hasLegacy 检测不再命中
      db.exec('ALTER TABLE settings RENAME TO settings_global_backup');
    });
    tx();
    console.log(`Settings 迁移：为 ${users.length} 个用户各复制 ${oldSettings.length} 项配置`);
  },

  down: (db: any) => {
    // 回滚：从 settings_user 恢复到 settings（取第一个用户的数据）
    const firstUser = db.prepare('SELECT user_id FROM settings_user LIMIT 1').get() as { user_id: number } | undefined;
    if (firstUser) {
      const backupExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='settings_global_backup'").get();
      const tx = db.transaction(() => {
        if (backupExists) {
          // 有留档：直接恢复留档（里面就是迁移前的原始数据）。
          // 不能既 DROP/CREATE settings 又 RENAME backup → settings：目标已存在必报错。
          db.exec('DROP TABLE IF EXISTS settings');
          db.exec('DROP TABLE settings_user');
          db.exec('ALTER TABLE settings_global_backup RENAME TO settings');
        } else {
          // 没有留档（异常形态）：用第一个用户的副本重建全局表
          const settings = db.prepare('SELECT key, value FROM settings_user WHERE user_id = ?').all(firstUser.user_id);
          db.exec('DROP TABLE IF EXISTS settings');
          db.exec(`
            CREATE TABLE settings (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL,
              updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
            )
          `);
          const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
          for (const s of settings) {
            stmt.run(s.key, s.value);
          }
          db.exec('DROP TABLE settings_user');
        }
      });
      tx();
    }
    console.log('Settings 迁移：已回滚');
  },
  irreversible: false,
};

export default migration;