/**
 * 课程目录的排序口径。
 *
 * 目录页的分组顺序、导出 Excel 的行顺序、AI 定档的取数顺序、筛选下拉的选项顺序，
 * 四处都要按「年级 → 学科 → 学期 → 轨 → 序号」走。各写一份早晚就不一致了，
 * 统一收敛到这里：
 *   - SQL 侧用 COURSE_ORDER（CASE 表达式，避免字典序把初一排到四年级前面）
 *   - JS 侧用 compareXxx（筛选项下拉直接按后端返回顺序渲染）
 *
 * 注意：SQLite 默认的 ORDER BY 是字典序，而汉字 Unicode 码位里
 * 「初」(0x521d) < 「四」(0x56db) < 「高」(0x9ad8)，所以直接 ORDER BY grade
 * 会把初中排到小学前面。这才是页面上「年级乱序」的根因。
 */

export const GRADE_ORDER = [
  '一年级', '二年级', '三年级',
  '四年级', '五年级', '六年级',
  '初一', '初二', '初三',
  '高一', '高二', '高三',
];

export const SUBJECT_ORDER = [
  '语文', '数学', '英语', '物理', '化学', '生物', '地理',
  '历史', '政治', '道法', '体育', '美术', '音乐', '信息', '科学', '思品',
];

/** 学期按学年时间线：暑假在下学期之前，高三的一/二/三轮复习在最后 */
export const TERM_ORDER = ['暑假', '秋季', '寒假', '春季', '一轮复习', '二轮复习', '三轮复习'];

/** 轨：基础 → 进阶 → 拓展拔尖；空轨（单列布局的表）排最后 */
export const TRACK_ORDER = ['基础', '进阶', '拓展拔尖'];

function byRank(values: string[]): (v: string) => number {
  const rank = new Map(values.map((v, i) => [v, i + 1]));
  const top = Number.MAX_SAFE_INTEGER - 1;
  return (v) => rank.get(v) ?? top;
}

const gradeRank = byRank(GRADE_ORDER);
const subjectRank = byRank(SUBJECT_ORDER);
const termRank = byRank(TERM_ORDER);
const trackRank = byRank(TRACK_ORDER);

/**
 * 排序比较器工厂：先按自定义顺序，再按中文本地序兜底。
 * 空值排在最后（目录里空轨、空难度都是「这条不适用」，不该占着前排）。
 */
function makeCompare(rank: (v: string) => number): (a: string, b: string) => number {
  return (a, b) => {
    if (!a && !b) return 0;
    if (!a) return 1;
    if (!b) return -1;
    const d = rank(a) - rank(b);
    return d !== 0 ? d : a.localeCompare(b, 'zh-Hans-CN');
  };
}

export const compareGrade = makeCompare(gradeRank);
export const compareSubject = makeCompare(subjectRank);
export const compareTerm = makeCompare(termRank);
export const compareTrack = makeCompare(trackRank);

/** 无自定义顺序的字段：中文本地序，空值排最后 */
export const compareZh = makeCompare(() => 0);

/**
 * SQL 里的排序键：CASE WHEN 打序号，未收录的值一律排最后。
 * 外层加括号、不加别名——ORDER BY 里写 `... END AS xxx` 在 SQLite 上是语法错误。
 */
function rankCase(column: string, values: string[]): string {
  const arms = values.map((v, i) => `WHEN '${v.replace(/'/g, "''")}' THEN ${i + 1}`).join(' ');
  return `((CASE ${column} ${arms} ELSE 9999 END))`;
}

/**
 * 课程清单 / 导出 Excel 的统一排序。
 * 分节行（阶段性测试）跟它所属的课程同一个 (term, track) 下，靠 seq 自然落位。
 */
export const COURSE_ORDER =
  `ORDER BY ${rankCase('grade', GRADE_ORDER)}, ` +
  `${rankCase('subject', SUBJECT_ORDER)}, ` +
  `${rankCase('term', TERM_ORDER)}, ` +
  `${rankCase('track', TRACK_ORDER)}, ` +
  'seq, id';
