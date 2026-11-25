import { renewalDb, SQL_NOW } from './db.js';

const COMPARABLE_STATUSES = new Set(['committed', 'committed_with_warnings']);
const TABS = new Set(['incentive', 'stage', 'mentor', 'hours']);
const FOLLOW_UP_STATUSES = new Set(['pending', 'contacted', 'committed', 'renewed', 'closed']);

const ADDITIVE_METRICS = [
  'baseCount',
  'prepaidCount',
  'renewedCount',
  'incentiveGap',
  'studentCount',
] as const;
const RATE_METRICS = ['prepaidRate', 'renewRate'] as const;
const STANDARD_METRICS = [
  'baseCount',
  'prepaidCount',
  'prepaidRate',
  'renewedCount',
  'renewRate',
  'incentiveGap',
  'studentCount',
] as const;

export type FollowUpStatus = 'pending' | 'contacted' | 'committed' | 'renewed' | 'closed';

export class RenewalActionError extends Error {
  constructor(message: string, public readonly statusCode = 400) {
    super(message);
    this.name = 'RenewalActionError';
  }
}

export interface RenewalActionReport {
  reportId: number;
  fileName: string;
  fileSize: number;
  statMonth: string | null;
  centerName: string | null;
  rowCount: number | null;
  errorCount: number;
  status: string;
  uploadedAt: string;
}

export interface MetricComparison {
  current: number | null;
  previous: number | null;
  delta: number | null;
}

export interface TeacherMetrics {
  baseCount: number | null;
  prepaidCount: number | null;
  prepaidRate: number | null;
  renewedCount: number | null;
  renewRate: number | null;
  incentiveGap: number | null;
  studentCount: number | null;
  extra: Record<string, number | null>;
}

export interface RenewalComparisonSummary {
  baseCount: MetricComparison;
  prepaidCount: MetricComparison;
  prepaidRate: MetricComparison;
  renewedCount: MetricComparison;
  renewRate: MetricComparison;
  incentiveGap: MetricComparison;
  studentCount: MetricComparison;
  extra: Record<string, MetricComparison>;
}

export interface TeacherComparison {
  teacherKey: string;
  teacherName: string | null;
  teacherNo: string | null;
  subjectGroup: string | null;
  current: TeacherMetrics | null;
  previous: TeacherMetrics | null;
  delta: TeacherMetrics;
}

export interface RenewalComparison {
  tab: string;
  currentReport: RenewalActionReport;
  previousReport: RenewalActionReport;
  summary: RenewalComparisonSummary;
  teachers: TeacherComparison[];
}

export interface RiskFollowup {
  reportId: number;
  studentKey: string;
  owner: string;
  followUpStatus: FollowUpStatus;
  nextFollowUpDate: string | null;
  outcome: string | null;
  updatedBy: number | null;
  createdAt: string;
  updatedAt: string;
}

interface ReportRow {
  id: number;
  file_name: string;
  file_size: number;
  stat_month: string | null;
  center_name: string | null;
  row_count: number | null;
  error_count: number;
  status: string;
  uploaded_at: string;
}

interface TeacherRow {
  id: number;
  teacher_name: string | null;
  teacher_no: string | null;
  subject_group: string | null;
  base_count: number | null;
  prepaid_count: number | null;
  prepaid_rate: number | null;
  renewed_count: number | null;
  renew_rate: number | null;
  incentive_gap: number | null;
  student_count: number | null;
  extra_json: string | null;
  source_row: number | null;
  sort_order: number | null;
}

interface RiskFollowupRow {
  report_id: number;
  student_key: string;
  owner: string;
  follow_up_status: FollowUpStatus;
  next_follow_up_date: string | null;
  outcome: string | null;
  updated_by: number | null;
  created_at: string;
  updated_at: string;
}

interface TeacherGroup {
  key: string;
  rows: TeacherRow[];
}

