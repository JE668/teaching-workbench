/**
 * 目录智能排课（方向 E）。
 *
 * 课程体系目录里的课是按 (term, track, seq) 有序组织的：同一「轨道」（track，
 * 比如「力学」「光学」）里 seq 越小越靠前。学生已上的课通过 report_items.course_id
 * 关联到目录，顺着同一 track 的 seq 往后推，就是「下一步该上什么」。
 *
 * 以前规划完全靠老师手动从目录里挑，现在按 track 给出每条轨道的下一门待上课，
 * 老师从「手动翻目录」变成「点选确认」。
 */

/** 目录里的一门课（只需排课推算用到的字段） */
export interface CatalogCourseForNext {
  id: number;
  /** 轨道，比如「力学」「光学」；空串表示没分轨道 */
  track: string;
  /** 轨道内序号，越小越靠前 */
  seq: number;
  content: string;
  type: string;
  difficulty: string;
}

/** 某条轨道的「下一步」推荐 */
export interface NextCourseSuggestion {
  /** 轨道名 */
  track: string;
  /** 这条轨道里已上过几门 */
  takenCount: number;
  /** 这条轨道总共有几门 */
  totalCount: number;
  /** 推荐的下一门课（seq 最小的未上过的课） */
  course: CatalogCourseForNext | null;
  /** 这条轨道是否已经全部上完 */
  finished: boolean;
}

/**
 * 按轨道推荐「下一步该上什么」。
 *
 * - 只看 (grade, subject, term) 匹配的目录（由调用方先筛好）。
 * - 把目录按 track 分组，每组按 seq 升序，找 seq 最小的、没上过的课。
 * - 没 track 的课归到「」轨道（老师没分轨道时也能给一个兜底推荐）。
 * - 学生已上的课用 courseIds 集合判断，目录里没有 course_id 的课不参与推荐。
 *
 * 返回按轨道名排序的推荐列表；finished 的轨道也返回（前端好显示「已上完」）。
 */
export function suggestNextCourses(
  catalog: CatalogCourseForNext[],
  takenCourseIds: number[]
): NextCourseSuggestion[] {
  const taken = new Set(takenCourseIds.map(Number));

  // 按 track 分组
  const byTrack = new Map<string, CatalogCourseForNext[]>();
  for (const c of catalog) {
    const track = (c.track || '').trim();
    if (!byTrack.has(track)) byTrack.set(track, []);
    byTrack.get(track)!.push(c);
  }

  const suggestions: NextCourseSuggestion[] = [];
  for (const [track, courses] of byTrack) {
    // 组内按 seq 升序（seq 相同按 id 稳定排序）
    const sorted = [...courses].sort((a, b) => a.seq - b.seq || a.id - b.id);
    // 已上过的：只算目录里 id 在 taken 集合里的
    const takenInTrack = sorted.filter((c) => taken.has(Number(c.id)));
    // 下一门 = seq 最小的未上过的
    const next = sorted.find((c) => !taken.has(Number(c.id))) || null;
    suggestions.push({
      track,
      takenCount: takenInTrack.length,
      totalCount: sorted.length,
      course: next,
      finished: !next,
    });
  }

  // 有轨道名的排前面（按轨道名），没 track 的兜底组排最后
  suggestions.sort((a, b) => {
    if (!a.track && b.track) return 1;
    if (a.track && !b.track) return -1;
    return a.track.localeCompare(b.track, 'zh');
  });
  return suggestions;
}
