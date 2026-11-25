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
      renewed_count: ['续生数'],
      renew_rate: ['续生率'],
      incentive_gap: ['80%人数差值'],
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
      renewed_count: ['续生数'],
      renew_rate: ['续生率'],
      incentive_gap: ['80%人数差值'],
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
      renew_rate: ['续生率'],
      incentive_gap: ['80%人数差值'],
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
const XUKE_COLS = { teacher: 6, student: 8, studentId: 9, renewed: 22, prepaid: 27 }; // F/H/I/V/AA

/** 老师学生 sheet 列位置（第 1 行表头） */
const TEACHER_STUDENT_COLS = {
  teacher: 2,       // B 老师姓名
  student: 3,       // C 学生姓名
  status: 12,       // L 学生状态
  prepaid: 15,      // O 预存状态
  studentId: 24,    // X ID（部分模板的主续费表编号为空，可在此补充）
};

/** 在读学生明细 sheet 列位置（第 1 行表头） */
const STUDENT_DETAIL_COLS = { student: 10, studentId: 11, grade: 12 }; // J/K/L

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
    // ExcelJS 4.4.0 的 FormulaValue.value 用真值判断复制 result，导致数值 0
    // 和空字符串从公开 value 中消失；底层 model 仍保留 Excel 的原始缓存。
    // 优先读公开 value，缺失时回退 model，避免把有效的 0 当成无数据。
    if ('result' in val || cell.model.result !== undefined) {
      const r = 'result' in val
        ? (val as { result: unknown }).result
        : cell.model.result;
      if (r === null || r === undefined) return null;
      if (r instanceof Date) return formatDate(r);
      if (typeof r === 'object' && 'error' in r) return null;
      if (typeof r === 'string' && r.trim().startsWith('#')) return null;
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

function toIdentifier(value: string | number | null): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
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

/** Excel 比率可能存为 0–1 数值、0–100 数值或带百分号字符串；接口统一输出 0–100。 */
function toRate(v: string | number | null): number | null {
  if (v === null || v === undefined) return null;
  const hasPercent = typeof v === 'string' && v.includes('%');
  const n = toNum(v);
  if (n === null || hasPercent || n === 0) return n;
  return n > 0 && n <= 1 ? n * 100 : n;
}

/** 读取合并单元格的表头文本；从属单元格统一取 master，避免空表头或重复覆盖。 */
function readHeader(ws: ExcelJS.Worksheet, row: number, col: number): string {
  const cell = ws.getRow(row).getCell(col);
  if (!cell.isMerged || cell.master === cell) return normHeader(readCell(ws, row, col));
  const master = cell.master;
  return normHeader(readCell(ws, Number(master.row), Number(master.col)));
}

/** 合并两行表头，例如「在读人数」+「非毕业班」→「在读人数非毕业班」。 */
function buildHeaderMap(ws: ExcelJS.Worksheet, headerRow: number): Map<string, number> {
  const map = new Map<string, number>();
  for (let col = 1; col <= ws.columnCount; col++) {
    const top = readHeader(ws, headerRow, col);
    const sub = readHeader(ws, headerRow + 1, col);
    const text = top === sub ? top : [top, sub].filter(Boolean).join('');
    // 相同文本保留最左列；精确/包含匹配在 findCol 中再排序。
    if (text && !map.has(text)) map.set(text, col);
  }
  return map;
}

/** 精确匹配优先，其次是总计列，最后取剩余候选中表头最短者，避免误中首个拆分列。 */
function findCol(headerMap: Map<string, number>, keywords: string[]): number | null {
  const words = keywords.map(normHeader).filter(Boolean);
  if (words.length === 0) return null;
  const joined = words.join('');
  const candidates = Array.from(headerMap.entries())
    .filter(([text]) => words.every(word => text.includes(word)))
    .sort(([aText, aCol], [bText, bCol]) => {
      const aExact = aText === joined ? 0 : 1;
      const bExact = bText === joined ? 0 : 1;
      if (aExact !== bExact) return aExact - bExact;
      const aTotal = words.length === 1 && /^(总|合计)/.test(aText) ? 0 : 1;
      const bTotal = words.length === 1 && /^(总|合计)/.test(bText) ? 0 : 1;
      if (aTotal !== bTotal) return aTotal - bTotal;
      return aText.length - bText.length || aCol - bCol;
    });
  return candidates[0]?.[1] ?? null;
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
/** 学生姓名 → 唯一学生编号；多来源冲突时删除映射，保留身份不明确。 */
type StudentIdMap = Map<string, string>;

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
  const st = ctx.statusMap?.get(pairKey);
  if (st === '结课') return 'closed';
  if (st === '停课') return 'stopped';
  if (ctx.renewedMap?.get(studentName)) return 'renewed';
  if (ctx.prepaidPairMap?.get(teacherName + studentName) || ctx.prepaidNameMap?.get(studentName)) {
    return 'prepaid';
  }
  if (ctx.gradeMap?.get(studentName) === '高三') return 'grade3';
  return 'normal';
}

/** 构建颜色判定上下文（从 3 个源 sheet 读） */
export function buildColorContext(workbook: ExcelJS.Workbook): {
  statusMap: StatusMap;
  renewedMap: RenewedMap;
  prepaidPairMap: PrepaidPairMap;
  prepaidNameMap: PrepaidNameMap;
  gradeMap: GradeMap;
  studentIdMap: StudentIdMap;
} {
  const statusMap: StatusMap = new Map();
  const studentIdMap: StudentIdMap = new Map();
  const ambiguousStudentNames = new Set<string>();
  const collectStudentId = (student: unknown, studentId: string | null) => {
    if (typeof student !== 'string' || student === '' || !studentId || ambiguousStudentNames.has(student)) return;
    const existing = studentIdMap.get(student);
    if (existing && existing !== studentId) {
      studentIdMap.delete(student);
      ambiguousStudentNames.add(student);
      return;
    }
    studentIdMap.set(student, studentId);
  };
  const prepaidNameMap: PrepaidNameMap = new Map();
  const wsTS = workbook.getWorksheet('老师学生');
  if (wsTS) {
    for (let r = 2; r <= wsTS.rowCount; r++) {
      const teacher = readCell(wsTS, r, TEACHER_STUDENT_COLS.teacher);
      const student = readCell(wsTS, r, TEACHER_STUDENT_COLS.student);
      const status = readCell(wsTS, r, TEACHER_STUDENT_COLS.status);
      const prepaid = readCell(wsTS, r, TEACHER_STUDENT_COLS.prepaid);
      const studentId = toIdentifier(readCell(wsTS, r, TEACHER_STUDENT_COLS.studentId));
      if (typeof teacher !== 'string' || typeof student !== 'string') continue;
      collectStudentId(student, studentId);
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
      const studentId = toIdentifier(readCell(wsXK, r, XUKE_COLS.studentId));
      const renewed = readCell(wsXK, r, XUKE_COLS.renewed);
      const prepaid = readCell(wsXK, r, XUKE_COLS.prepaid);
      if (typeof student !== 'string' || student === '') continue;
      collectStudentId(student, studentId);
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
      const studentId = toIdentifier(readCell(wsSD, r, STUDENT_DETAIL_COLS.studentId));
      const grade = readCell(wsSD, r, STUDENT_DETAIL_COLS.grade);
      collectStudentId(student, studentId);
      if (typeof student === 'string' && typeof grade === 'string' && grade !== '') {
        gradeMap.set(student, grade);
      }
    }
  }

  // 续生率是学管漏斗的主来源；同一学生在两个来源都有编号时以主来源为准。
  const wsFunnel = workbook.getWorksheet('续生率');
  if (wsFunnel) {
    for (let r = 2; r <= wsFunnel.rowCount; r++) {
      const student = readCell(wsFunnel, r, FUNNEL_COLS.student_name);
      const studentId = toIdentifier(readCell(wsFunnel, r, FUNNEL_COLS.student_id));
      collectStudentId(student, studentId);
    }
  }

  return { statusMap, renewedMap, prepaidPairMap, prepaidNameMap, gradeMap, studentIdMap };
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
  students: { name: string; status: GridStatus; slot: number; studentId: string | null }[];
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
    const ws = workbook.getWorksheet(cfg.sheet) || workbook.getWorksheet(cfg.sheet.trim());
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

    for (let r = cfg.dataStartRow; r <= ws.rowCount; r++) {
      const teacherName = colOf.teacher_name ? readCell(ws, r, colOf.teacher_name!) : null;
      if (typeof teacherName !== 'string' || teacherName === '') continue;
      // 跳过汇总行：数学组/文科组/理综组/学习中心 等
      if (['数学组', '文科组', '理综组', '学习中心'].includes(teacherName)) break;

      const pick = (f: string): string | number | null =>
        colOf[f] ? readCell(ws, r, colOf[f]!) : null;

      const extra: Record<string, number | null> = {};
      for (const [field, col] of Object.entries(extraColOf)) {
        extra[field] = col ? toNum(readCell(ws, r, col)) : null;
      }

      // 学生网格按状态分成多个区块，区块之间常有十几列空白；不能在连续 3 空列后停止。
      // 扫描完整 80 列配置范围，保留原列位置作为 slot，避免漏掉后续状态区块的学生。
      // 模板里的数组公式、0 占位、空串和非字符串均按空单元格处理。
      const students: { name: string; status: GridStatus; slot: number; studentId: string | null }[] = [];
      for (let col = cfg.gridStartCol; col < cfg.gridStartCol + 80; col++) {
        const name = readCell(ws, r, col);
        if (typeof name !== 'string' || name === '') continue;
        students.push({
          name,
          status: resolveStudentStatus(teacherName, name, colorCtx),
          slot: col - cfg.gridStartCol + 1,
          studentId: colorCtx.studentIdMap?.get(name) ?? null,
        });
      }

      rows.push({
        tab: cfg.tab,
        teacherName,
        teacherNo: toIdentifier(pick('teacher_no')),
        subjectGroup: pick('subject_group') as string | null,
        baseCount: toNum(pick('base_count')),
        prepaidCount: toNum(pick('prepaid_count')),
        prepaidRate: toRate(pick('prepaid_rate')),
        renewedCount: toNum(pick('renewed_count')),
        renewRate: toRate(pick('renew_rate')),
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
    if (typeof name !== 'string' || name === '') continue;
    // 主表在汇总行结束；其后是同 Sheet 的年级、均单等附属统计块。
    if (name === '合计' || name === '学习中心') break;
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
      renewRate: toRate(g('renew_rate')),
      taskAmount: g('task_amount'),
      cashflowTotal: g('cashflow_total'),
      completionRate: toRate(g('completion_rate')),
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
      studentId: toIdentifier(sid),
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

  if (rows.length > 0) return rows;

  // 部分工作簿的「续生率」只有表头，学管关系保存在「学管学生」A:L。
  // 仅在主来源没有任何学生行时回退，避免两个来源混合后重复或口径漂移。
  const wsManager = workbook.getWorksheet('学管学生');
  if (!wsManager) return rows;
  for (let r = 2; r <= wsManager.rowCount; r++) {
    const studentName = readCell(wsManager, r, 1);
    if (typeof studentName !== 'string' || studentName === '' || studentName === '学生姓名') continue;
    const mgr = readCell(wsManager, r, 3);
    const grade = readCell(wsManager, r, 2);
    const product = readCell(wsManager, r, 4);
    rows.push({
      managerName: typeof mgr === 'string' && mgr !== '' ? mgr : null,
      studentId: null,
      studentName,
      grade: typeof grade === 'string' ? grade : null,
      firstEnrollDate: null,
      enrollDays: null,
      coef: toNum(readCell(wsManager, r, 7)),
      type: null,
      courseProduct: typeof product === 'string' ? product : null,
      classLast1: null,
      classLast2: null,
      renewed: yesNo(readCell(wsManager, r, 9)),
      sourceRow: r,
    });
  }

  return rows;
}


export type RenewalIssueSeverity = 'warning' | 'error';

export interface RenewalQualityIssue {
  errorType: string;
  severity: RenewalIssueSeverity;
  sheetName: string | null;
  rowNumber: number | null;
  columnNumber: number | null;
  fieldName: string | null;
  errorMessage: string;
  details?: Record<string, string | number | boolean | null>;
}

const MAX_QUALITY_ISSUES = 500;

function pushQualityIssue(issues: RenewalQualityIssue[], issue: RenewalQualityIssue): void {
  if (issues.length < MAX_QUALITY_ISSUES) issues.push(issue);
}

function formulaProblem(
  ws: ExcelJS.Worksheet,
  row: number,
  col: number,
): 'formula_cache_missing' | 'formula_error' | null {
  const cell = ws.getRow(row).getCell(col);
  const raw = cell.value;
  const value = raw !== null && typeof raw === 'object'
    ? raw as unknown as Record<string, unknown>
    : null;
  const model = cell.model as typeof cell.model & { sharedFormula?: string };
  const hasFormula = Boolean(
    model.formula || model.sharedFormula || value?.formula || value?.sharedFormula,
  );
  if (!hasFormula) return null;

  const result = value && 'result' in value ? value.result : model.result;
  if (typeof result === 'string' && result.trim().startsWith('#')) return 'formula_error';
  if (result !== null && typeof result === 'object' && 'error' in result) return 'formula_error';
  if (result === null || result === undefined) return 'formula_cache_missing';
  return null;
}

function collectFormulaIssue(
  issues: RenewalQualityIssue[],
  ws: ExcelJS.Worksheet,
  row: number,
  col: number | null,
  fieldName: string,
): void {
  if (!col) return;
  const problem = formulaProblem(ws, row, col);
  if (!problem) return;
  pushQualityIssue(issues, {
    errorType: problem,
    severity: 'warning',
    sheetName: ws.name,
    rowNumber: row,
    columnNumber: col,
    fieldName,
    errorMessage: problem === 'formula_error'
      ? '公式返回错误值，相关字段按空值导入'
      : '公式缺少缓存结果，相关字段按空值导入',
  });
}

/**
 * 对实际参与导入的区域做质量检查。只输出 Sheet/行/列/字段定位，
 * 不把教师或学生姓名写进错误消息与 details，避免错误清单泄露身份。
 */
export function inspectRenewalWorkbookQuality(
  workbook: ExcelJS.Workbook,
  teacherRows: TeacherStatsRow[],
  managerRows: ManagerPerfRow[],
  funnelRows: FunnelRow[],
): RenewalQualityIssue[] {
  const issues: RenewalQualityIssue[] = [];
  if (workbook.worksheets.length === 0) {
    pushQualityIssue(issues, {
      errorType: 'empty_workbook',
      severity: 'error',
      sheetName: null,
      rowNumber: null,
      columnNumber: null,
      fieldName: null,
      errorMessage: '工作簿为空，未找到可导入的数据',
    });
    return issues;
  }

  const teacherSheets = TAB_CONFIGS
    .map((cfg) => ({
      cfg,
      ws: workbook.getWorksheet(cfg.sheet) || workbook.getWorksheet(cfg.sheet.trim()),
    }))
    .filter((item): item is { cfg: TabConfig; ws: ExcelJS.Worksheet } => Boolean(item.ws));
  const wsFunnel = workbook.getWorksheet('续生率');
  const wsManagerStudents = workbook.getWorksheet('学管学生');
  const wsPerf = workbook.getWorksheet('学管业绩统计表');

  if (teacherSheets.length === 0) {
    pushQualityIssue(issues, {
      errorType: 'missing_sheet', severity: 'error', sheetName: null,
      rowNumber: null, columnNumber: null, fieldName: null,
      errorMessage: '缺少全部教师统计 Sheet，至少需要提供一个教师统计表',
    });
  }
  if (!wsFunnel && !wsManagerStudents) {
    pushQualityIssue(issues, {
      errorType: 'missing_sheet', severity: 'error', sheetName: '续生率',
      rowNumber: null, columnNumber: null, fieldName: null,
      errorMessage: '缺少续生率 Sheet，且没有可回退的学管学生 Sheet',
    });
  }
  if (!wsPerf) {
    pushQualityIssue(issues, {
      errorType: 'missing_sheet', severity: 'error', sheetName: '学管业绩统计表',
      rowNumber: null, columnNumber: null, fieldName: null,
      errorMessage: '缺少必需的学管业绩统计表 Sheet',
    });
  }


  // 固定列来源兼容旧模板的无表头布局；一旦出现可识别表头，就校验其关键列完整性。
  const validateFixedHeaders = (
    ws: ExcelJS.Worksheet,
    headerRow: number,
    twoRows: boolean,
    specs: Array<{ field: string; col: number; keywords: string[] }>,
  ): void => {
    const values = new Map(specs.map((spec) => {
      const top = readHeader(ws, headerRow, spec.col);
      const sub = twoRows ? readHeader(ws, headerRow + 1, spec.col) : '';
      return [spec.field, top === sub ? top : [top, sub].filter(Boolean).join('')];
    }));
    const hasRecognizedHeader = specs.some((spec) => {
      const value = values.get(spec.field) ?? '';
      return spec.keywords.some((keyword) => value.includes(normHeader(keyword)));
    });
    if (!hasRecognizedHeader) return;
    for (const spec of specs) {
      const value = values.get(spec.field) ?? '';
      if (spec.keywords.some((keyword) => value.includes(normHeader(keyword)))) continue;
      pushQualityIssue(issues, {
        errorType: 'missing_header', severity: 'error', sheetName: ws.name,
        rowNumber: headerRow, columnNumber: spec.col, fieldName: spec.field,
        errorMessage: `固定布局 Sheet 缺少必需表头字段 ${spec.field}`,
      });
    }
  };
  if (wsFunnel) {
    validateFixedHeaders(wsFunnel, 1, false, [
      { field: 'manager_name', col: FUNNEL_COLS.manager_name, keywords: ['学管'] },
      { field: 'student_id', col: FUNNEL_COLS.student_id, keywords: ['学生编号', '学生ID', '学号'] },
      { field: 'student_name', col: FUNNEL_COLS.student_name, keywords: ['学生', '姓名'] },
    ]);
  }
  if (wsPerf) {
    validateFixedHeaders(wsPerf, 3, true, [
      { field: 'manager_name', col: PERF_COLS.manager_name, keywords: ['学管'] },
      { field: 'renewed_count', col: PERF_COLS.renewed_count, keywords: ['续生数'] },
    ]);
  }

  const teacherBySource = new Map(teacherRows.map((row) => [`${row.tab}:${row.sourceRow}`, row]));
  for (const { cfg, ws } of teacherSheets) {
    const headerMap = buildHeaderMap(ws, cfg.headerRow);
    const colOf: Record<string, number | null> = {};
    for (const [field, keywords] of Object.entries(cfg.fields)) {
      colOf[field] = findCol(headerMap, keywords);
      collectFormulaIssue(issues, ws, cfg.headerRow, colOf[field], field);
    }
    for (const field of ['teacher_name', 'base_count', 'renewed_count']) {
      if (colOf[field]) continue;
      pushQualityIssue(issues, {
        errorType: 'missing_header', severity: 'error', sheetName: ws.name,
        rowNumber: cfg.headerRow, columnNumber: null, fieldName: field,
        errorMessage: `教师统计 Sheet 缺少必需表头字段 ${field}`,
      });
    }
    const extraCols = Object.fromEntries(
      Object.entries(cfg.extra).map(([field, keywords]) => [field, findCol(headerMap, keywords)]),
    ) as Record<string, number | null>;

    for (let r = cfg.dataStartRow; r <= ws.rowCount; r++) {
      const teacherName = colOf.teacher_name ? readCell(ws, r, colOf.teacher_name) : null;
      if (typeof teacherName === 'string' && ['数学组', '文科组', '理综组', '学习中心'].includes(teacherName)) break;
      const metricColumns = Object.entries(colOf)
        .filter(([field]) => !['teacher_name', 'teacher_no', 'subject_group'].includes(field));
      if (typeof teacherName !== 'string' || teacherName === '') {
        if (metricColumns.some(([, col]) => col && readCell(ws, r, col) !== null)) {
          pushQualityIssue(issues, {
            errorType: 'empty_key_data', severity: 'error', sheetName: ws.name,
            rowNumber: r, columnNumber: colOf.teacher_name, fieldName: 'teacher_name',
            errorMessage: '明细行存在指标数据，但教师关键字段为空',
          });
        }
        continue;
      }

      for (const [field, col] of [...Object.entries(colOf), ...Object.entries(extraCols)]) {
        collectFormulaIssue(issues, ws, r, col, field);
      }

      // 与网格解析使用相同的完整 80 列范围；空白分隔的状态区块不属于截断。
      const gridEnd = cfg.gridStartCol + 80;
      for (let col = cfg.gridStartCol; col < gridEnd; col++) {
        collectFormulaIssue(issues, ws, r, col, 'student_grid');
      }
      for (let col = gridEnd; col <= ws.columnCount; col++) {
        collectFormulaIssue(issues, ws, r, col, 'student_grid');
        const name = readCell(ws, r, col);
        if (typeof name !== 'string' || name === '') continue;
        pushQualityIssue(issues, {
          errorType: 'grid_truncated', severity: 'warning', sheetName: ws.name,
          rowNumber: r, columnNumber: col, fieldName: 'student_grid',
          errorMessage: '学生网格超出 80 列解析范围，后续内容未完整导入',
          details: { gridColumnLimit: 80 },
        });
        break;
      }

      const parsed = teacherBySource.get(`${cfg.tab}:${r}`);
      // 课时网格只包含课时分段内的学生关系，基数则覆盖全部在读学生，
      // 两者本就不同口径；其余 tab 的网格应与教师基数逐行对账。
      if (cfg.tab !== 'hours' && parsed && parsed.baseCount !== null && parsed.baseCount !== parsed.students.length) {
        pushQualityIssue(issues, {
          errorType: 'summary_detail_mismatch', severity: 'warning', sheetName: ws.name,
          rowNumber: r, columnNumber: colOf.base_count, fieldName: 'base_count',
          errorMessage: '教师汇总学生基数与学生网格明细数量不一致',
          details: { summaryCount: parsed.baseCount, detailCount: parsed.students.length },
        });
      }
    }
  }

  if (wsPerf) {
    const managerBySource = new Map(managerRows.map((row) => [row.sourceRow, row]));
    for (let r = 5; r <= wsPerf.rowCount; r++) {
      const managerName = readCell(wsPerf, r, PERF_COLS.manager_name);
      if (managerName === '合计' || managerName === '学习中心') break;
      const hasMetrics = Object.entries(PERF_COLS).some(([field, col]) =>
        field !== 'manager_name' && readCell(wsPerf, r, col) !== null);
      if (typeof managerName !== 'string' || managerName === '') {
        if (hasMetrics) {
          pushQualityIssue(issues, {
            errorType: 'empty_key_data', severity: 'error', sheetName: wsPerf.name,
            rowNumber: r, columnNumber: PERF_COLS.manager_name, fieldName: 'manager_name',
            errorMessage: '业绩明细存在指标数据，但学管关键字段为空',
          });
        }
        continue;
      }
      for (const [field, col] of Object.entries(PERF_COLS)) {
        collectFormulaIssue(issues, wsPerf, r, col, field);
      }
      const parsed = managerBySource.get(r);
      if (parsed && parsed.renewedCount !== null) {
        const detailCount = funnelRows.filter((row) =>
          row.managerName === parsed.managerName && row.renewed === 1).length;
        if (parsed.renewedCount !== detailCount) {
          pushQualityIssue(issues, {
            errorType: 'summary_detail_mismatch', severity: 'warning', sheetName: wsPerf.name,
            rowNumber: r, columnNumber: PERF_COLS.renewed_count, fieldName: 'renewed_count',
            errorMessage: '学管汇总续生数与续生率明细续费人数不一致',
            details: { summaryCount: parsed.renewedCount, detailCount },
          });
        }
      }
    }
  }

  if (wsFunnel) {
    for (let r = 2; r <= wsFunnel.rowCount; r++) {
      const studentName = readCell(wsFunnel, r, FUNNEL_COLS.student_name);
      const studentId = readCell(wsFunnel, r, FUNNEL_COLS.student_id);
      const managerName = readCell(wsFunnel, r, FUNNEL_COLS.manager_name);
      if (typeof studentName !== 'string' || studentName === '') {
        if (studentId !== null || managerName !== null) {
          pushQualityIssue(issues, {
            errorType: 'empty_key_data', severity: 'error', sheetName: wsFunnel.name,
            rowNumber: r, columnNumber: FUNNEL_COLS.student_name, fieldName: 'student_name',
            errorMessage: '续生率明细存在关联数据，但学生关键字段为空',
          });
        }
        continue;
      }
      for (const [field, col] of Object.entries(FUNNEL_COLS)) {
        collectFormulaIssue(issues, wsFunnel, r, col, field);
      }
      if (typeof managerName !== 'string' || managerName === '') {
        pushQualityIssue(issues, {
          errorType: 'empty_key_data', severity: 'warning', sheetName: wsFunnel.name,
          rowNumber: r, columnNumber: FUNNEL_COLS.manager_name, fieldName: 'manager_name',
          errorMessage: '续生率明细的学管字段为空，该记录进入未分配分组',
        });
      }
    }
  }

  if (teacherRows.length === 0) {
    pushQualityIssue(issues, {
      errorType: 'empty_key_data', severity: 'error',
      sheetName: teacherSheets[0]?.ws.name ?? null,
      rowNumber: null, columnNumber: null, fieldName: 'teacher_name',
      errorMessage: '教师统计 Sheet 没有可导入的教师明细',
    });
  }
  if (managerRows.length === 0) {
    pushQualityIssue(issues, {
      errorType: 'empty_key_data', severity: 'error', sheetName: wsPerf?.name ?? '学管业绩统计表',
      rowNumber: null, columnNumber: null, fieldName: 'manager_name',
      errorMessage: '学管业绩统计表没有可导入的学管明细',
    });
  }
  if (funnelRows.length === 0) {
    pushQualityIssue(issues, {
      errorType: 'empty_key_data', severity: 'error',
      sheetName: wsFunnel?.name ?? wsManagerStudents?.name ?? '续生率',
      rowNumber: null, columnNumber: null, fieldName: 'student_name',
      errorMessage: '续生率及回退来源均没有可导入的学生明细',
    });
  }
  return issues;
}

/**
 * 从续生率 sheet 标题区抽取统计月份与学习中心名。
 * 纯函数、无模块级状态（多次上传/测试不会串数据）。
 * 标题区在前 3 行，扫一遍找「XX学习中心」和「YYYY年MM月」。
 */
export function extractReportMeta(workbook: ExcelJS.Workbook): { statMonth: string | null; centerName: string | null } {
  const wsTitle = workbook.getWorksheet('教师统计表(激励)') || workbook.getWorksheet('教师统计表 (学段)');
  if (wsTitle) {
    for (let r = 1; r <= Math.min(3, wsTitle.rowCount); r++) {
      for (let col = 1; col <= Math.min(wsTitle.columnCount, 20); col++) {
        const v = readCell(wsTitle, r, col);
        if (typeof v !== 'string' || v.length < 4) continue;
        if (!v.includes('学习中心')) continue;
        const cm = v.match(/([一-龥A-Za-z0-9]{2,12}学习中心)/);
        const centerName = cm ? cm[1] : null;
        let statMonth = null;
        const mm1 = v.match(/(\d{2})-(\d{2})秋寒/);
        if (mm1) statMonth = '20' + mm1[1] + '-' + mm1[2];
        const mm2 = v.match(/(\d{4})年(\d{1,2})月/);
        if (mm2) statMonth = mm2[1] + '-' + String(mm2[2]).padStart(2, '0');
        if (!statMonth) {
          const mm3 = v.match(/\((\d{2})\/(\d{2})\/(\d{2})/);
          if (mm3) statMonth = '20' + mm3[1] + '-' + mm3[2];
        }
        if (statMonth && centerName) return { statMonth, centerName };
      }
    }
  }

  const ws = workbook.getWorksheet('续生率');
  if (!ws) return { statMonth: null, centerName: null };

  let statMonth = null;
  let centerName = null;

  const maxCol = Math.min(ws.columnCount, 97);
  for (let r = 1; r <= Math.min(3, ws.rowCount); r++) {
    for (let col = 1; col <= maxCol; col++) {
      const v = readCell(ws, r, col);
      if (typeof v !== 'string' || v.length < 4) continue;
      if (!centerName) {
        const cm = v.match(/([一-龥A-Za-z0-9]{2,12}学习中心)/);
        if (cm) centerName = cm[1];
      }
      if (!statMonth) {
        const mm = v.match(/(\d{4})年(\d{1,2})月/);
        if (mm) statMonth = mm[1] + '-' + String(mm[2]).padStart(2, '0');
      }
      if (statMonth && centerName) break;
    }
  }

  return { statMonth, centerName };
}
