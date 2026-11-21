/**
 * 20250115000002 - 阶测错因分析明细表
 *
 * 存储 AI 对每道试题的错因分析结果，支撑错因分布统计、复习微计划生成
 */

const migration = {
  version: '20250115000002',
  description: '阶测错因分析明细表',
  up: (db: any) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS exam_analysis_details (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        student_id INTEGER NOT NULL,
        exam_id INTEGER NOT NULL,
        question_index INTEGER NOT NULL,
        question_type TEXT,
        mistake_tags TEXT NOT NULL,       -- JSON: ["概念不清:定义记错", "计算粗心:符号漏"]
        root_cause TEXT,                  -- 核心错因一句话
        review_actions TEXT NOT NULL,     -- JSON: ["重做同类题3道", "背诵定义5遍", "纠错本记录"]
        confidence REAL DEFAULT 0.8,
        created_at TEXT DEFAULT (datetime('now', '+8 hours'))
      );
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_exam_analysis_student_exam
      ON exam_analysis_details(student_id, exam_id);
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_exam_analysis_user
      ON exam_analysis_details(user_id);
    `);
  },
  down: (db: any) => {
    db.exec("DROP TABLE IF EXISTS exam_analysis_details");
    db.exec("DROP INDEX IF EXISTS idx_exam_analysis_student_exam");
    db.exec("DROP INDEX IF EXISTS idx_exam_analysis_user");
  },
};

export default migration;
