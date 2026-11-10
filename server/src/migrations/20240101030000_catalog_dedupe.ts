/**
 * 20240101030000 - 课程目录去重
 * 
 * 合并同一门课（band/grade/subject/term/track/seq/content 完全相同）的重复记录
 * 优先保留系统内置记录，其他重复记录合并并更新关联表
 */
import type { Migration } from './runner.js';

const migration = {
  version: '20240101030000',
  description: '课程目录去重 - 合并重复课程',
  up: (db: any) => {
    // 检查是否已应用
    if (db.prepare('SELECT 1 FROM schema_migrations WHERE name = ?').get('catalog_dedupe_v1')) {
      console.log('目录去重：已应用，跳过');
      return;
    }

    // 找出重复组：按去重键分组，每组保留 1 条（优先保留 is_builtin=1 的导入）
    // LEFT JOIN：import_id 为 NULL 的行（导入批次被删后 ON DELETE SET NULL）也要进去重组，
    // INNER JOIN 会让这批重复永久残留（且本迁移一次性，错过就再也不扫）。
    const duplicateGroups = db.prepare(`
      SELECT
        cc.band, cc.grade, cc.subject, cc.track, cc.term, cc.seq, TRIM(cc.content) AS content,
        GROUP_CONCAT(cc.id) AS ids,
        COUNT(*) AS cnt,
        MAX(CASE WHEN ci.is_builtin = 1 THEN 1 ELSE 0 END) AS has_builtin,
        SUM(CASE WHEN ci.is_builtin = 1 THEN 1 ELSE 0 END) AS builtin_count
      FROM course_catalog cc
      LEFT JOIN catalog_imports ci ON ci.id = cc.import_id
      WHERE cc.content IS NOT NULL AND TRIM(cc.content) != ''
      GROUP BY cc.band, cc.grade, cc.subject, cc.track, cc.term, cc.seq, TRIM(cc.content)
      HAVING COUNT(*) > 1
    `).all() as { band: string; grade: string; subject: string; track: string; term: string; seq: number; content: string; ids: string; cnt: number; has_builtin: number }[];

    let removed = 0;
    let reassigned = 0;
    let importsRemoved = 0;

    const tx = db.transaction(() => {
      for (const group of duplicateGroups) {
        const ids = group.ids.split(',').map((s: string) => parseInt(s, 10));
        
        // 确定保留哪个：优先内置，其次最小 id
        let keepId: number;
        const builtinId = db.prepare(`
          SELECT cc.id FROM course_catalog cc
          JOIN catalog_imports ci ON ci.id = cc.import_id
          WHERE cc.id IN (${ids.map(() => '?').join(',')}) AND ci.is_builtin = 1
          LIMIT 1
        `).get(...ids) as { id: number } | undefined;
        
        if (builtinId) {
          keepId = builtinId.id;
        } else {
          keepId = Math.min(...ids);
        }

        const removeIds = ids.filter((id: number) => id !== keepId);
        
        // 重新指向：更新 report_items 和 observations 中指向被删除 id 的记录
        for (const removeId of removeIds) {
          const r1 = db.prepare('UPDATE report_items SET course_id = ? WHERE course_id = ?').run(keepId, removeId);
          const r2 = db.prepare('UPDATE observations SET course_id = ? WHERE course_id = ?').run(keepId, removeId);
          reassigned += r1.changes + r2.changes;
        }

        // 删除重复课程
        if (removeIds.length > 0) {
          const placeholders = removeIds.map(() => '?').join(',');
          removed += db.prepare(`DELETE FROM course_catalog WHERE id IN (${placeholders})`).run(...removeIds).changes;
        }
      }

      // 清理空的导入记录（没有关联任何课程的导入，但保留内置导入）
      const emptyImports = db.prepare(`
        SELECT ci.id FROM catalog_imports ci
        LEFT JOIN course_catalog cc ON cc.import_id = ci.id
        WHERE ci.is_builtin = 0 AND cc.id IS NULL
      `).all() as { id: number }[];
      
      let importsRemovedThisPass = 0;
      if (emptyImports.length > 0) {
        const importIds = emptyImports.map((r: any) => r.id);
        const placeholders = importIds.map(() => '?').join(',');
        importsRemovedThisPass = db.prepare(`DELETE FROM catalog_imports WHERE id IN (${placeholders})`).run(...importIds).changes;
      }
      importsRemoved += importsRemovedThisPass;

      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, datetime(\'now\', \'+8 hours\'))').run('catalog_dedupe_v1');
      console.log(`目录去重：合并 ${duplicateGroups.length} 组重复，删除 ${removed} 条课程，重新指向 ${reassigned} 处引用，清理 ${importsRemoved} 条空导入记录`);
    })();

  },

  // 去重不可逆：不给 down（irreversible: true，migrateDown 会先拦住）。
  // 旧版定义了一个只会 console.warn 的假 down —— 假装可回滚比明确不可回滚更危险。
  irreversible: true,
};

export default migration;