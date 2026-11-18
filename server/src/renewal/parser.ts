import ExcelJS from 'exceljs';

/**
 * 续费统计表解析器。
 *
 * 数据源：用户 Excel 里已做好的「小榄龙山学习中心 2026年秋寒个性化学生续费统计.xlsx」，
 * 16 个 sheet 合一个 workbook，既含原始数据也含用户做好的汇总表。
 *
 * 核心设计决策：**不重算业务指标**（用户 Excel 里已用公式/判定调通），
 * 而是直接读用户做好的汇总 sheet（教师统计表系列 / 学管业绩统计表 / 续生率明细）。
 *
 * 唯一需要"复刻"的是 Excel 条件格式算出的**学生网格颜色**：
 * openpyxl/exceljs 都读不到条件格式的计算结果，必须在 TS 里按同样的判定链重算，
 * 把每个学生的状态存库（见 resolveStudentStatus）。
 */

/** 学生网格颜色状态（对应 Excel 条件格式） */
export type GridStatus = 'renewed' | 'prepaid' | 'stopped' | 'closed' | 'grade3' | 'normal';

/** 教师统计表一个 tab 的解析配置 */
interface TabConfig {
  tab: 'incentive' | 'stage' | 'mentor' | 'hours';
  sheet: string;
  headerRow: number;
  dataStartRow: number;
  gridStartCol: number;     // 学生网格「学生1」所在列
  /** 输出字段 → 表头关键词（表头可能含换行，归一化后 includes 匹配） */
  fields: Record<string, string[]>;
  /** tab 特有的拆分列（存进 extra_json） */
  extra: Record<string, string[]>;
}

/** 4 个教师统计表 tab 的列映射配置 */
export const TAB_CONFIGS: TabConfig[] = [
  {
    tab: 'incentive',
    sheet: '教师统计表(激励)',
    headerRow: 3,
    dataStartRow: 5,
    gridStartCol: 15,      // O 列
    fields: {
      teacher_name: ['教师'],
      teacher_no: ['工号'],
      subject_group: ['科组'],
      base_count: ['学生基数'],
      prepaid_count: ['预存人数'],
      prepaid_rate: ['整体预存率'],
      renewed_count: ['续科人数'],
      renew_rate: ['系统续科率'],
      incentive_gap: ['激励差额'],
    },
    extra: {},
  },
  {
    tab: 'stage',
    sheet: '教师统计表 (学段)',
    headerRow: 3,
    dataStartRow: 5,
    gridStartCol: 28,      // AB 列
    fields: {
      teacher_name: ['教师'],
      teacher_no: ['工号'],
      subject_group: ['科组'],
      base_count: ['学生总数'],
      prepaid_count: ['预存人数'],
      prepaid_rate: ['预存率'],
      renewed_count: ['续科人数'],
      renew_rate: ['整体续科率'],
      incentive_gap: ['激励差额'],
    },
    extra: {
      'enroll_nongrad': ['在读人数', '非毕业班'],
      'enroll_g9': ['在读人数', '初三'],
      'enroll_g12': ['在读人数', '高三'],
      'prepaid_nongrad': ['预存人数', '非毕业班'],
      'prepaid_g9': ['预存人数', '初三'],
      'prepaid_g12': ['预存人数', '高三'],
    },
  },
  {
    tab: 'mentor',
    sheet: '教师统计表 (学管) ',
    headerRow: 3,
    dataStartRow: 5,
    gridStartCol: 28,
    fields: {
      teacher_name: ['教师'],
      teacher_no: ['工号'],
      subject_group: ['科组'],
      base_count: ['学生总数'],
      prepaid_count: ['预存人数'],
      prepaid_rate: ['预存率'],
      renewed_count: ['续科人数'],
      renew_rate: ['整体续科率'],
      incentive_gap: ['激励差额'],
    },
    extra: {},
  },
  {
    tab: 'hours',
    sheet: '教师统计表(课时)',
    headerRow: 3,
    dataStartRow: 5,
    gridStartCol: 23,      // W 列
    fields: {
      teacher_name: ['教师'],
      teacher_no: ['工号'],
      subject_group: ['科组'],
      base_count: ['学生', '总数'],
      prepaid_count: ['预存数'],
      prepaid_rate: ['预存率'],
      renewed_count: ['续生数'],
      renew_rate: [],
      incentive_gap: [],
    },
    extra: {
      'enroll_0_80': ['在读人数', '0-80'],
      'enroll_80p': ['在读人数', '80+'],
      'prepaid_0_80': ['预存人数', '0-80'],
      'prepaid_80p': ['预存人数', '80+'],
    },
  },
];