/** 独立建表，重复调用不会重建或清空已有跟进。 */
export function initRenewalActions(): void {
  renewalDb.exec(`
    CREATE TABLE IF NOT EXISTS renewal_risk_followup (
      report_id INTEGER NOT NULL REFERENCES renewal_report(id) ON DELETE CASCADE,
      student_key TEXT NOT NULL,
      owner TEXT NOT NULL,
      follow_up_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (follow_up_status IN ('pending', 'contacted', 'committed', 'renewed', 'closed')),
      next_follow_up_date TEXT,
      outcome TEXT,
      updated_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (${SQL_NOW}),
      updated_at TEXT NOT NULL DEFAULT (${SQL_NOW}),
      PRIMARY KEY (report_id, student_key)
    )
  `);
}

function assertReportId(reportId: number, field = 'reportId'): void {
  if (!Number.isSafeInteger(reportId) || reportId <= 0) {
    throw new RenewalActionError(`${field} 必须是正整数`);
  }
}

function toReport(row: ReportRow): RenewalActionReport {
  return {
    reportId: row.id,
    fileName: row.file_name,
    fileSize: row.file_size,
    statMonth: row.stat_month,
    centerName: row.center_name,
    rowCount: row.row_count,
    errorCount: row.error_count,
    status: row.status,
    uploadedAt: row.uploaded_at,
  };
}

