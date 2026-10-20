import { db } from '../config/database.js';
import { log } from '../utils/logger.js';

export const CATALOG_DEDUPE_VERSION = '2026_10_20_dedupe_course_catalog';

/**
 * 保留行的判定：优先系统内置那份（is_builtin 在 catalog_imports 上，所以要 join 出来），
 * 都不是内置就留最早的（id 最小）。
 */
const KEEPER_FROM = `FROM course_catalog c LEFT JOIN catalog_imports ci ON ci.id = c.import_id`;
const KEEPER_ORDER = `ORDER BY COALESCE(ci.is_builtin, 0) DESC, c.id ASC`;

export interface DedupeReport {
  /** 存在重复的分组数 */
  groups: number;
  /** 合并掉的重复课程条数 */
  removed: number;
  /** 原本指向重复行、被改指到保留行的引用数（月度总结 + 课堂观察） */
  reassigned: number;
  /** 合并后一条课都不剩、被清掉的导入记录 */
  importsRemoved: number;
  /** true = 第一次跑；false = 按留痕跳过（没传 force） */
  fresh: boolean;
  appliedAt: string | null;
}

/** 去重的判断键。content 是自由文本，最可能带空格差异，所以用 TRIM 比对 */
const KEY_SQL = `band, grade, subject, track, term, seq, TRIM(content)`;
const KEY_WHERE =
  'c.band = @band AND c.grade = @grade AND c.subject = @subject AND c.track = @track AND c.term = @term AND c.seq = @seq AND TRIM(c.content) = TRIM(@content)';

export function lastDedupeAt(): string | null {
  const row = db
    .prepare('SELECT applied_at FROM schema_migrations WHERE name = ?')
    .get(CATALOG_DEDUPE_VERSION) as { applied_at: string } | undefined;
  return row ? row.applied_at : null;
}

/**
 * 把同一门课（band / grade / subject / track / term / seq / content 完全相同）的重复行合成一条。
 *
 * 为什么会有重复：#40 之前课程目录按账号隔离，去重键里带 user_id；改成全局共享后
 * 同一份目录被灌进库里两次也拿不出「这是同一门课」这个结论——比如内置灌库那份
 * 和用户自己导的那份，键一样但当时各自都以为自己是新的。页面上就是「3589 条内置
 * + 3589 条自己导的」叠成七千多条，目录翻不完。
 *
 * 合并后把指向重复行的 `report_items.course_id` / `observations.course_id` 改指到保留行，
 * 已经写过的月度总结、课堂观察不会变成孤儿。
 *
 * 幂等：结果写进 schema_migrations 留痕，启动时只跑一次；传 { force: true } 可手工重跑。
 */
export function dedupeCourseCatalog(options: { force?: boolean } = {}): DedupeReport {
  const previous = lastDedupeAt();
  if (!options.force && previous) {
    return { groups: 0, removed: 0, reassigned: 0, importsRemoved: 0, fresh: false, appliedAt: previous };
  }

  const run = db.transaction(() => {
    const groups = db.prepare(`
      SELECT band, grade, subject, track, term, seq, content
      FROM course_catalog
      GROUP BY ${KEY_SQL}
      HAVING COUNT(*) > 1
    `).all() as any[];

    // 用子查询定位「同组的其他行」，免得拼 IN 列表
    const pickKeeper = db.prepare(
      `SELECT c.id AS id ${KEEPER_FROM} WHERE ${KEY_WHERE} ${KEEPER_ORDER} LIMIT 1`
    );
    const dupeSub = `SELECT c.id FROM course_catalog c WHERE ${KEY_WHERE} AND c.id != @keeper`;
    const reassignReportItems = db.prepare(
      'UPDATE report_items SET course_id = @keeper WHERE course_id IN (' + dupeSub + ')'
    );
    const reassignObservations = db.prepare(
      'UPDATE observations SET course_id = @keeper WHERE course_id IN (' + dupeSub + ')'
    );
    const deleteRows = db.prepare('DELETE FROM course_catalog WHERE id IN (' + dupeSub + ')');

    let removed = 0;
    let reassigned = 0;

    for (const g of groups) {
      const keeper = pickKeeper.get(g) as { id: number } | undefined;
      if (!keeper) continue;
      const params = { ...g, keeper: keeper.id };

      reassigned += reassignReportItems.run(params).changes;
      reassigned += reassignObservations.run(params).changes;
      removed += deleteRows.run(params).changes;
    }

    // 去重后再统计每份导入还剩多少课；一条都不剩的导入记录直接清掉
    const remaining = db
      .prepare('SELECT import_id, COUNT(*) AS n FROM course_catalog GROUP BY import_id')
      .all() as { import_id: number; n: number }[];
    const byImport = new Map(remaining.map((r) => [r.import_id, r.n]));
    const imports = db.prepare('SELECT id FROM catalog_imports').all() as { id: number }[];
    let importsRemoved = 0;
    for (const im of imports) {
      const n = byImport.get(im.id) ?? 0;
      db.prepare('UPDATE catalog_imports SET courses_imported = ? WHERE id = ?').run(n, im.id);
      if (n === 0) importsRemoved += db.prepare('DELETE FROM catalog_imports WHERE id = ?').run(im.id).changes;
    }

    db.prepare(
      "INSERT OR REPLACE INTO schema_migrations (name, applied_at) VALUES (?, datetime('now', '+8 hours'))"
    ).run(CATALOG_DEDUPE_VERSION);

    return { groups: groups.length, removed, reassigned, importsRemoved };
  });

  const { groups, removed, reassigned, importsRemoved } = run();
  if (removed > 0) {
    log.info(
      { groups, removed, reassigned, importsRemoved },
      '课程目录重复行已合并（保留系统内置那份，引用已改指）'
    );
  }
  return { groups, removed, reassigned, importsRemoved, fresh: previous === null, appliedAt: lastDedupeAt() };
}
