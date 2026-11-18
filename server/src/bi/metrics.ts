/**
 * BI 指标计算服务 —— 续科率 / 续生率 / 预存推断
 *
 * 第一期只做「已有源数据的聚合」：源文件本身已经打好了"本月是否续科/续费"标记，
 * 这一层只负责按维度聚合 + 跨表去重。
 *
 * 第二期再考虑把去重逻辑做成 product_match_rules 驱动，支持运营自定义。
 */
import { biDb } from './db.js';
import { FILE_TYPES } from './fileRegistry.js';

// ============ 维度 & 结果类型 ============

export interface XukeRateRow {
  teacher_no: string;
  teacher_name: string;
  subject_group: string | null;
  /** 上月末在册科次数（分母） */
  base_count: number;
  /** 本月续科数（分子） */
  renewed_count: number;
  /** 续科率 0-100 */
  rate: number;
}

export interface XushengRateRow {
  mentor_name: string;
  /** 学生基数（去重后） */
  base_count: number;
  /** 续费人数（去重后） */
  renewed_count: number;
  rate: number;
}

// ============ 工具 ============

/** 取某个 file_type 最新 committed batch 的 id（没有返回 null） */
function latestBatchId(fileType: string): number | null {
  const row = biDb.prepare(
    `SELECT id FROM upload_batch WHERE file_type = ? AND status = 'committed' ORDER BY id DESC LIMIT 1`
  ).get(fileType) as { id: number } | undefined;
  return row?.id ?? null;
}

/** 取某个 stat_month 的 committed batch id（没有返回 null） */
function latestBatchIdByMonth(fileType: string, statMonth: string): number | null {
  // xuke_detail 用 stat_month 字段；xusheng_detail 也用 stat_month
  const table = fileType === FILE_TYPES.XUKE_DETAIL ? 'raw_xuke_detail' : 'raw_xusheng_detail';
  const row = biDb.prepare(
    `SELECT b.id AS id FROM upload_batch b
     JOIN ${table} r ON r.batch_id = b.id
     WHERE b.file_type = ? AND b.status = 'committed' AND r.stat_month = ?
     ORDER BY b.id DESC LIMIT 1`
  ).get(fileType, statMonth) as { id: number } | undefined;
  return row?.id ?? null;
}

function rate(num: number, den: number): number {
  if (den <= 0) return 0;
  return Math.round((num / den) * 10000) / 100; // 保留 2 位小数
}

// ============ 续科率（老师维度）============

/**
 * 续科率 = 本月续科科次 / 上月末在册科次
 *
 * 数据源：raw_xuke_detail（续科率-5分钟）
 * 每行已经是 学生×科目 粒度，renewed_this_month 已经是 是/否。
 * 这里只需按老师聚合。
 */
export function computeXukeRates(options: {
  statMonth?: string;  // 不传 = 取最新 batch
  groupBy?: 'teacher' | 'subject_group';
} = {}): XukeRateRow[] {
  const { statMonth, groupBy = 'teacher' } = options;

  let batchId: number | null;
  if (statMonth) {
    batchId = latestBatchIdByMonth(FILE_TYPES.XUKE_DETAIL, statMonth);
  } else {
    batchId = latestBatchId(FILE_TYPES.XUKE_DETAIL);
  }
  if (!batchId) return [];

  const groupKey = groupBy === 'teacher'
    ? 'teacher_no, teacher_name'
    : 'subject_group';
  const groupSelect = groupBy === 'teacher'
    ? 'teacher_no, teacher_name, MAX(subject_group) AS subject_group'
    : 'NULL AS teacher_no, NULL AS teacher_name, subject_group';

  const sql = `
    SELECT
      ${groupSelect},
      COUNT(*) AS base_count,
      SUM(CASE WHEN renewed_this_month = '是' THEN 1 ELSE 0 END) AS renewed_count
    FROM raw_xuke_detail
    WHERE batch_id = ?
    GROUP BY ${groupKey}
    ORDER BY base_count DESC
  `;

  const rows = biDb.prepare(sql).all(batchId) as Array<{
    teacher_no: string | null;
    teacher_name: string | null;
    subject_group: string | null;
    base_count: number;
    renewed_count: number;
  }>;

  return rows.map(r => ({
    teacher_no: r.teacher_no ?? '',
    teacher_name: r.teacher_name ?? '',
    subject_group: r.subject_group,
    base_count: r.base_count,
    renewed_count: r.renewed_count,
    rate: rate(r.renewed_count, r.base_count),
  }));
}

