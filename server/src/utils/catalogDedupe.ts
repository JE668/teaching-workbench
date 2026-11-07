/**
 * 课程目录去重工具。
 * 
 * 合并同一门课（band/grade/subject/term/track/seq/content 完全相同）的重复记录。
 * 优先保留系统内置记录，其他重复记录合并并更新关联表。
 */

import { db } from '../config/database.js';
import { log } from '../utils/logger.js';
import { seedBuiltInCatalog } from '../seed/builtinCatalog.js';

/** 去重分组行：GROUP_CONCAT 出来的课程 id 串 */
interface DuplicateGroup {
  band: string;
  grade: string;
  subject: string;
  track: string;
  term: string;
  seq: number;
  content: string;
  ids: string;
  cnt: number;
  has_builtin: number;
}

/** course_catalog 行精简投影（重指时只读这些列） */
interface CatalogCourseRow {
  id: number;
  band: string;
  grade: string;
  subject: string;
  track: string;
  term: string;
  seq: number;
  content: string;
}

export const CATALOG_DEDUPE_VERSION = 'catalog_dedupe_v1';

export interface DedupeResult {
  groups: number;
  removed: number;
  removedCourses: number;
  reassigned: number;
  importsRemoved: number;
  fresh: boolean;
}

/**
 * 合并重复课程。
 * 
 * @param options.force - 强制执行，忽略 schema_migrations 留痕
 * @returns 去重统计结果
 */