/** 续生率明细 sheet 的列位置（第 1 行表头） */
const FUNNEL_COLS: Record<string, number> = {
  manager_name: 5,        // E 学管师
  student_id: 8,          // H 学生编号
  student_name: 9,        // I 学生
  grade: 10,              // J 年级
  first_enroll_date: 11,  // K 首次报读个性化日期
  enroll_days: 12,        // L 报读时长
  coef: 13,               // M 系数
  type: 14,               // N 类型
  course_product: 15,     // O 课消产品
  class_last1: 16,        // P 上1个月是否有课消
  class_last2: 17,        // Q 上2个月是否有课消
  renewed: 18,            // R 本月是否续费
};

/** 学管业绩统计表列位置（第 3-4 行两层表头） */
const PERF_COLS: Record<string, number> = {
  manager_name: 1,  // A
  renew_1v1: 2, renew_1vN: 3, renew_small: 4, renew_other: 5, renew_total: 6,
  newsign_1v1: 7, newsign_1vN: 8, newsign_small: 9, newsign_other: 10, newsign_total: 11,
  renewed_count: 12,      // L 续生数
  tutored_count: 13,      // M 前2月辅导学生数
  renew_rate: 14,         // N 续生率
  task_amount: 15,        // O 任务（现金流）
  cashflow_total: 16,     // P 现金流合计
  completion_rate: 17,    // Q 完成率
  actual_students: 18,    // R 实际带生数
  per_student: 19,        // S 带生单产
  avg_order: 20,          // T 均单
  gap_80: 22,             // V 80%差额
};

/** 续科率 sheet 列位置（第 1 行表头） */
const XUKE_COLS = { teacher: 6, student: 8, renewed: 22, prepaid: 27 };   // F/H/V/AA

/** 老师学生 sheet 列位置（第 1 行表头） */
const TEACHER_STUDENT_COLS = {
  teacher: 2,       // B 老师姓名
  student: 3,       // C 学生姓名
  status: 12,       // L 学生状态
  prepaid: 15,      // O 预存状态
};

/** 在读学生明细 sheet 列位置（第 1 行表头） */
const STUDENT_DETAIL_COLS = { student: 10, grade: 12 };   // J/L

/** 归一化表头文本：去换行/空格，便于关键词匹配 */
function normHeader(v: unknown): string {
  return v === null || v === undefined ? '' : String(v).replace(/[\s\u3000\n]/g, '');
}

/** 读单元格为 string | number | null（公式取 result，日期格式化） */
function readCell(ws: ExcelJS.Worksheet, row: number, col: number): string | number | null {
  const cell = ws.getRow(row).getCell(col);
  const val = cell.value;
  if (val === null || val === undefined) return null;
  // Date 必须先于 object 分支判断：否则日期单元格会被当成普通对象，
  // 匹配不到 richText/result/text 后落到 return null，导致所有日期列被读成空。
  if (val instanceof Date) return formatDate(val);
  if (typeof val === 'object') {
    if ('richText' in val) {
      return (val as { richText: { text: string }[] }).richText.map(r => r.text).join('');
    }
    if ('result' in val) {
      const r = (val as { result: unknown }).result;
      if (r === null || r === undefined) return null;
      if (r instanceof Date) return formatDate(r);
      return typeof r === 'number' ? r : String(r);
    }
    if ('text' in val && 'hyperlink' in val) return String((val as { text: string }).text);
    return null;
  }
  if (typeof val === 'string') {
    const t = val.trim();
    if (t === '' || t.startsWith('#')) return null;   // #DIV/0! #VALUE! 等公式错误当空
    return t;
  }
  if (typeof val === 'number') return val;
  if (typeof val === 'boolean') return val ? 1 : 0;
  return String(val);
}

function formatDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 转数字；字符串里的百分号（如 '85.71%'）先剥掉 */
function toNum(v: string | number | null): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  const s = v.trim().replace(/%/g, '').replace(/,/g, '');
  if (s === '' || s === '-' || s === '/') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** 归一化表头 → 列索引映射（多关键词匹配） */
function buildHeaderMap(ws: ExcelJS.Worksheet, headerRow: number): Map<string, number> {
  const map = new Map<string, number>();
  for (let col = 1; col <= ws.columnCount; col++) {
    const text = normHeader(readCell(ws, headerRow, col));
    if (text) map.set(text, col);
  }
  return map;
}

/** 在表头映射里找一个关键词组合（全部包含即命中）的列号 */
function findCol(headerMap: Map<string, number>, keywords: string[]): number | null {
  for (const [text, col] of headerMap) {
    if (keywords.every(k => text.includes(k))) return col;
  }
  return null;
}

/** 老师姓名 → 年级（用于高三标记） */
type GradeMap = Map<string, string>;
/** (老师&学生) → 学生状态（在读/结课/停课） */
type StatusMap = Map<string, string>;
/** (学生&老师) → 是否预存（续科率 AA 列） */
type PrepaidPairMap = Map<string, boolean>;
/** 学生姓名 → 是否已续费（续科率 V 列） */
type RenewedMap = Map<string, boolean>;
/** 学生姓名 → 是否预存（老师学生 O 列） */
type PrepaidNameMap = Map<string, boolean>;

/**
 * 复刻 Excel 条件格式的学生网格颜色判定链。
 *
 * 优先级（先匹配先定）：
 *   1. 结课/停课（老师学生!L 列状态）→ closed / stopped
 *   2. 已续费（续科率!V 本月是否续科 = 是）→ renewed
 *   3. 已预存（续科率!AA 预存 = 是 或 老师学生!O 预存状态 = 是）→ prepaid
 *   4. 高三（在读学生明细!L 年级 = 高三）→ grade3
 *   5. 其余 → normal
 */
export function resolveStudentStatus(
  teacherName: string,
  studentName: string,
  ctx: {
    statusMap: StatusMap;
    renewedMap: RenewedMap;
    prepaidPairMap: PrepaidPairMap;
    prepaidNameMap: PrepaidNameMap;
    gradeMap: GradeMap;
  }
): GridStatus {
  const pairKey = teacherName + studentName;
  const st = ctx.statusMap.get(pairKey);
  if (st === '结课') return 'closed';
  if (st === '停课') return 'stopped';
  if (ctx.renewedMap.get(studentName)) return 'renewed';
  if (ctx.prepaidPairMap.get(teacherName + studentName) || ctx.prepaidNameMap.get(studentName)) {
    return 'prepaid';
  }
  if (ctx.gradeMap.get(studentName) === '高三') return 'grade3';
  return 'normal';
}