// ============ 续生率（学管维度）============

/**
 * 续生率 = 本月续费学生数（去重后） / 续费统计基数（去重后）
 *
 * 去重逻辑（用户提供的公式还原）：
 *   1. 以 raw_xusheng_detail 为主体
 *   2. 每行标 renewed_this_month = '是' 的直接算续费
 *   3. 标 '否' 的行，如果该学生 ID 在 raw_xuke_detail 里出现「renewed_this_month='是'
 *      且 consume_product_category 匹配」的记录，也视为续费
 *   4. 学生 ID 去重（一个学生在同一月份只算一次）
 *
 * 现阶段：product_match_rules 没种子数据，先用「课消产品子串匹配」兜底
 * （跟原 Excel 公式保持一致）。
 */
export function computeXushengRates(options: {
  statMonth?: string;
  /** 跨表去重：是否把 xuke_detail 里的续科也计为续费 */
  crossDedup?: boolean;
} = {}): XushengRateRow[] {
  const { statMonth, crossDedup = true } = options;

  let xushengBatchId: number | null;
  let xukeBatchId: number | null;
  if (statMonth) {
    xushengBatchId = latestBatchIdByMonth(FILE_TYPES.XUSHENG_DETAIL, statMonth);
    xukeBatchId = latestBatchIdByMonth(FILE_TYPES.XUKE_DETAIL, statMonth);
  } else {
    xushengBatchId = latestBatchId(FILE_TYPES.XUSHENG_DETAIL);
    xukeBatchId = latestBatchId(FILE_TYPES.XUKE_DETAIL);
  }
  if (!xushengBatchId) return [];

  // 步骤 1：先把 xusheng 明细拉出来（mentor 维度），一个学生可能有多行（多个产品）
  const rows = biDb.prepare(
    `SELECT student_id, mentor_name, renewed_this_month
     FROM raw_xusheng_detail WHERE batch_id = ?`
  ).all(xushengBatchId) as Array<{
    student_id: string;
    mentor_name: string | null;
    renewed_this_month: string | null;
  }>;

  // 步骤 2（跨表去重）：查 xuke 里有续科的学生 ID 集合
  let xukeRenewedStudentIds = new Set<string>();
  if (crossDedup && xukeBatchId) {
    const renewedInXuke = biDb.prepare(
      `SELECT DISTINCT student_id FROM raw_xuke_detail
       WHERE batch_id = ? AND renewed_this_month = '是' AND student_id IS NOT NULL`
    ).all(xukeBatchId) as Array<{ student_id: string }>;
    xukeRenewedStudentIds = new Set(renewedInXuke.map(r => r.student_id));
  }

  // 步骤 3：按 (mentor_name, student_id) 去重，学生只要有一行是"是"或命中跨表即算续费
  const studentMap = new Map<string, { mentor: string; renewed: boolean }>();
  for (const r of rows) {
    if (!r.student_id) continue;
    const key = r.student_id;
    const mentor = r.mentor_name ?? '未知';
    const isRenewed = r.renewed_this_month === '是' || xukeRenewedStudentIds.has(r.student_id);

    const existing = studentMap.get(key);
    if (!existing) {
      studentMap.set(key, { mentor, renewed: isRenewed });
    } else {
      // 同一学生多行：只要有一行续费就算续费；学管取第一行
      existing.renewed = existing.renewed || isRenewed;
    }
  }

  // 步骤 4：按学管聚合
  const mentorMap = new Map<string, { base: number; renewed: number }>();
  for (const { mentor, renewed } of studentMap.values()) {
    const cur = mentorMap.get(mentor) ?? { base: 0, renewed: 0 };
    cur.base += 1;
    if (renewed) cur.renewed += 1;
    mentorMap.set(mentor, cur);
  }

  return Array.from(mentorMap.entries())
    .map(([mentor_name, { base, renewed }]) => ({
      mentor_name,
      base_count: base,
      renewed_count: renewed,
      rate: rate(renewed, base),
    }))
    .sort((a, b) => b.base_count - a.base_count);
}