export function dedupeCourseCatalog(options: { force?: boolean } = {}): { groups: number; removed: number; removedCourses: number; reassigned: number; importsRemoved: number; fresh: boolean } {
  // 检查是否已应用（非强制模式下）
  if (!options.force && db.prepare('SELECT 1 FROM schema_migrations WHERE name = ?').get('catalog_dedupe_v1')) {
    log.info('目录去重：已应用，跳过');
    return { groups: 0, removed: 0, removedCourses: 0, reassigned: 0, importsRemoved: 0, fresh: false };
  }

  // 找出重复组：按去重键分组，每组保留 1 条（优先保留 is_builtin=1 的导入）
  const duplicateGroups = db.prepare(`
    SELECT 
      cc.band, cc.grade, cc.subject, cc.track, cc.term, cc.seq, TRIM(cc.content) AS content,
      GROUP_CONCAT(cc.id) AS ids,
      COUNT(*) AS cnt,
      MAX(CASE WHEN ci.is_builtin = 1 THEN 1 ELSE 0 END) AS has_builtin,
      SUM(CASE WHEN ci.is_builtin = 1 THEN 1 ELSE 0 END) AS builtin_count
    FROM course_catalog cc
    JOIN catalog_imports ci ON ci.id = cc.import_id
    WHERE cc.content IS NOT NULL AND TRIM(cc.content) != ''
    GROUP BY cc.band, cc.grade, cc.subject, cc.track, cc.term, cc.seq, TRIM(cc.content)
    HAVING COUNT(*) > 1
  `).all() as DuplicateGroup[];

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
      SELECT ci.id, ci.is_builtin, ci.filename FROM catalog_imports ci
      LEFT JOIN course_catalog cc ON cc.import_id = ci.id
      WHERE ci.is_builtin = 0 AND cc.id IS NULL
    `).all() as { id: number; is_builtin: number; filename: string }[];

    let importIds = [];
    if (emptyImports.length > 0) {
      // 双重保险：即使查询意外返回了内置导入，也再次过滤掉
      importIds = emptyImports
        .map((r: any) => r.id)
        .filter((id: number) => {
          const imp = db.prepare('SELECT is_builtin FROM catalog_imports WHERE id = ?').get(id) as { is_builtin: number } | undefined;
          return imp && imp.is_builtin === 0;
        });
      if (importIds.length > 0) {
        const placeholders = importIds.map(() => '?').join(',');
        importsRemoved = db.prepare(`DELETE FROM catalog_imports WHERE id IN (${placeholders})`).run(...importIds).changes;
      }
    }

    // 留痕（幂等：重复跑不再触发 UNIQUE 冲突）
    db.prepare('INSERT OR IGNORE INTO schema_migrations (name, applied_at) VALUES (?, datetime(\'now\', \'+8 hours\'))').run('catalog_dedupe_v1');
    log.info({ groups: duplicateGroups.length, removed, reassigned, importsRemoved }, '目录去重完成');
  })();

  return {
    groups: duplicateGroups.length,
    removed,
    removedCourses: removed,
    reassigned,
    importsRemoved,
    fresh: removed > 0 || duplicateGroups.length > 0,
  };
}

/**
 * 重置为内置目录：清除所有非内置导入及其课程。
 *
 * 会把月度总结 / 听评课里指向被删课程的引用改指到内置同名课。
 * 收尾会再跑一轮去重。
 *
 * 返回字段沿用 ResetReport 口径（removed / importsRemoved）——
 * 设置页 toast 与 e2e 断言依赖这套字段名，不要改成 removedCourses 之类。
 */
export async function resetCatalogToBuiltIn(): Promise<{ removed: number; importsRemoved: number; reassigned: number; remaining: number; reseeded: number; deduped: number }> {
  let importsRemoved = 0;
  let removed = 0;
  let reassigned = 0;
  let reseeded = 0;
  let deduped = 0;

  // 找出所有非内置导入
  const nonBuiltinImports = db.prepare(`
    SELECT id FROM catalog_imports WHERE is_builtin != 1
  `).all() as { id: number }[];

  if (nonBuiltinImports.length === 0) {
    // 没有可清的导入也要走完收尾：重新灌库把缺的内置学段补回来。
    // e2e / 新库场景里启动灌库被跳过（NODE_ENV=test），这里就是内置目录的唯一来路 ——
    // 旧版语义是「线上入口永远重灌」，不能因早退而跳过。
    reseeded = (await seedBuiltInCatalog({ force: true })).courses;
    const after = dedupeCourseCatalog({ force: true });
    deduped = after.removed;
    return {
      removed: 0,
      importsRemoved: 0,
      reassigned: 0,
      remaining: (db.prepare('SELECT COUNT(*) AS n FROM course_catalog').get() as { n: number }).n,
      reseeded,
      deduped,
    };
  }

  const nonBuiltinIds = nonBuiltinImports.map(r => r.id);
  const placeholders = nonBuiltinIds.map(() => '?').join(',');

  // 找出这些导入关联的所有课程
  const affectedCourses = db.prepare(`
    SELECT id FROM course_catalog WHERE import_id IN (${placeholders})
  `).all(...nonBuiltinIds) as { id: number }[];

  const affectedIds = affectedCourses.map(r => r.id);

  const tx = db.transaction(() => {
    // 先重新指向：把引用改指向内置同名课
    for (const removeId of affectedIds) {
      // 找内置同名课
      const course = db.prepare('SELECT * FROM course_catalog WHERE id = ?').get(removeId) as CatalogCourseRow | undefined;
      if (!course) continue;

      const builtin = db.prepare(`
        SELECT cc.id FROM course_catalog cc
        JOIN catalog_imports ci ON ci.id = cc.import_id
        WHERE cc.band = ? AND cc.grade = ? AND cc.subject = ? 
          AND cc.track = ? AND cc.term = ? AND cc.seq = ? AND TRIM(cc.content) = TRIM(?)
          AND ci.is_builtin = 1
        LIMIT 1
      `).get(course.band, course.grade, course.subject, course.track, course.term, course.seq, course.content) as { id: number } | undefined;

      if (builtin) {
        const r1 = db.prepare('UPDATE report_items SET course_id = ? WHERE course_id = ?').run(builtin.id, removeId);
        const r2 = db.prepare('UPDATE observations SET course_id = ? WHERE course_id = ?').run(builtin.id, removeId);
        reassigned += r1.changes + r2.changes;
      }
    }

    // 删除受影响的课程
    if (affectedIds.length > 0) {
      const affectedPlaceholders = affectedIds.map(() => '?').join(',');
      removed = db.prepare(`DELETE FROM course_catalog WHERE id IN (${affectedPlaceholders})`).run(...affectedIds).changes;
    }

    // 删除非内置导入记录
    const importPlaceholders = nonBuiltinIds.map(() => '?').join(',');
    importsRemoved = db.prepare(`DELETE FROM catalog_imports WHERE id IN (${importPlaceholders})`).run(...nonBuiltinIds).changes;

    // 再跑一轮去重，清理内置目录内部的历史重复
    const duplicateGroups = db.prepare(`
      SELECT 
        cc.band, cc.grade, cc.subject, cc.track, cc.term, cc.seq, TRIM(cc.content) AS content,
        GROUP_CONCAT(cc.id) AS ids,
        COUNT(*) AS cnt,
        MAX(CASE WHEN ci.is_builtin = 1 THEN 1 ELSE 0 END) AS has_builtin
      FROM course_catalog cc
      JOIN catalog_imports ci ON ci.id = cc.import_id
      WHERE cc.content IS NOT NULL AND TRIM(cc.content) != ''
      GROUP BY cc.band, cc.grade, cc.subject, cc.track, cc.term, cc.seq, TRIM(cc.content)
      HAVING COUNT(*) > 1
    `).all() as DuplicateGroup[];

    for (const group of duplicateGroups) {
      const ids = group.ids.split(',').map((s: string) => parseInt(s, 10));
      
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
      
      for (const removeId of removeIds) {
        const r1 = db.prepare('UPDATE report_items SET course_id = ? WHERE course_id = ?').run(keepId, removeId);
        const r2 = db.prepare('UPDATE observations SET course_id = ? WHERE course_id = ?').run(keepId, removeId);
        reassigned += r1.changes + r2.changes;
      }

      if (removeIds.length > 0) {
        const placeholders = removeIds.map(() => '?').join(',');
        db.prepare(`DELETE FROM course_catalog WHERE id IN (${placeholders})`).run(...removeIds);
      }
    }
  })();

  // 收尾重新灌库内置目录（小初 + 高中）：老师若先于内置导过同一份文件，
  // 上面删掉他那些课程后整段学段会缺失，这里按 sha 判重补回来。
  reseeded = (await seedBuiltInCatalog({ force: true })).courses;

  // 再跑一轮去重：重灌的行和库里剩余的可能重合
  deduped = dedupeCourseCatalog({ force: true }).removed;

  const remaining = (db.prepare('SELECT COUNT(*) AS n FROM course_catalog').get() as { n: number }).n;

  return { removed, importsRemoved, reassigned, remaining, reseeded, deduped };
}