function getReport(reportId: number, userId: number): ReportRow {
  assertReportId(reportId);
  const row = renewalDb.prepare(`
    SELECT id, file_name, file_size, stat_month, center_name, row_count,
           error_count, status, uploaded_at
    FROM renewal_report WHERE id = ? AND uploaded_by = ?
  `).get(reportId, userId) as ReportRow | undefined;
  if (!row) throw new RenewalActionError('报表批次不存在', 404);
  return row;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseExtra(value: string | null): Record<string, number | null> {
  if (!value) return {};
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const extra: Record<string, number | null> = {};
  for (const [key, item] of Object.entries(parsed)) {
    if (item === null) extra[key] = null;
    else {
      const number = nullableNumber(item);
      if (number !== null) extra[key] = number;
    }
  }
  return extra;
}

function teacherMetrics(row: TeacherRow): TeacherMetrics {
  return {
    baseCount: nullableNumber(row.base_count),
    prepaidCount: nullableNumber(row.prepaid_count),
    prepaidRate: nullableNumber(row.prepaid_rate),
    renewedCount: nullableNumber(row.renewed_count),
    renewRate: nullableNumber(row.renew_rate),
    incentiveGap: nullableNumber(row.incentive_gap),
    studentCount: nullableNumber(row.student_count),
    extra: parseExtra(row.extra_json),
  };
}

function sumMetric(rows: TeacherRow[], metric: typeof ADDITIVE_METRICS[number]): number | null {
  const column = {
    baseCount: 'base_count',
    prepaidCount: 'prepaid_count',
    renewedCount: 'renewed_count',
    incentiveGap: 'incentive_gap',
    studentCount: 'student_count',
  }[metric] as keyof TeacherRow;
  if (rows.length === 0) return null;
  let total = 0;
  for (const row of rows) {
    const value = nullableNumber(row[column]);
    if (value === null) return null;
    total += value;
  }
  return total;
}

/**
 * 汇总率沿用教师行里已导入的百分比，以学生基数加权；没有把 NULL 当成 0。
 * 任一相关教师指标为 NULL、无可用权重或所有率为 NULL 时，整体率保持 NULL。
 */
function weightedRate(rows: TeacherRow[], metric: typeof RATE_METRICS[number]): number | null {
  const column = metric === 'prepaidRate' ? 'prepaid_rate' : 'renew_rate';
  let weightTotal = 0;
  let weightedTotal = 0;
  for (const row of rows) {
    const rate = nullableNumber(row[column]);
    const weight = nullableNumber(row.base_count);
    if (rate === null || weight === null) return null;
    if (weight <= 0) continue;
    weightedTotal += rate * weight;
    weightTotal += weight;
  }
  return weightTotal > 0 ? weightedTotal / weightTotal : null;
}

function aggregateExtra(rows: TeacherRow[]): Record<string, number | null> {
  const extras = rows.map(row => parseExtra(row.extra_json));
  const keys = new Set(extras.flatMap(extra => Object.keys(extra)));
  const result: Record<string, number | null> = {};
  for (const key of keys) {
    let total = 0;
    let complete = rows.length > 0;
    for (const extra of extras) {
      const value = extra[key];
      if (value === null || value === undefined) {
        complete = false;
        break;
      }
      total += value;
    }
    result[key] = complete ? total : null;
  }
  return result;
}

function aggregateTeachers(rows: TeacherRow[]): TeacherMetrics {
  if (rows.length === 1) return teacherMetrics(rows[0]);
  const aggregate = {} as TeacherMetrics;
  for (const metric of ADDITIVE_METRICS) aggregate[metric] = sumMetric(rows, metric);
  for (const metric of RATE_METRICS) aggregate[metric] = weightedRate(rows, metric);
  aggregate.extra = aggregateExtra(rows);
  return aggregate;
}

function teacherKey(row: TeacherRow): string {
  const teacherNo = row.teacher_no?.trim();
  if (teacherNo) return `no:${teacherNo}`;
  // 没有工号时不能按姓名合并：同名教师可能是两个人。
  // Excel 行号在同一 tab 内唯一，跨批次也比姓名更适合做保守匹配。
  if (row.source_row !== null) return `source_row:${row.source_row}`;
  const teacherName = row.teacher_name?.trim();
  const subjectGroup = row.subject_group?.trim() ?? '';
  if (teacherName) return `name:${teacherName}|subject:${subjectGroup}`;
  return `row_id:${row.id}`;
}

function loadTeacherGroups(reportId: number, tab: string): Map<string, TeacherGroup> {
  const rows = renewalDb.prepare(`
    SELECT id, teacher_name, teacher_no, subject_group,
           base_count, prepaid_count, prepaid_rate, renewed_count, renew_rate,
           incentive_gap, student_count, extra_json, source_row, sort_order
    FROM teacher_stats
    WHERE report_id = ? AND tab = ?
    ORDER BY sort_order, id
  `).all(reportId, tab) as TeacherRow[];
  const groups = new Map<string, TeacherGroup>();
  for (const row of rows) {
    const key = teacherKey(row);
    const group = groups.get(key);
    if (group) group.rows.push(row);
    else groups.set(key, { key, rows: [row] });
  }
  return groups;
}

function difference(current: number | null | undefined, previous: number | null | undefined): number | null {
  return current === null || current === undefined || previous === null || previous === undefined
    ? null
    : current - previous;
}

function comparisonOf(current: number | null, previous: number | null): MetricComparison {
  return { current, previous, delta: difference(current, previous) };
}

function deltaMetrics(current: TeacherMetrics | null, previous: TeacherMetrics | null): TeacherMetrics {
  const delta = {} as TeacherMetrics;
  for (const metric of STANDARD_METRICS) {
    delta[metric] = difference(current?.[metric], previous?.[metric]);
  }
  const extraKeys = new Set([
    ...Object.keys(current?.extra ?? {}),
    ...Object.keys(previous?.extra ?? {}),
  ]);
  delta.extra = {};
  for (const key of extraKeys) {
    delta.extra[key] = difference(current?.extra[key], previous?.extra[key]);
  }
  return delta;
}

function summarize(currentRows: TeacherRow[], previousRows: TeacherRow[]): RenewalComparisonSummary {
  const current = aggregateTeachers(currentRows);
  const previous = aggregateTeachers(previousRows);
  const summary = {} as RenewalComparisonSummary;
  for (const metric of STANDARD_METRICS) {
    summary[metric] = comparisonOf(current[metric], previous[metric]);
  }
  summary.extra = {};
  for (const key of new Set([...Object.keys(current.extra), ...Object.keys(previous.extra)])) {
    summary.extra[key] = comparisonOf(current.extra[key] ?? null, previous.extra[key] ?? null);
  }
  return summary;
}

/** 同中心、已提交批次的教师指标对比；current/previous 完全由调用方指定。 */
export function compareRenewalReports(
  reportId: number,
  compareReportId: number,
  userId: number,
  tab = 'stage',
): RenewalComparison {
  assertReportId(reportId);
  assertReportId(compareReportId, 'compareReportId');
  if (!TABS.has(tab)) throw new RenewalActionError('未知的统计表 tab');

  const currentRow = getReport(reportId, userId);
  const previousRow = getReport(compareReportId, userId);
  if (!COMPARABLE_STATUSES.has(currentRow.status) || !COMPARABLE_STATUSES.has(previousRow.status)) {
    throw new RenewalActionError('仅支持对比 committed 或 committed_with_warnings 批次');
  }
  const currentCenter = currentRow.center_name?.trim();
  const previousCenter = previousRow.center_name?.trim();
  if (!currentCenter || !previousCenter || currentCenter !== previousCenter) {
    throw new RenewalActionError('两个报表批次必须属于同一中心');
  }

  const currentGroups = loadTeacherGroups(reportId, tab);
  const previousGroups = loadTeacherGroups(compareReportId, tab);
  const currentRows = [...currentGroups.values()].flatMap(group => group.rows);
  const previousRows = [...previousGroups.values()].flatMap(group => group.rows);
  const keys = new Set([...currentGroups.keys(), ...previousGroups.keys()]);
  const teachers: TeacherComparison[] = [];

  for (const key of keys) {
    const currentGroup = currentGroups.get(key);
    const previousGroup = previousGroups.get(key);
    const identity = currentGroup?.rows[0] ?? previousGroup!.rows[0];
    const currentMetrics = currentGroup ? aggregateTeachers(currentGroup.rows) : null;
    const previousMetrics = previousGroup ? aggregateTeachers(previousGroup.rows) : null;
    teachers.push({
      teacherKey: key,
      teacherName: identity.teacher_name,
      teacherNo: identity.teacher_no,
      subjectGroup: identity.subject_group,
      current: currentMetrics,
      previous: previousMetrics,
      delta: deltaMetrics(currentMetrics, previousMetrics),
    });
  }
  teachers.sort((a, b) =>
    (a.teacherName ?? '').localeCompare(b.teacherName ?? '', 'zh-CN') ||
    a.teacherKey.localeCompare(b.teacherKey)
  );

  return {
    tab,
    currentReport: toReport(currentRow),
    previousReport: toReport(previousRow),
    summary: summarize(currentRows, previousRows),
    teachers,
  };
}

function toRiskFollowup(row: RiskFollowupRow): RiskFollowup {
  return {
    reportId: row.report_id,
    studentKey: row.student_key,
    owner: row.owner,
    followUpStatus: row.follow_up_status,
    nextFollowUpDate: row.next_follow_up_date,
    outcome: row.outcome,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getRiskFollowup(reportId: number, studentKey: string): RiskFollowup {
  const row = renewalDb.prepare(`
    SELECT report_id, student_key, owner, follow_up_status, next_follow_up_date,
           outcome, updated_by, created_at, updated_at
    FROM renewal_risk_followup
    WHERE report_id = ? AND student_key = ?
  `).get(reportId, studentKey) as RiskFollowupRow | undefined;
  if (!row) throw new RenewalActionError('跟进记录不存在', 404);
  return toRiskFollowup(row);
}

export function listRiskFollowups(reportId: number, userId: number): RiskFollowup[] {
  getReport(reportId, userId);
  const rows = renewalDb.prepare(`
    SELECT report_id, student_key, owner, follow_up_status, next_follow_up_date,
           outcome, updated_by, created_at, updated_at
    FROM renewal_risk_followup
    WHERE report_id = ?
    ORDER BY updated_at DESC, student_key ASC
  `).all(reportId) as RiskFollowupRow[];
  return rows.map(toRiskFollowup);
}

function validDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}

function parseFollowupBody(input: unknown): {
  owner: string;
  followUpStatus: FollowUpStatus;
  nextFollowUpDate: string | null;
  outcome: string | null;
} {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new RenewalActionError('请求体必须是 JSON 对象');
  }
  const body = input as Record<string, unknown>;
  if (typeof body.owner !== 'string' || !body.owner.trim() || body.owner.trim().length > 80) {
    throw new RenewalActionError('owner 必填，且长度须为 1–80 个字符');
  }
  if (typeof body.followUpStatus !== 'string' || !FOLLOW_UP_STATUSES.has(body.followUpStatus)) {
    throw new RenewalActionError('followUpStatus 必须是 pending、contacted、committed、renewed 或 closed');
  }

  let nextFollowUpDate: string | null = null;
  if (body.nextFollowUpDate !== undefined && body.nextFollowUpDate !== null && body.nextFollowUpDate !== '') {
    if (typeof body.nextFollowUpDate !== 'string') {
      throw new RenewalActionError('nextFollowUpDate 必须是 YYYY-MM-DD 日期或 null');
    }
    const candidate = body.nextFollowUpDate.trim();
    if (!validDate(candidate)) {
      throw new RenewalActionError('nextFollowUpDate 必须是有效的 YYYY-MM-DD 日期');
    }
    nextFollowUpDate = candidate;
  }

  let outcome: string | null = null;
  if (body.outcome !== undefined && body.outcome !== null) {
    if (typeof body.outcome !== 'string' || body.outcome.length > 2000) {
      throw new RenewalActionError('outcome 必须是最多 2000 个字符的字符串或 null');
    }
    outcome = body.outcome.trim() || null;
  }

  return {
    owner: body.owner.trim(),
    followUpStatus: body.followUpStatus as FollowUpStatus,
    nextFollowUpDate,
    outcome,
  };
}

/**
 * studentKey 是风险学生的稳定键：有学生编号时直接用编号，否则由调用方传
 * source_row:<行号>。键只在对应 reportId 内唯一，不跨批次复用跟进。
 */
export function upsertRiskFollowup(
  reportId: number,
  rawStudentKey: string,
  input: unknown,
  userId: number,
): RiskFollowup {
  assertReportId(reportId);
  if (typeof rawStudentKey !== 'string') throw new RenewalActionError('studentKey 必填');
  const studentKey = rawStudentKey.trim();
  if (!studentKey || studentKey.length > 200 || /[\u0000-\u001f\u007f]/.test(studentKey)) {
    throw new RenewalActionError('studentKey 长度须为 1–200 个字符，且不能包含控制字符');
  }
  const body = parseFollowupBody(input);

  return renewalDb.transaction(() => {
    getReport(reportId, userId);
    const riskStudent = renewalDb.prepare(`
      SELECT 1 FROM student_funnel
      WHERE report_id = ?
        AND COALESCE(student_id, 'source_row:' || source_row) = ?
        AND renewed = 0 AND class_last1 = 0
        AND student_name NOT IN ('小计', '合计')
      LIMIT 1
    `).get(reportId, studentKey);
    if (!riskStudent) {
      throw new RenewalActionError('学生不属于该批次的待关注清单，请刷新后重试', 404);
    }
    renewalDb.prepare(`
      INSERT INTO renewal_risk_followup
        (report_id, student_key, owner, follow_up_status, next_follow_up_date,
         outcome, updated_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ${SQL_NOW}, ${SQL_NOW})
      ON CONFLICT(report_id, student_key) DO UPDATE SET
        owner = excluded.owner,
        follow_up_status = excluded.follow_up_status,
        next_follow_up_date = excluded.next_follow_up_date,
        outcome = excluded.outcome,
        updated_by = excluded.updated_by,
        updated_at = ${SQL_NOW}
    `).run(
      reportId,
      studentKey,
      body.owner,
      body.followUpStatus,
      body.nextFollowUpDate,
      body.outcome,
      userId,
    );
    return getRiskFollowup(reportId, studentKey);
  })();
}
