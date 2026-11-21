/**
 * 20250115000002 - 跨月知识图谱
 *
 * 建立知识点/考点/错因实体表，支撑 student → knowledge_point → mastery 三元组
 * 配合 monthly_reports 抽取知识点，驱动知识雷达与薄弱点推荐
 */

const migration = {
  version: '20250115000002',
  description: '跨月知识图谱',
  up: (db: any) => {
    // 知识点主表：用户维度隔离，学生+学科+知识点唯一
    db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_points (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        student_id INTEGER NOT NULL,
        subject TEXT NOT NULL,
        grade TEXT NOT NULL,
        point_name TEXT NOT NULL,           -- 如 分数通分, 一元一次方程求解
        point_category TEXT NOT NULL,       -- concept/skill/method/habit
        mastery_level REAL DEFAULT 0,       -- 0-1 动态更新
        evidence_count INTEGER DEFAULT 0,   -- 命中次数
        last_seen_at TEXT,
        created_at TEXT DEFAULT (datetime('now', '+8 hours')),
        UNIQUE(user_id, student_id, subject, point_name)
      );
    `);

    // 月报-知识点关联表：记录每月 mastery 变化量 + 证据片段
    db.exec(`
      CREATE TABLE IF NOT EXISTS report_knowledge_points (
        report_id INTEGER NOT NULL,
        point_id INTEGER NOT NULL,
        delta REAL NOT NULL,                -- 本月该知识点 mastery 变化量
        evidence TEXT,                      -- 引用的原文片段
        PRIMARY KEY (report_id, point_id)
      );
    `);

    // 知识点间关系表：前置/后置/相关知识点，支撑推荐补缺路径
    db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_point_relations (
        from_point_id INTEGER NOT NULL,
        to_point_id INTEGER NOT NULL,
        relation_type TEXT NOT NULL,        -- prerequisite / related / extension
        weight REAL DEFAULT 1.0,
        PRIMARY KEY (from_point_id, to_point_id, relation_type)
      );
    `);

    // 索引
    db.exec("CREATE INDEX IF NOT EXISTS idx_knowledge_points_user_student ON knowledge_points(user_id, student_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_knowledge_points_subject ON knowledge_points(user_id, subject)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_knowledge_points_mastery ON knowledge_points(mastery_level DESC)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_report_knowledge_points_report ON report_knowledge_points(report_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_knowledge_point_relations_from ON knowledge_point_relations(from_point_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_knowledge_point_relations_to ON knowledge_point_relations(to_point_id)");
  },
  down: (db: any) => {
    db.exec("DROP TABLE IF EXISTS knowledge_point_relations");
    db.exec("DROP TABLE IF EXISTS report_knowledge_points");
    db.exec("DROP TABLE IF EXISTS knowledge_points");
  },
};

export default migration;
