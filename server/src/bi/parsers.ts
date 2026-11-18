/**
 * BI 解析器集合：每种上传文件类型一个 parse 函数。
 * 
 * 每个函数职责：
 *   1. 调用 mapRows() 按字段映射提取数据
 *   2. 类型特有逻辑（如 voucher 的学生关联拆分）
 *   3. 返回 { records, errors, totalSourceRows }
 *   4. records 里每个对象直接对应数据库列名
 */
import { mapRows, toStr, toFloat, toInt, type MapperResult, type RowError } from './mappers.js';
import { FILE_TYPES } from './fileRegistry.js';

// ============ 在读学生明细 ============
// 源表头：统计日期/学管师/学管师工号/学生/学生ID/年级/...
export async function parseStudentSnapshot(filePath: string): Promise<MapperResult> {
  return mapRows(filePath, {
    sheetName: null,
    headerRow: 1,
    mapping: {
      '统计日期': 'stat_date',
      '学管师': 'mentor_name',
      '学管师工号': 'mentor_no',
      '学生': 'student_name',
      '学生ID': 'student_id',
      '年级': 'grade',
      '学生个性化状态': 'personalization_status',
      '学生状态': 'student_status',
      '学生性质': 'student_nature',
      '1对1学生状态': 'one_to_one_status',
      '1对1停结课日期': 'one_to_one_end_date',
      '1对多学生状态': 'one_to_many_status',
      '1对多停结课日期': 'one_to_many_end_date',
      '总剩余小时': 'total_remaining_hours',
    },
    converters: {
      stat_date: toStr,
      student_id: toStr,
      total_remaining_hours: toFloat,
    },
    requiredFields: ['student_id'],
  });
}

// ============ 在册科次明细 ============
export async function parseSubjectSnapshot(filePath: string): Promise<MapperResult> {
  return mapRows(filePath, {
    sheetName: null,
    headerRow: 1,
    mapping: {
      '统计日期': 'stat_date',
      '学管师': 'mentor_name',
      '学生': 'student_name',
      '学生ID': 'student_id',
      '年级': 'grade',
      '学生产品状态': 'student_product_status',
      '学生产品性质': 'student_product_nature',
      '科目性质': 'subject_nature',
      '科目': 'subject',
      '科目状态': 'subject_status',
      '科目剩余小时': 'subject_remaining_hours',
      '科目停结课日期': 'subject_end_date',
    },
    converters: {
      stat_date: toStr,
      student_id: toStr,
      subject: toStr,
      subject_remaining_hours: toFloat,
      subject_end_date: toStr,
    },
    requiredFields: ['student_id', 'subject'],
  });
}

// ============ 科组科次续结比(月) ============
export async function parseRenewCloseRatio(filePath: string): Promise<MapperResult> {
  return mapRows(filePath, {
    sheetName: null,
    headerRow: 1,
    mapping: {
      '年月': 'year_month',
      '月起': 'period_start',
      '月止': 'period_end',
      '学习中心': 'learning_center',
      '产品类型': 'product_type',
      '科组': 'subject_group',
      '科目': 'subject',
      '学生编号': 'student_id',
      '学生': 'student_name',
      '状态': 'status',
      '发生日期': 'event_date',
      '年级': 'grade',
      '学管工号': 'mentor_no',
      '学管师': 'mentor_name',
      '老师工号': 'teacher_no',
      '老师': 'teacher_name',
    },
    converters: {
      year_month: toStr,
      student_id: toStr,
      status: toStr,
      event_date: toStr,
      teacher_no: toStr,
      mentor_no: toStr,
    },
    requiredFields: ['student_id', 'status'],
  });
}

// ============ 续生率-学生明细 ============
export async function parseXushengDetail(filePath: string): Promise<MapperResult> {
  return mapRows(filePath, {
    sheetName: '续生率-学生明细(实时)',
    headerRow: 1,
    mapping: {
      '月份': 'stat_month',
      '学管师': 'mentor_name',
      '学生': 'student_name',
      '学生ID': 'student_id',
      '年级': 'grade',
      '首次报读个性化日期': 'first_enroll_date',
      '报读时长': 'enroll_days',
      '类型': 'category',
      '课消产品': 'consume_product',
      '上1个月是否有课消': 'attended_prev_1m',
      '上2个月是否有课消': 'attended_prev_2m',
      '本月是否续费': 'renewed_this_month',
      '前2月上课学习中心': 'prev_2m_learning_center',
      '续费时间': 'renew_time',
      '续费产品': 'renew_product',
      '剩余小时': 'remaining_hours',
      '1对1剩余小时': 'one_to_one_remaining_hours',
      '1对多剩余小时': 'one_to_many_remaining_hours',
      '续个性化金额': 'renew_personalized_amount',
      '续1对1金额': 'renew_one_to_one_amount',
      '续1对多金额': 'renew_one_to_many_amount',
      '续班课金额': 'renew_class_amount',
      '续费小时(正价)': 'renew_hours_standard',
    },
    converters: {
      stat_month: toStr,
      student_id: toStr,
      enroll_days: toInt,
      renewed_this_month: toStr,
      renew_personalized_amount: toFloat,
      renew_one_to_one_amount: toFloat,
      renew_one_to_many_amount: toFloat,
      renew_class_amount: toFloat,
      renew_hours_standard: toFloat,
      remaining_hours: toFloat,
    },
    requiredFields: ['student_id'],
  });
}

