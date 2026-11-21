/**
 * 20250115000001 - 回访结构化字段
 *
 * 为 followups 表新增 5 个结构化板块字段 + blocks JSON 冗余字段：
 * - knowledge_gain: 学生收获/掌握情况
 * - class_performance: 课堂表现/互动情况
 * - homework_assign: 作业布置/完成要求
 * - next_plan: 下步教学计划/重点
 * - teacher_remark: 教师综合评价/建议
 * - blocks: JSON 数组，供前端直读渲染（兼容旧数据）
 */

const migration = {
  version: '20250115000001',
  description: '回访结构化字段',
  up: (db: any) => {
    // 新增 5 个结构化板块字段
    db.exec("ALTER TABLE followups ADD COLUMN knowledge_gain TEXT DEFAULT ''");
    db.exec("ALTER TABLE followups ADD COLUMN class_performance TEXT DEFAULT ''");
    db.exec("ALTER TABLE followups ADD COLUMN homework_assign TEXT DEFAULT ''");
    db.exec("ALTER TABLE followups ADD COLUMN next_plan TEXT DEFAULT ''");
    db.exec("ALTER TABLE followups ADD COLUMN teacher_remark TEXT DEFAULT ''");
    // blocks JSON 冗余字段：[{title, content, order}] 供前端直读
    db.exec("ALTER TABLE followups ADD COLUMN blocks TEXT DEFAULT '[]'");

    // 为现有数据做一次性回填：把 content 按双换行拆分，尽量映射到 5 字段
    // 仅作兼容，不保证完美；新数据走 JSON Schema 直写
    const rows = db.prepare("SELECT id, content FROM followups WHERE content IS NOT NULL AND content != ''").all();
    for (const row of rows) {
      const parts = row.content.split('\n\n').filter((p: string) => p.trim());
      // 简单启发式：按顺序映射前 5 段
      const knowledge_gain = parts[0] || '';
      const class_performance = parts[1] || '';
      const homework_assign = parts[2] || '';
      const next_plan = parts[3] || '';
      const teacher_remark = parts[4] || '';
      const blocks = JSON.stringify([
        { title: '学生收获', content: knowledge_gain, order: 0 },
        { title: '课堂表现', content: class_performance, order: 1 },
        { title: '作业布置', content: homework_assign, order: 2 },
        { title: '下步计划', content: next_plan, order: 3 },
        { title: '教师评价', content: teacher_remark, order: 4 },
      ].filter(b => b.content));
      db.prepare(
        "UPDATE followups SET knowledge_gain=?, class_performance=?, homework_assign=?, next_plan=?, teacher_remark=?, blocks=? WHERE id=?"
      ).run(knowledge_gain, class_performance, homework_assign, next_plan, teacher_remark, blocks, row.id);
    }
  },
  down: (db: any) => {
    // SQLite 不支持 DROP COLUMN，这里仅作逻辑回滚标记
    // 实际回滚需重建表，生产环境建议配合备份恢复
    console.warn('回滚 20250115000001 需重建 followups 表，请从备份恢复');
  },
};

export default migration;
