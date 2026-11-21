import type { Database } from 'better-sqlite3';
import { up as createStudentProfiles } from './20250115000007_student_profiles.js';
import { up as createGroupKnowledge } from './20250115000008_group_knowledge.js';

/**
 * 兼容已经按旧 migration 序号启动过的数据库。
 *
 * 两份早期迁移只有命名导出，加载器曾将其静默跳过。直接补 default export
 * 对全新库足够，但它们位于列表中部，已有库的 user_version 会将其跳过；
 * 因此在末尾幂等重放建表函数，确保升级库也能得到完整结构。
 */
const migration = {
  version: '20250115000011',
  description: '补齐学生画像与教研知识库表（兼容旧迁移序号）',
  irreversible: true,
  up: (db: Database) => {
    createStudentProfiles(db);
    createGroupKnowledge(db);
  },
};

export default migration;
