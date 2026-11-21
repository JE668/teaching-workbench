import type { Database } from 'better-sqlite3';

/**
 * 20250115000007 - 自定义 Excel 模板
 *
 * 支持老师上传 .xlsx 模板，标注字段映射，一键套用导出
 * 保留条件格式、数据验证、透视表、公式
 */
const migration = {
  version: '20250115000007',
  description: '自定义 Excel 模板：excel_templates 表',
  up: (db: Database) => {
    // 创建 Excel 模板表
    db.exec(`
      CREATE TABLE IF NOT EXISTS excel_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        file_blob BLOB NOT NULL,          -- 原始 .xlsx 二进制
        field_mappings TEXT NOT NULL,     -- JSON: {"A1": "report.student_name", "A3": "loop:report_items[kind=summary]->content"}
        sheet_name TEXT DEFAULT 'Sheet1',
        created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);

    db.exec('CREATE INDEX IF NOT EXISTS idx_excel_templates_user ON excel_templates(user_id);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_excel_templates_name ON excel_templates(user_id, name);');
  },
  down: (db: Database) => {
    db.exec('DROP TABLE IF EXISTS excel_templates;');
    console.warn('回滚 20250115000007：excel_templates 已删除');
  },
};

export default migration;