/** 构建颜色判定上下文（从 3 个源 sheet 读） */
export function buildColorContext(workbook: ExcelJS.Workbook): {
  statusMap: StatusMap;
  renewedMap: RenewedMap;
  prepaidPairMap: PrepaidPairMap;
  prepaidNameMap: PrepaidNameMap;
  gradeMap: GradeMap;
} {
  const statusMap: StatusMap = new Map();
  const prepaidNameMap: PrepaidNameMap = new Map();
  const wsTS = workbook.getWorksheet('老师学生');
  if (wsTS) {
    for (let r = 2; r <= wsTS.rowCount; r++) {
      const teacher = readCell(wsTS, r, TEACHER_STUDENT_COLS.teacher);
      const student = readCell(wsTS, r, TEACHER_STUDENT_COLS.student);
      const status = readCell(wsTS, r, TEACHER_STUDENT_COLS.status);
      const prepaid = readCell(wsTS, r, TEACHER_STUDENT_COLS.prepaid);
      if (typeof teacher !== 'string' || typeof student !== 'string') continue;
      if (typeof status === 'string' && (status === '结课' || status === '停课')) {
        statusMap.set(teacher + student, status);
      }
      if (prepaid === '是') prepaidNameMap.set(student, true);
    }
  }

  const renewedMap: RenewedMap = new Map();
  const prepaidPairMap: PrepaidPairMap = new Map();
  const wsXK = workbook.getWorksheet('续科率');
  if (wsXK) {
    for (let r = 2; r <= wsXK.rowCount; r++) {
      const teacher = readCell(wsXK, r, XUKE_COLS.teacher);
      const student = readCell(wsXK, r, XUKE_COLS.student);
      const renewed = readCell(wsXK, r, XUKE_COLS.renewed);
      const prepaid = readCell(wsXK, r, XUKE_COLS.prepaid);
      if (typeof student !== 'string' || student === '') continue;
      if (renewed === '是') renewedMap.set(student, true);
      if (prepaid === '是' && typeof teacher === 'string' && teacher !== '') {
        prepaidPairMap.set(teacher + student, true);
      }
    }
  }

  const gradeMap: GradeMap = new Map();
  const wsSD = workbook.getWorksheet('在读学生明细');
  if (wsSD) {
    for (let r = 2; r <= wsSD.rowCount; r++) {
      const student = readCell(wsSD, r, STUDENT_DETAIL_COLS.student);
      const grade = readCell(wsSD, r, STUDENT_DETAIL_COLS.grade);
      if (typeof student === 'string' && typeof grade === 'string' && grade !== '') {
        gradeMap.set(student, grade);
      }
    }
  }

  return { statusMap, renewedMap, prepaidPairMap, prepaidNameMap, gradeMap };
}

/** 单行教师统计 + 学生网格结果 */
export interface TeacherStatsRow {
  tab: string;
  teacherName: string;
  teacherNo: string | null;
  subjectGroup: string | null;
  baseCount: number | null;
  prepaidCount: number | null;
  prepaidRate: number | null;
  renewedCount: number | null;
  renewRate: number | null;
  incentiveGap: number | null;
  extra: Record<string, number | null>;
  students: { name: string; status: GridStatus; slot: number }[];
  sourceRow: number;
}

/**
 * 解析 4 个教师统计表 tab：汇总表指标 + 学生网格（含颜色状态）。
 */
