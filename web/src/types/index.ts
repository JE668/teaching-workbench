// 用户类型
export interface User {
  id: number;
  username: string;
  createdAt: string;
}

// 学生类型
export interface Student {
  id: number;
  name: string;
  grade: string;
  subject: string;
  phone?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

// 回访类型
export interface FollowUp {
  id: number;
  studentId: number | null;
  studentName: string;
  grade: string;
  subject: string;
  topic: string;
  performance: string;
  mastery: string;
  /** 本次回访涵盖的课次数（1-3） */
  sessionCount: number;
  /** 课程类型：1对1 或 小组课 */
  courseType: CourseType;
  /** 流程打卡类型（首个板块），保留兼容字段 */
  module: FollowUpModule;
  /** 本次回访覆盖的板块清单；生成内容按板块逐段展开 */
  modules: FollowUpModule[];
  images: string[];
  content: string;
  wordCount: number;
  /** 小组课批次 id：同一次小组课拆出的 N 条共享；1对1 为 null */
  batchId: string | null;
  createdAt: string;
  updatedAt: string;
}

// 学生年级列表
export const GRADES = [
  '幼儿园',
  '小学一年级',
  '小学二年级',
  '小学三年级',
  '小学四年级',
  '小学五年级',
  '小学六年级',
  '初一',
  '初二',
  '初三',
  '高一',
  '高二',
  '高三',
];

// 学科列表
export const SUBJECTS = [
  '语文',
  '数学',
  '英语',
  '物理',
  '化学',
  '生物',
  '历史',
  '地理',
  '政治',
  '科学',
  '编程',
  '其他',
];

// 课程类型
export type CourseType = 'one_on_one' | 'group';

export const COURSE_TYPES: { value: CourseType; label: string; hint: string }[] = [
  { value: 'one_on_one', label: '1对1', hint: '面向单个学生，文案中会使用学生称呼' },
  { value: 'group', label: '小组课', hint: '面向全班，文案不含任何学生姓名，可同时归档给多名学生' },
];

// ============ 流程打卡类型（学校 2026 新规）============
//
// 常规类 8 种是日常回访的主体，非常规类 8 种是特殊情况的沟通。
// 每周配额按「覆盖的种类数」算，两组合并统计，5 种以上即达标。
// 选中哪种，AI 生成的三段（课堂内容 / 学生收获 / 课后任务）就侧重那个模块——
// 服务端对应实现在 server/src/services/ai.ts 的 MODULE_GUIDANCE，key 必须保持一致。

export type FollowUpModule =
  | 'preview'
  | 'homework_review'
  | 'class_summary'
  | 'note_trace'
  | 'mistake_drill'
  | 'homework_assign'
  | 'accumulation'
  | 'exam_prep'
  | 'grade_analysis'
  | 'stage_test'
  | 'plan_adjust'
  | 'student_request'
  | 'academic_assist'
  | 'extra_class'
  | 'makeup_plan';

export interface FollowUpModuleOption {
  value: FollowUpModule;
  label: string;
  hint: string;
}

export interface FollowUpModuleGroup {
  group: '常规类' | '非常规类';
  hint: string;
  modules: FollowUpModuleOption[];
}

export const FOLLOWUP_MODULE_GROUPS: FollowUpModuleGroup[] = [
  {
    group: '常规类',
    hint: '日常回访的主体，与非常规类合并计入每周 5 种',
    modules: [
      { value: 'preview', label: '预习资料', hint: '资料覆盖哪些知识点、孩子怎么用，任务要具体到页码题号' },
      { value: 'homework_review', label: '作业批改', hint: '完成质量、错在哪些知识点、怎么订正' },
      { value: 'class_summary', label: '课堂总结', hint: '这节课讲了什么、孩子有什么收获、回家练什么' },
      { value: 'note_trace', label: '笔记痕迹', hint: '板书有没有记全、有没有自己的补充和思考' },
      { value: 'mistake_drill', label: '错题专练', hint: '哪几类错题专练了什么方法、现在掌握到什么程度' },
      { value: 'homework_assign', label: '作业布置', hint: '布置了什么、为什么做、预计花多久' },
      { value: 'accumulation', label: '积累打卡', hint: '今天攒了什么、多少量，明天接着做什么' },
      { value: 'exam_prep', label: '备考资料', hint: '资料是什么、覆盖什么范围、孩子怎么用' },
    ],
  },
  {
    group: '非常规类',
    hint: '特殊情况的沟通，与常规类合并计入每周 5 种',
    modules: [
      { value: 'grade_analysis', label: '成绩分析', hint: '成绩从哪来、丢分在哪、接下来怎么提分' },
      { value: 'stage_test', label: '阶测反馈', hint: '阶段性测评的整体反馈，体现板块与短板的变化' },
      { value: 'plan_adjust', label: '规划调整', hint: '调整了什么、为什么改、改完之后怎么推进' },
      { value: 'student_request', label: '学生要求', hint: '孩子自己提了什么诉求、老师怎么回应' },
      { value: 'academic_assist', label: '学管协助', hint: '排课、上课方式、家校衔接等配合事项' },
      { value: 'extra_class', label: '加课沟通', hint: '加在哪一块、什么时间、为什么需要加' },
      { value: 'makeup_plan', label: '补课安排', hint: '补的是哪一块、补完掌握得怎么样、怎么巩固' },
    ],
  },
];

/** 全部打卡类型（不分组的扁平表），供回显与查找使用 */
export const FOLLOWUP_MODULES: FollowUpModuleOption[] = FOLLOWUP_MODULE_GROUPS.flatMap(
  (g) => g.modules
);

export const FOLLOWUP_MODULE_LABELS: Record<FollowUpModule, string> =
  FOLLOWUP_MODULES.reduce((acc, m) => {
    acc[m.value] = m.label;
    return acc;
  }, {} as Record<FollowUpModule, string>);

export const FOLLOWUP_MODULE_GROUPS_BY_VALUE: Record<
  FollowUpModule,
  '常规类' | '非常规类'
> = FOLLOWUP_MODULES.reduce((acc, m) => {
  acc[m.value] = FOLLOWUP_MODULE_GROUPS.find((g) => g.modules.includes(m))!.group;
  return acc;
}, {} as Record<FollowUpModule, '常规类' | '非常规类'>);

export const DEFAULT_FOLLOWUP_MODULE: FollowUpModule = 'class_summary';

/** 学校新规：一次回访内容里要覆盖 5 个以上板块 */
export const FOLLOWUP_MIN_BLOCKS = 5;

/** 默认勾选的 5 个板块：一周一遍课最核心的流程（可自由增减） */
export const DEFAULT_FOLLOWUP_MODULES: FollowUpModule[] = [
  'class_summary',
  'preview',
  'homework_review',
  'mistake_drill',
  'homework_assign',
];

/** 按 FOLLOWUP_MODULES 的声明顺序排，保证内容里的段顺序稳定 */
export function sortFollowUpModules(mods: FollowUpModule[]): FollowUpModule[] {
  const order = FOLLOWUP_MODULES.reduce<Record<string, number>>((acc, m, i) => {
    acc[m.value] = i;
    return acc;
  }, {});
  return [...mods].sort((a, b) => (order[a] ?? 99) - (order[b] ?? 99));
}

/**
 * 打卡类型的周配额：覆盖 5 种以上即视为本周达标，常规类与非常规类**合并**统计。
 * 不写成从分组数量推导：常规类现在是 8 种，推导会得到 8，与学校的 5 种不符。
 */
export const WEEKLY_FOLLOWUP_QUOTA = 5;

/** 本周流程打卡进度里的单个类型 */
export interface FollowUpWeeklyType {
  value: FollowUpModule;
  label: string;
  group: 'regular' | 'unusual';
  count: number;
}

/**
 * 本周流程打卡进度。
 * 口径按**覆盖的打卡类型种类**统计，不按打卡条数——
 * 同一个孩子一周回访三次课堂总结，也只算覆盖了 1 种。
 */
export interface FollowUpWeeklyStats {
  weekStart: string; // 北京周一 YYYY-MM-DD
  weekEnd: string; // 北京周日 YYYY-MM-DD
  quota: number; // 常规类配额
  covered: number; // 本周覆盖的常规类种类数
  records: number; // 本周打卡总条数
  types: FollowUpWeeklyType[];
}

// 单次回访可涵盖的课次数
export const SESSION_COUNTS = [1, 2, 3];

// 掌握程度列表
export const MASTERY_LEVELS = [
  { value: 'excellent', label: '优秀' },
  { value: 'good', label: '良好' },
  { value: 'average', label: '一般' },
  { value: 'needs_improvement', label: '需加强' },
];

// ============ 听评课（独立于课后回访） ============
export type LessonType = 'new' | 'review' | 'practice' | 'explain' | 'other';
export type OverallGrade = 'excellent' | 'good' | 'pass' | 'needs_work';

/** 课型（对应 Word 表"课型"栏） */
export const LESSON_TYPES: { value: LessonType; label: string }[] = [
  { value: 'new', label: '新授课' },
  { value: 'review', label: '复习课' },
  { value: 'practice', label: '练习课' },
  { value: 'explain', label: '讲评课' },
  { value: 'other', label: '其他' },
];

/** 总体评价等级（对应 Word 表"总体评价等级"栏） */
export const OVERALL_GRADES: { value: OverallGrade; label: string }[] = [
  { value: 'excellent', label: '优秀' },
  { value: 'good', label: '良好' },
  { value: 'pass', label: '合格' },
  { value: 'needs_work', label: '有待提高' },
];

export const OBSERVATION_STATUS: { value: string; label: string }[] = [
  { value: 'draft', label: '草稿' },
  { value: 'sent', label: '已反馈' },
  { value: 'archived', label: '已归档' },
];

export interface Teacher {
  id: number;
  name: string;
  subject: string | null;
  createdAt: string;
}

export interface Observation {
  id: number;
  teacherId: number | null;
  /** 被听课老师姓名（关联不到时为 "—"） */
  teacherName: string;
  /** 课题 */
  topic: string;
  /** 关联的目录课时（课题手输、目录里查不到时为 null） */
  courseId: number | null;
  lessonType: LessonType;
  /** 听课时间 */
  observedAt: string | null;
  // 以下为 AI 参考输入（不进 Word 表）
  grade: string | null;
  subject: string | null;
  level: string | null;
  studentName: string | null;
  /** 听课记录 / 课堂实录（AI 评课依据） */
  classNotes: string;
  /** AI 评课报告（8 项一句话 + 综合评价与建议） */
  report: string;
  reportAt: string | null;
  /** 总体评价等级 */
  overallGrade: OverallGrade | null;
  /** draft / sent / archived */
  status: string;
  /** 老师对评课的回应（可选） */
  teacherReply: string;
  createdAt: string;
  updatedAt: string;
}

export function lessonTypeLabel(v: string): string {
  return LESSON_TYPES.find((x) => x.value === v)?.label ?? '其他';
}
export function overallGradeLabel(v: string | null): string {
  if (!v) return '';
  return OVERALL_GRADES.find((x) => x.value === v)?.label ?? '';
}

/** 按被听课老师聚合的统计（老师统计看板用） */
export interface TeacherStat {
  teacherId: number;
  teacherName: string;
  subject: string | null;
  obsCount: number;
  lastObservedAt: string | null;
  grades: {
    excellent: number;
    good: number;
    pass: number;
    needs_work: number;
    ungraded: number;
  };
}

/** 覆盖率维度下的单个老师（与 TeacherStat 不同：这里是"是否被听过"，不是"听了几次"） */
export interface CoverageTeacher {
  teacherId: number;
  teacherName: string;
  subject: string | null;
  /** 时间窗内的听课次数 */
  windowCount: number;
  /** 全时段最后一次听课日期（窗外名单也要能看出上次是哪天听的） */
  lastObservedAt: string | null;
  /** 距离最后一次听课的天数；从未听过课为 null */
  daysSince: number | null;
}

export interface CoverageData {
  window: { days: number; from: string; to: string };
  totalTeachers: number;
  observedCount: number;
  unobservedCount: number;
  /** observedCount / totalTeachers；无老师时为 0 */
  coverage: number;
  observed: CoverageTeacher[];
  unobserved: CoverageTeacher[];
}
