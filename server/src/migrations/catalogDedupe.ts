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

// ===========================================================================
// 「只保留系统内置」：把账号自己导入的课程规划整批清掉
//
// 去重只能合并「同一门课被灌进库里两次」，合不掉「用户导的是一套不一样的课表」——
// 那种情况下条目只会越堆越多，去重永远收不拢。所以再给一把更彻底的刀：
// 删掉所有非内置的导入记录及其课程，只留系统内置那份。
//
// 删之前先把月度总结 / 课堂观察里指向被删课程的引用改指到「内置同名课」，
// 有内置同名课才改指；实在没有的不硬改（report_items.course_id 和
// observations.course_id 都是裸 INTEGER、没有外键，删课不会连锁删数据）。
// ===========================================================================

export interface ResetReport {
  /** 删掉的已导入课程条数 */
  removed: number;
  /** 改指的引用条数（月度总结明细 + 课堂观察） */
  reassigned: number;
  /** 清掉的已导入记录条数 */
  importsRemoved: number;
  /** 收尾再跑一轮去重、又合并掉的条数 */
  deduped: number;
  /** 处理完后课程表还剩多少条（应等于内置条数） */
  remaining: number;
  appliedAt: string | null;
}

export function resetCatalogToBuiltIn(): ResetReport {
  let removed = 0;
  let reassigned = 0;
  let importsRemoved = 0;

  const run = db.transaction(() => {
    // 已导入课程里「有内置同名课」的那些键：先改指引用，再删掉已导入那份
    const sharedKeys = db.prepare(
      `SELECT DISTINCT c.band, c.grade, c.subject, c.track, c.term, c.seq, TRIM(c.content) AS content
       FROM course_catalog c
       JOIN catalog_imports ci ON ci.id = c.import_id
       WHERE ci.is_builtin = 0
         AND EXISTS (
           SELECT 1 FROM course_catalog b
           JOIN catalog_imports bi ON bi.id = b.import_id
           WHERE bi.is_builtin = 1
             AND b.band = c.band AND b.grade = c.grade AND b.subject = c.subject
             AND b.track = c.track AND b.term = c.term AND b.seq = c.seq
             AND TRIM(b.content) = TRIM(c.content))`
    );

    // 定位「同一个键下、非内置的那些行」——keeper 本身是内置的，天然不在里面
    const nonBuiltinSub =
      `SELECT c.id FROM course_catalog c JOIN catalog_imports ci ON ci.id = c.import_id ` +
      `WHERE ci.is_builtin = 0 AND ${KEY_WHERE} AND c.id != @keeper`;
    const pickKeeper = db.prepare(
      `SELECT c.id AS id ${KEEPER_FROM} WHERE ${KEY_WHERE} ${KEEPER_ORDER} LIMIT 1`
    );
    const updReportItems = db.prepare(
      'UPDATE report_items SET course_id = @keeper WHERE course_id IN (' + nonBuiltinSub + ')'
    );
    const updObservations = db.prepare(
      'UPDATE observations SET course_id = @keeper WHERE course_id IN (' + nonBuiltinSub + ')'
    );
    const delNonBuiltin = db.prepare('DELETE FROM course_catalog WHERE id IN (' + nonBuiltinSub + ')');

    for (const g of sharedKeys.all() as any[]) {
      const keeper = pickKeeper.get(g) as { id: number } | undefined;
      if (!keeper) continue;
      const params = { ...g, keeper: keeper.id };

      reassigned += updReportItems.run(params).changes;
      reassigned += updObservations.run(params).changes;
      removed += delNonBuiltin.run(params).changes;
    }

    // 没有内置同名课的已导入课程整批删掉
    removed += db
      .prepare(
        `DELETE FROM course_catalog
         WHERE import_id IN (SELECT id FROM catalog_imports WHERE is_builtin = 0)`
      )
      .run().changes;

    // 已导入记录清掉。必须先删课程再删导入：course_catalog.import_id 是
    // ON DELETE SET NULL，顺序反了会把课留下、变成没来路的孤儿课
    importsRemoved = db.prepare('DELETE FROM catalog_imports WHERE is_builtin = 0').run().changes;

    return { removed, reassigned, importsRemoved };
  });

  const r = run();
  // 收尾再来一轮去重：内置那份内部也可能有历史遗留的重复
  const dedupe = dedupeCourseCatalog({ force: true });

  return {
    removed: r.removed,
    reassigned: r.reassigned,
    importsRemoved: r.importsRemoved,
    deduped: dedupe.removed,
    remaining: (db.prepare('SELECT COUNT(*) AS n FROM course_catalog').get() as { n: number }).n,
    appliedAt: dedupe.appliedAt,
  };
}