export function parseTeacherStats(
  workbook: ExcelJS.Workbook,
  colorCtx: ReturnType<typeof buildColorContext>
): TeacherStatsRow[] {
  const rows: TeacherStatsRow[] = [];

  for (const cfg of TAB_CONFIGS) {
    const ws = workbook.getWorksheet(cfg.sheet.trim());
    if (!ws) continue;

    const headerMap = buildHeaderMap(ws, cfg.headerRow);
    const colOf: Record<string, number | null> = {};
    for (const [field, keywords] of Object.entries(cfg.fields)) {
      colOf[field] = keywords.length ? findCol(headerMap, keywords) : null;
    }
    const extraColOf: Record<string, number | null> = {};
    for (const [field, keywords] of Object.entries(cfg.extra)) {
      extraColOf[field] = findCol(headerMap, keywords);
    }

    let slot = 0;
    for (let r = cfg.dataStartRow; r <= ws.rowCount; r++) {
      const teacherName = colOf.teacher_name ? readCell(ws, r, colOf.teacher_name!) : null;
      if (typeof teacherName !== 'string' || teacherName === '') break;

      const pick = (f: string): string | number | null =>
        colOf[f] ? readCell(ws, r, colOf[f]!) : null;

      const extra: Record<string, number | null> = {};
      for (const [field, col] of Object.entries(extraColOf)) {
        if (col) extra[field] = toNum(readCell(ws, r, col));
      }

      // 学生网格：从 gridStartCol 往右读，连续空则停
      const students: { name: string; status: GridStatus; slot: number }[] = [];
      for (let col = cfg.gridStartCol; col < cfg.gridStartCol + 80; col++) {
        const name = readCell(ws, r, col);
        if (typeof name !== 'string' || name === '') { slot++; continue; }
        slot++;
        students.push({
          name,
          status: resolveStudentStatus(teacherName, name, colorCtx),
          slot,
        });
      }

      rows.push({
        tab: cfg.tab,
        teacherName,
        teacherNo: pick('teacher_no') as string | null,
        subjectGroup: pick('subject_group') as string | null,
        baseCount: toNum(pick('base_count')),
        prepaidCount: toNum(pick('prepaid_count')),
        prepaidRate: toNum(pick('prepaid_rate')),
        renewedCount: toNum(pick('renewed_count')),
        renewRate: toNum(pick('renew_rate')),
        incentiveGap: toNum(pick('incentive_gap')),
        extra,
        students,
        sourceRow: r,
      });
    }
  }

  return rows;
}

/** 学管业绩统计行 */
export interface ManagerPerfRow {
  managerName: string;
  renew: { one2one: number|null; one2many: number|null; small: number|null; other: number|null; total: number|null };
  newsign: { one2one: number|null; one2many: number|null; small: number|null; other: number|null; total: number|null };
  renewedCount: number | null;
  tutoredCount: number | null;
  renewRate: number | null;
  taskAmount: number | null;
  cashflowTotal: number | null;
  completionRate: number | null;
  actualStudents: number | null;
  perStudent: number | null;
  avgOrder: number | null;
  gap80: number | null;
  sourceRow: number;
}

/** 解析学管业绩统计表 */
export function parseManagerPerf(workbook: ExcelJS.Workbook): ManagerPerfRow[] {
  const ws = workbook.getWorksheet('学管业绩统计表');
  if (!ws) return [];
  const rows: ManagerPerfRow[] = [];

  for (let r = 5; r <= ws.rowCount; r++) {
    const name = readCell(ws, r, PERF_COLS.manager_name);
    if (typeof name !== 'string' || name === '' || name === '合计' || name === '学习中心') continue;
    const g = (field: string) => toNum(readCell(ws, r, PERF_COLS[field]!));

    rows.push({
      managerName: name,
      renew: {
        one2one: g('renew_1v1'), one2many: g('renew_1vN'), small: g('renew_small'),
        other: g('renew_other'), total: g('renew_total'),
      },
      newsign: {
        one2one: g('newsign_1v1'), one2many: g('newsign_1vN'), small: g('newsign_small'),
        other: g('newsign_other'), total: g('newsign_total'),
      },
      renewedCount: g('renewed_count'),
      tutoredCount: g('tutored_count'),
      renewRate: g('renew_rate'),
      taskAmount: g('task_amount'),
      cashflowTotal: g('cashflow_total'),
      completionRate: g('completion_rate'),
      actualStudents: g('actual_students'),
      perStudent: g('per_student'),
      avgOrder: g('avg_order'),
      gap80: g('gap_80'),
      sourceRow: r,
    });
  }

  return rows;
}

