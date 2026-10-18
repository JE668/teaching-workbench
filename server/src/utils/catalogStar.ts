/**
 * 掌握星级 AI 初评（纯逻辑，不碰数据库与网络，便于单测）。
 *
 * mastery_star（1-5）是**课程本身**的属性：这门课学生该掌握到什么程度。
 * 它不依赖某个学生的表现，所以判定只用目录自带的字段——
 * 课程内容、课程类型、期末考分值占比、学习难度、对后续课程影响程度。
 *
 * AI 给的是初档，老师随时可手改（PATCH /catalog/courses/:id）。
 */

export interface StarCourseInput {
  id: number;
  content: string;
  type: string;
  score: string;
  difficulty: string;
  impact: string;
  section?: string;
}

export interface StarScope {
  grade?: string;
  subject?: string;
  term?: string;
  track?: string;
}

export interface StarDecision {
  id: number;
  star: number;
}

export const STAR_MIN = 1;
export const STAR_MAX = 5;

/** 每批送几门：100 门 ≈ 8KB prompt，留足输出空间也不容易撞超时 */
export const STAR_BATCH_SIZE = 100;

/** 每批最多写多少门，防止一次请求跑一整天 */
export const STAR_SCOPE_LIMIT = 500;

/** 档位的人类可读名称（前端提示、日志共用） */
export const STAR_LABELS: Record<number, string> = {
  1: '了解即可',
  2: '了解为主',
  3: '常规掌握',
  4: '重点掌握',
  5: '熟练运用',
};

/** 分值占比区间解析：取上限，「7~10」→ 10，「3 ~ 6」→ 6，「/」→ 0 */
export function scoreCeiling(score: string): number {
  const nums = String(score || '')
    .split(/[^0-9.]+/)
    .map((s) => parseFloat(s))
    .filter((n) => Number.isFinite(n));
  return nums.length ? Math.max(...nums) : 0;
}

/** 学习难度星级：★★★★ → 4，「/」「—」→ 0（未标，不是低难度） */
export function starCount(text: string): number {
  return (String(text || '').match(/★/g) || []).length;
}

export function isValidStar(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= STAR_MIN && v <= STAR_MAX;
}

/** 均分批次，尾部不满的一批原样返回 */
export function chunk<T>(items: T[], size: number): T[][] {
  const n = Math.max(1, Math.floor(size));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += n) {
    out.push(items.slice(i, i + n));
  }
  return out;
}

/** 档位判定标准：写进提示词，让模型按同一把尺子打分 */
export function buildRubric(): string {
  return [
    '5 熟练运用：期末考核心考点，分值占比上限约 20 及以上；综合计算、实验探究、压轴类内容',
    '4 重点掌握：分值占比上限约 10-20；重要的规律、方法、必考点',
    '3 常规掌握：分值占比上限约 5-10；理解并能做常规题即可',
    '2 了解为主：分值占比上限约 1-5；认识和理解层面',
    '1 了解即可：分值占比极低或标「/」；拓展性、了解性、非考试重点',
  ].join('\n');
}

/**
 * 构造单批提示词。
 * 只输出 JSON 的硬要求放在最后一句——模型更容易遵循末尾的指令。
 */
export function buildStarPrompt(courses: StarCourseInput[], scope: StarScope = {}): string {
  const where = [
    scope.grade ? '年级=' + scope.grade : '',
    scope.subject ? '学科=' + scope.subject : '',
    scope.term ? '学期=' + scope.term : '',
    scope.track ? '轨=' + scope.track : '',
  ]
    .filter(Boolean)
    .join('　');

  const lines = courses.map((c) => {
    const parts = [
      'id=' + c.id,
      '内容=' + (c.content || '（无）'),
      c.type ? '类型=' + c.type : '',
      c.score ? '分值占比=' + c.score : '分值占比=/',
      c.difficulty ? '学习难度=' + c.difficulty : '学习难度=/',
      c.impact ? '后续影响=' + c.impact : '',
      c.section ? '分区=' + c.section : '',
    ].filter(Boolean);
    return '- ' + parts.join('　');
  });

  return [
    '请为下面这批课程各定一个「掌握星级」（1-5 的整数），表示学生应该把这门课掌握到什么程度。',
    where ? '适用范围：' + where : '',
    '',
    '## 档位标准',
    buildRubric(),
    '',
    '## 判定约定',
    '- 分值占比给的是区间，按上限判断',
    '- 「学习难度」表示这门课有多难，不等于该掌握多深。难度高但分值低的通常是拓展拔高内容，掌握要求应低（1-2）；难度低但分值高的是必考必会（4-5）',
    '- 「/」「—」表示未标难度，不要当成低难度',
    '- 「预习」类课程掌握要求整体偏低（1-3）；「一轮复习」「二轮复习」按其在考试中的重要性判断',
    '- 「后续影响」星级越高，说明它是后面课程的地基，掌握要求相应提高',
    '- 同一批里同类课程要互相一致，不要忽高忽低',
    '',
    '## 课程',
    ...lines,
    '',
    '## 输出要求',
    '只输出一个 JSON 对象，不要任何解释、不要 Markdown 代码块、不要数组以外的包裹层：',
    '{"results":[{"id":12,"star":3}]}',
    '每条课程的 id 都要给出，star 必须是 1-5 的整数。',
  ]
    .filter((l) => l !== null)
    .join('\n');
}

