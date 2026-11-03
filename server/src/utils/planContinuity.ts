/**
 * 规划 → 总结 的衔接：识别「上月规划了、本月却没上」的课。
 *
 * 老师月底做总结时最头疼的就是对着两张表核对：上月规划说了要上 A、B、C，
 * 这个月实际只上了 A、B —— C 漏了，是顺延到下月还是不上了？
 * 以前这个判断全靠老师脑子里记，现在由代码比对出来。
 *
 * 匹配口径：优先用课程目录 ID（course_id，最稳），没有目录关联的课退回用
 * 课程内容文本匹配。两边都做归一化（去空白、去标点、全角转半角），
 * 老师稍微改了措辞（"凸透镜成像" vs "凸透镜成像的规律"）也能认出是同一节。
 */

/** 用于比对的课程行：来自 report_items */
export interface ContinuityCourse {
  /** 课程目录 ID，可能为空（手动加的课没关联目录） */
  courseId?: number | null;
  /** 课程内容文本 */
  content: string;
  /** 课程类型，透传给前端顺延时带上（不影响匹配） */
  type?: string;
  /** 课程难度，透传给前端顺延时带上（不影响匹配） */
  difficulty?: string;
}

export interface UndeliveredCourse extends ContinuityCourse {
  /** 在上月规划里的序号，便于前端按原顺序展示 */
  seq: number;
}

/**
 * 归一化课程文本，用于「没有目录关联」时的兜底匹配。
 * 去掉所有空白和常见标点，全角数字字母转半角，转小写。
 */
export function normalizeCourseText(text: string): string {
  return String(text || '')
    .replace(/\s+/g, '')
    .replace(/，/g, ',')
    .replace(/。/g, '.')
    .replace(/、/g, ',')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/：/g, ':')
    // 全角数字/字母/标点 → 半角（FF01-FF5E → 0021-007E）
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .toLowerCase();
}

/** 上月规划里有哪些课是本月没上的。保持上月规划的原顺序。 */
export function diffPlannedVsTaught(
  lastMonthPlan: ContinuityCourse[],
  thisMonthTaught: ContinuityCourse[]
): UndeliveredCourse[] {
  // 本月已上课的目录 ID 集合 + 归一化文本集合，用来判断「这节上过了」
  const taughtIds = new Set<number>();
  const taughtTexts = new Set<string>();
  for (const c of thisMonthTaught) {
    if (c.courseId != null) taughtIds.add(Number(c.courseId));
    const norm = normalizeCourseText(c.content);
    if (norm) taughtTexts.add(norm);
  }

  const undelivered: UndeliveredCourse[] = [];
  lastMonthPlan.forEach((c, idx) => {
    // 有目录 ID 用 ID 判断（最可靠）
    if (c.courseId != null && taughtIds.has(Number(c.courseId))) return;
    // 没有目录 ID（或该 ID 本月没上）时，再用文本兜底判断
    const norm = normalizeCourseText(c.content);
    if (norm && taughtTexts.has(norm)) return;
    // 规划里空内容的行没意义，跳过
    if (!String(c.content || '').trim()) return;
    undelivered.push({
      courseId: c.courseId ?? null,
      content: c.content,
      type: c.type,
      difficulty: c.difficulty,
      seq: idx,
    });
  });
  return undelivered;
}