/** 续生率明细行（漏斗 + 风险清单数据源） */
export interface FunnelRow {
  managerName: string | null;
  studentId: string | null;
  studentName: string;
  grade: string | null;
  firstEnrollDate: string | null;
  enrollDays: number | null;
  coef: number | null;
  type: string | null;
  courseProduct: string | null;
  classLast1: number | null;
  classLast2: number | null;
  renewed: number | null;
  sourceRow: number;
}

/**
 * 解析续生率明细（A:R 主表）。
 * 该 sheet 第 2 行起在 AG/AH/AI 等列有辅助计算块（#DIV/0!），只读 A:R，
 * 并要求学生姓名非空 —— 自然跳过辅助块行。
 */
export function parseFunnel(workbook: ExcelJS.Workbook): FunnelRow[] {
  const ws = workbook.getWorksheet('续生率');
  if (!ws) return [];
  const rows: FunnelRow[] = [];

  const yesNo = (v: string | number | null): number | null => {
    if (v === '是') return 1;
    if (v === '否') return 0;
    return null;
  };

  for (let r = 2; r <= ws.rowCount; r++) {
    const studentName = readCell(ws, r, FUNNEL_COLS.student_name);
    if (typeof studentName !== 'string' || studentName === '') continue;

    const mgr = readCell(ws, r, FUNNEL_COLS.manager_name);
    const sid = readCell(ws, r, FUNNEL_COLS.student_id);
    const grade = readCell(ws, r, FUNNEL_COLS.grade);
    const firstDate = readCell(ws, r, FUNNEL_COLS.first_enroll_date);

    rows.push({
      managerName: typeof mgr === 'string' ? mgr : null,
      studentId: typeof sid === 'string' ? sid : null,
      studentName,
      grade: typeof grade === 'string' ? grade : null,
      firstEnrollDate: typeof firstDate === 'string' ? firstDate : null,
      enrollDays: toNum(readCell(ws, r, FUNNEL_COLS.enroll_days)),
      coef: toNum(readCell(ws, r, FUNNEL_COLS.coef)),
      type: (() => { const t = readCell(ws, r, FUNNEL_COLS.type); return typeof t === 'string' ? t : null; })(),
      courseProduct: (() => { const t = readCell(ws, r, FUNNEL_COLS.course_product); return typeof t === 'string' ? t : null; })(),
      classLast1: yesNo(readCell(ws, r, FUNNEL_COLS.class_last1)),
      classLast2: yesNo(readCell(ws, r, FUNNEL_COLS.class_last2)),
      renewed: yesNo(readCell(ws, r, FUNNEL_COLS.renewed)),
      sourceRow: r,
    });
  }

  return rows;
}

/**
 * 从续生率 sheet 标题区抽取统计月份与学习中心名。
 * 纯函数、无模块级状态（多次上传/测试不会串数据）。
 * 标题区在前 3 行，扫一遍找「XX学习中心」和「YYYY年MM月」。
 */
export function extractReportMeta(workbook: ExcelJS.Workbook): { statMonth: string | null; centerName: string | null } {
  const ws = workbook.getWorksheet('续生率');
  if (!ws) return { statMonth: null, centerName: null };

  let statMonth: string | null = null;
  let centerName: string | null = null;

  const maxCol = Math.min(ws.columnCount, 97);
  for (let r = 1; r <= Math.min(3, ws.rowCount); r++) {
    for (let col = 1; col <= maxCol; col++) {
      const v = readCell(ws, r, col);
      if (typeof v !== 'string' || v.length < 4) continue;
      if (!centerName) {
        const cm = v.match(/([\u4e00-\u9fa5A-Za-z0-9]{2,12}学习中心)/);
        if (cm) centerName = cm[1];
      }
      if (!statMonth) {
        const mm = v.match(/(\d{4})年(\d{1,2})月/);
        if (mm) statMonth = `${mm[1]}-${String(mm[2]).padStart(2, '0')}`;
      }
      if (statMonth && centerName) break;
    }
  }

  return { statMonth, centerName };
}
