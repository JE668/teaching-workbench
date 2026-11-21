/**
 * 20250115000016 - 阶测明细保留试卷原始总题数
 *
 * 已失分题明细数不等于试卷总题数。每次成功分析把请求的 questionCount
 * 同事务写入该次考试的全部新明细；历史行的 0 由查询层回退为明细数。
 */
const migration = {
  version: '20250115000016',
  description: '阶测错因明细增加 question_count',
  up: (db: any) => {
    const columns = db.prepare('PRAGMA table_info(exam_analysis_details)').all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === 'question_count')) {
      db.exec('ALTER TABLE exam_analysis_details ADD COLUMN question_count INTEGER NOT NULL DEFAULT 0;');
    }
  },
  down: () => {
    // SQLite 旧版本不支持可靠 DROP COLUMN；前滚迁移保留该列。
  },
};

export default migration;