// ============ 预存推断（定金券）============

export interface PreSaleRow {
  branch_company: string;
  learning_center: string;
  /** 有效定金券张数（使用状态=已使用 & 支付状态=已支付） */
  valid_voucher_count: number;
  /** 关联学生去重数（预存学生数） */
  presale_student_count: number;
  /** 总金额 */
  total_amount: number;
}

/**
 * 预存推断：从 raw_voucher 按校区聚合
 * 有效定金券 = 使用状态='已使用' AND 支付状态='已支付'
 */
export function computePreSale(options: {
  batchId?: number;
} = {}): PreSaleRow[] {
  const batchId = options.batchId ?? latestBatchId(FILE_TYPES.VOUCHER);
  if (!batchId) return [];

  const rows = biDb.prepare(
    `SELECT id, branch_company, campus, amount
     FROM raw_voucher
     WHERE batch_id = ? AND usage_status = '已使用' AND payment_status = '已支付'`
  ).all(batchId) as Array<{
    id: number;
    branch_company: string | null;
    campus: string | null;
    amount: number | null;
  }>;

  // 批量取所有有效券的学生关联（link_kind=real）
  const voucherIds = rows.map(r => r.id);
  const studentLinkMap = new Map<number, Set<string>>();
  if (voucherIds.length > 0) {
    const placeholders = voucherIds.map(() => '?').join(',');
    const links = biDb.prepare(
      `SELECT voucher_id, student_id FROM voucher_student_link
       WHERE voucher_id IN (` + placeholders + `) AND link_kind = 'real' AND student_id IS NOT NULL`
    ).all(...voucherIds) as Array<{ voucher_id: number; student_id: string }>;
    for (const l of links) {
      if (!studentLinkMap.has(l.voucher_id)) studentLinkMap.set(l.voucher_id, new Set());
      studentLinkMap.get(l.voucher_id)!.add(l.student_id);
    }
  }

  const centerMap = new Map<string, {
    branch: string; center: string;
    voucherCount: number; studentIds: Set<string>; amount: number;
  }>();

  for (const r of rows) {
    const branch = r.branch_company ?? '';
    const center = r.campus ?? '';
    const key = branch + '|' + center;

    let cur = centerMap.get(key);
    if (!cur) {
      cur = { branch, center, voucherCount: 0, studentIds: new Set(), amount: 0 };
      centerMap.set(key, cur);
    }
    cur.voucherCount += 1;
    cur.amount += (r.amount ?? 0);

    const linkStudents = studentLinkMap.get(r.id);
    if (linkStudents) {
      for (const sid of linkStudents) cur.studentIds.add(sid);
    }
  }

  return Array.from(centerMap.values()).map(c => ({
    branch_company: c.branch,
    learning_center: c.center,
    valid_voucher_count: c.voucherCount,
    presale_student_count: c.studentIds.size,
    total_amount: Math.round(c.amount * 100) / 100,
  }));
}

// ============ 可用月份 ============

export function availableMonths(fileType: string): string[] {
  const table = fileType === FILE_TYPES.XUKE_DETAIL
    ? 'raw_xuke_detail'
    : fileType === FILE_TYPES.XUSHENG_DETAIL
    ? 'raw_xusheng_detail'
    : null;
  if (!table) return [];
  const rows = biDb.prepare(
    `SELECT DISTINCT r.stat_month FROM ${table} r
     JOIN upload_batch b ON b.id = r.batch_id
     WHERE b.status = 'committed' AND r.stat_month IS NOT NULL
     ORDER BY r.stat_month DESC`
  ).all() as Array<{ stat_month: string }>;
  return rows.map(r => r.stat_month);
}