// ============ 续科率(5分钟)-科次明细 ============
export async function parseXukeDetail(filePath: string): Promise<MapperResult> {
  return mapRows(filePath, {
    sheetName: null,
    headerRow: 1,
    mapping: {
      '统计月份': 'stat_month',
      '老师': 'teacher_name',
      '老师工号': 'teacher_no',
      '学生': 'student_name',
      '学生ID': 'student_id',
      '年级': 'grade',
      '学管师': 'mentor_name',
      '学管师工号': 'mentor_no',
      '大科组': 'major_subject_group',
      '科组': 'subject_group',
      '科目': 'subject',
      '月初科目剩余小时': 'month_start_remaining_hours',
      '剩余小时分段': 'remaining_hours_segment',
      '上月末科目状态': 'prev_month_subject_status',
      '课消产品类别': 'consume_product_category',
      '前1个月是否上课': 'attended_prev_1m',
      '前2个月是否上课': 'attended_prev_2m',
      '本月是否续科': 'renewed_this_month',
      '续费产品类别': 'renew_product_category',
      '续费小时': 'renew_hours',
      '前2个月上课学习中心': 'prev_2m_learning_center',
      '前6个月上课学习中心': 'prev_6m_learning_center',
    },
    converters: {
      stat_month: toStr,
      teacher_no: toStr,
      student_id: toStr,
      mentor_no: toStr,
      subject: toStr,
      month_start_remaining_hours: toFloat,
      renewed_this_month: toStr,
      renew_hours: toFloat,
    },
    requiredFields: ['student_id', 'teacher_no', 'subject'],
  });
}

// ============ 预排课程状态统计 ============
export async function parseScheduledCourse(filePath: string): Promise<MapperResult> {
  return mapRows(filePath, {
    sheetName: null,
    headerRow: 1,
    mapping: {
      '省区': 'province',
      '分公司': 'branch_company',
      '学习中心': 'learning_center',
      '课程ID': 'course_id',
      '上课日期': 'class_date',
      '上课时间': 'class_time',
      '学管姓名': 'mentor_name',
      '学管工号': 'mentor_no',
      '老师姓名': 'teacher_name',
      '老师用工类型': 'teacher_employment_type',
      '老师工号': 'teacher_no',
      '学生姓名': 'student_name',
      '学生编号': 'student_id',
      '是否新签学生': 'is_new_student',
      '年级': 'grade',
      '科组': 'subject_group',
      '科目': 'subject',
      '预排小时': 'scheduled_hours',
      '实际小时': 'actual_hours',
      '课程状态': 'course_status',
      '学生扣费状态': 'student_charge_status',
      '学生考勤状态': 'student_attendance_status',
      '课程标签': 'course_tag',
      '产品名称': 'product_name',
      '课程性质': 'course_nature',
      '老师考勤时间': 'teacher_attendance_time',
      '学管审核时间': 'mentor_review_time',
      '扣费时间': 'charge_time',
      '产品类型': 'product_type',
      '1对多类型': 'one_to_many_type',
      '扣费系数': 'charge_coefficient',
    },
    converters: {
      class_date: toStr,
      student_id: toStr,
      teacher_no: toStr,
      course_id: toStr,
      scheduled_hours: toFloat,
      actual_hours: toFloat,
      charge_coefficient: toFloat,
    },
    requiredFields: ['student_id', 'course_id'],
  });
}

// ============ 定金券使用报表 ============
// 特殊处理：关联学生ID / 关联学生 / 学生年级 是逗号分隔的多值，需要拆解
export interface VoucherRecord extends Record<string, unknown> {
  // raw_voucher 列
  batch_id?: number;
  branch_company: string | null;
  campus: string | null;
  builder_name: string | null;
  amount: number | null;
  customer_phone_masked: string | null;
  voucher_created_at: string | null;
  usage_status: string | null;
  used_or_refunded_at: string | null;
  contract_no: string | null;
  payment_status: string | null;
  intent_grade: string | null;
  remark: string | null;
  extra: string | null;
  __row_number: number;
  // 关联学生拆分结果（不入 raw_voucher，单独插 voucher_student_link）
  student_links: {
    student_id: string | null;
    student_name: string | null;
    student_grade: string | null;
    link_kind: 'real' | 'parent_lead' | 'student_lead' | 'unknown' | 'empty';
    position: number;
  }[];
}