/**
 * 解析模型输出为 id → star 的决策表。
 *
 * 脏数据一律静默丢弃而不报错：模型偶尔会包 Markdown 围栏、多套一层对象、
 * 漏 id 或给出越界值，这批丢掉下一批还能补，不能因为一条坏数据让整个批量作废。
 * 重复 id 取第一次出现的值。
 */
export function parseStarResponse(text: string, validIds: Set<number>): StarDecision[] {
  const decisions: StarDecision[] = [];
  const seen = new Set<number>();

  const accept = (id: unknown, star: unknown): void => {
    const idNum = typeof id === 'string' ? parseInt(id, 10) : typeof id === 'number' ? id : NaN;
    const starNum = typeof star === 'string' ? parseInt(star, 10) : typeof star === 'number' ? star : NaN;
    if (!Number.isInteger(idNum) || !validIds.has(idNum)) return;
    if (!isValidStar(starNum)) return;
    if (seen.has(idNum)) return;
    seen.add(idNum);
    decisions.push({ id: idNum, star: starNum });
  };

  // 递归走进 results / stars / data / items 等常见包裹层，最后落到 {id, star}
  const visit = (obj: any): void => {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
      for (const item of obj) visit(item);
      return;
    }
    const wrapped = obj.results ?? obj.stars ?? obj.data ?? obj.items;
    if (Array.isArray(wrapped)) {
      for (const item of wrapped) visit(item);
      return;
    }
    if (obj.id !== undefined && obj.star !== undefined) {
      accept(obj.id, obj.star);
      return;
    }
    if (obj.id !== undefined && obj.value !== undefined) {
      accept(obj.id, obj.value);
      return;
    }
    // 再套了一层对象，比如 {"data":{"results":[...]}}
    if (wrapped && typeof wrapped === 'object') visit(wrapped);
  };

  const raw = stripToJson(String(text || ''));
  if (raw !== null) visit(raw);
  if (decisions.length) return decisions;

  return extractByRegex(String(text || ''), validIds, seen, decisions);
}

function extractByRegex(text: string, validIds: Set<number>, seen: Set<number>, decisions: StarDecision[]): StarDecision[] {
  const re = /["']?\bid\b["']?\s*[:=]\s*(\d+)\s*[,}\s]\s*["']?(?:star|mastery|value)\b["']?\s*[:=]\s*(\d+)/gi;
  const re2 = /["']?(?:star|mastery)\b["']?\s*[:=]\s*(\d+)\s*[,}]\s*["']?\bid\b["']?\s*[:=]\s*(\d+)/gi;
  const push = (idRaw: string, starRaw: string): void => {
    const idNum = parseInt(idRaw, 10);
    const starNum = parseInt(starRaw, 10);
    if (!Number.isInteger(idNum) || !validIds.has(idNum)) return;
    if (!isValidStar(starNum)) return;
    if (seen.has(idNum)) return;
    seen.add(idNum);
    decisions.push({ id: idNum, star: starNum });
  };
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) push(m[1], m[2]);
  while ((m = re2.exec(text))) push(m[2], m[1]);
  return decisions;
}

/** 剥掉 Markdown 代码围栏并尝试 JSON 解析；失败返回 null */
function stripToJson(text: string): any {
  let t = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(t);
  if (fence) t = fence[1].trim();
  // 模型偶尔会先写一段解释再给 JSON：取最外层花括号
  if (!/^\{/.test(t)) {
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start >= 0 && end > start) t = t.slice(start, end + 1);
  }
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}