// ============ 激励计算 ============

export interface IncentiveRow {
  scope: string;
  scope_value: string;
  target_rate: number;
  /** 学生基数（续生率分母） */
  base_count: number;
  /** 目标续生数 = ceil(基数 × target_rate / 100) */
  target_count: number;
  /** 已完成续生数 */
  renewed_count: number;
  /** 激励差额 = target_count - renewed_count（正数=还差多少人） */
  gap: number;
}

/**
 * 激励计算：按 incentive_settings 配置的目标比例算差额
 *
 * 公式：target = ceil(base × target_rate / 100), gap = target - renewed
 *
 * scope='mentor' 时 base/renewed 直接从 raw_xusheng_detail 取
 * scope='branch_company'/'learning_center' 时需要通过 raw_scheduled_course 或
 * raw_student_snapshot 关联学习中心，暂用 raw_xusheng_detail 的 mentor 维度向上汇总
 */
export function computeIncentive(options: {
  statMonth?: string;
} = {}): IncentiveRow[] {
  const { statMonth } = options;

  // 取生效中的 incentive_settings
  const today = new Date().toISOString().slice(0, 10);
  const settings = biDb.prepare(
    `SELECT scope, scope_value, target_rate FROM incentive_settings
     WHERE effective_from <= ?
       AND (effective_to IS NULL OR effective_to >= ?)`
  ).all(today, today) as Array<{
    scope: string;
    scope_value: string;
    target_rate: number;
  }>;

  if (settings.length === 0) return [];

  // 取续生率数据（mentor 维度）
  let xushengBatchId: number | null;
  if (statMonth) {
    xushengBatchId = latestBatchIdByMonth(FILE_TYPES.XUSHENG_DETAIL, statMonth);
  } else {
    xushengBatchId = latestBatchId(FILE_TYPES.XUSHENG_DETAIL);
  }

  // 按 mentor 聚合基数/续生数
  const mentorStats = new Map<string, { base: number; renewed: number }>();
  if (xushengBatchId) {
    const rows = biDb.prepare(
      `SELECT student_id, mentor_name, renewed_this_month
       FROM raw_xusheng_detail WHERE batch_id = ?`
    ).all(xushengBatchId) as Array<{
      student_id: string; mentor_name: string | null; renewed_this_month: string | null;
    }>;

    // 学生去重
    const studentSet = new Set<string>();
    const mentorByStudent = new Map<string, string>();
    for (const r of rows) {
      if (!r.student_id) continue;
      if (!studentSet.has(r.student_id)) {
        studentSet.add(r.student_id);
        const mentor = r.mentor_name ?? '未知';
        mentorByStudent.set(r.student_id, mentor);
        const s = mentorStats.get(mentor) ?? { base: 0, renewed: 0 };
        s.base += 1;
        if (r.renewed_this_month === '是') s.renewed += 1;
        mentorStats.set(mentor, s);
      }
    }
  }

  // 对每个 incentive_setting 计算差额
  return settings.map(s => {
    let base = 0;
    let renewed = 0;

    if (s.scope === 'mentor') {
      const m = mentorStats.get(s.scope_value);
      if (m) { base = m.base; renewed = m.renewed; }
    } else {
      // branch_company / learning_center 维度暂用所有 mentor 汇总（简化实现）
      for (const m of mentorStats.values()) {
        base += m.base;
        renewed += m.renewed;
      }
    }

    const target = Math.ceil(base * s.target_rate / 100);
    return {
      scope: s.scope,
      scope_value: s.scope_value,
      target_rate: s.target_rate,
      base_count: base,
      target_count: target,
      renewed_count: renewed,
      gap: target - renewed,
    };
  });
}