/** 判定关联学生条目的类型 */
function classifyLink(name: string | null, studentId: string | null): 'real' | 'parent_lead' | 'student_lead' | 'unknown' | 'empty' {
  if (!name && !studentId) return 'empty';
  if (studentId && studentId.startsWith('STU')) {
    // 有合法 STU 编号；再检查名字是否带线索标记
    if (name && (name.includes('线索') || name.includes('家长'))) {
      return 'parent_lead';
    }
    return 'real';
  }
  // 无 STU 编号
  if (name) {
    if (name.includes('家长') || name.includes('爸爸') || name.includes('妈妈') || name.includes('爸') || name.includes('妈')) {
      return 'parent_lead';
    }
    if (name.includes('线索') || name.includes('学生')) {
      return 'student_lead';
    }
    return 'unknown';
  }
  return 'empty';
}

export async function parseVoucher(filePath: string): Promise<MapperResult> {
  const result = await mapRows(filePath, {
    sheetName: '0',
    headerRow: 1,
    mapping: {
      '分公司': 'branch_company',
      '校区': 'campus',
      '建券员工': 'builder_name',
      '金额': 'amount',
      '客户手机号': 'customer_phone_masked',
      '建券时间': 'voucher_created_at',
      '使用状态': 'usage_status',
      '使用/退费时间': 'used_or_refunded_at',
      '关联合同编号': 'contract_no',
      '支付状态': 'payment_status',
      '关联学生ID': '_student_ids_raw',
      '关联学生': '_student_names_raw',
      '学生年级': '_student_grades_raw',
      '意向使用年级': 'intent_grade',
      '备注': 'remark',
    },
    converters: {
      amount: toFloat,
      created_at: toStr,
      used_or_refunded_at: toStr,
      contract_no: toStr,
      customer_phone_masked: toStr,
      builder_name: toStr,
      usage_status: toStr,
      payment_status: toStr,
    },
    requiredFields: ['builder_name', 'amount'],
    collectExtra: false,
  });

  // 拆分关联学生到 student_links
  const voucherRecords: VoucherRecord[] = result.records.map(rec => {
    const rawIds = toStr(rec._student_ids_raw as string) ?? '';
    const rawNames = toStr(rec._student_names_raw as string) ?? '';
    const rawGrades = toStr(rec._student_grades_raw as string) ?? '';

    // 按逗号拆分，保留原始位置
    const ids = rawIds ? rawIds.split(',').map(s => s.trim()) : [];
    const names = rawNames ? rawNames.split(',').map(s => s.trim()) : [];
    const grades = rawGrades ? rawGrades.split(',').map(s => s.trim()) : [];

    const maxLen = Math.max(ids.length, names.length, grades.length);
    const studentLinks: VoucherRecord['student_links'] = [];

    for (let i = 0; i < maxLen; i++) {
      const sid = (ids[i] && ids[i] !== '空' && ids[i].startsWith('STU')) ? ids[i] : null;
      const sname = (names[i] && names[i] !== '空') ? names[i] : null;
      const sgrade = (grades[i] && grades[i] !== '空') ? grades[i] : null;
      const kind = classifyLink(sname, sid);

      // 跳过纯空条目
      if (kind === 'empty') continue;

      studentLinks.push({
        student_id: sid,
        student_name: sname,
        student_grade: sgrade,
        link_kind: kind,
        position: i + 1,
      });
    }

    return {
      branch_company: rec.branch_company as string | null,
      campus: rec.campus as string | null,
      builder_name: rec.builder_name as string | null,
      amount: rec.amount as number | null,
      customer_phone_masked: rec.customer_phone_masked as string | null,
      voucher_created_at: rec.voucher_created_at as string | null,
      usage_status: rec.usage_status as string | null,
      used_or_refunded_at: rec.used_or_refunded_at as string | null,
      contract_no: rec.contract_no as string | null,
      payment_status: rec.payment_status as string | null,
      intent_grade: rec.intent_grade as string | null,
      remark: rec.remark as string | null,
      extra: null,
      __row_number: rec.__row_number as number,
      student_links: studentLinks,
    };
  });

  return {
    records: voucherRecords,
    errors: result.errors,
    totalSourceRows: result.totalSourceRows,
  };
}

// ============ 路由解析器注册 ============
export type BiParser = (filePath: string) => Promise<MapperResult>;

export const PARSERS: Record<string, BiParser> = {
  [FILE_TYPES.STUDENT_SNAPSHOT]: parseStudentSnapshot,
  [FILE_TYPES.SUBJECT_SNAPSHOT]: parseSubjectSnapshot,
  [FILE_TYPES.RENEW_CLOSE_RATIO]: parseRenewCloseRatio,
  [FILE_TYPES.XUSHENG_DETAIL]: parseXushengDetail,
  [FILE_TYPES.XUKE_DETAIL]: parseXukeDetail,
  [FILE_TYPES.SCHEDULED_COURSE]: parseScheduledCourse,
  [FILE_TYPES.VOUCHER]: parseVoucher,
  // PERSONAL_PERF 暂未启用（源文件待重新导出）
};
