/**
 * 对账视图 —— 定金券推算 vs teacher_student_map 差异
 *
 * 逻辑：
 * 1. 从 voucher_student_link 取所有 link_kind='real' 且有 student_id 的记录
 *    → 每个 student_id 在最新批次里出现，标记 voucher_prepaid=1
 * 2. 从 teacher_student_map 取所有记录，看 is_prepaid 标记
 * 3. 差异分类：
 *    - ONLY_VOUCHER: 定金券里有、映射表里没有 → 建议补入映射表
 *    - ONLY_MAP: 映射表里有 is_prepaid=1、定金券里没有 → 可能是老数据/人工覆盖
 *    - OVERRIDE_KEEP: 映射表 prepaid_overridden=1 → 不算差异，人工已确认
 *    - MATCH: 两边都标预存 → 一致
 */
import { biDb } from './db.js';
import { FILE_TYPES } from './fileRegistry.js';

export type ReconcileStatus = 'MATCH' | 'ONLY_VOUCHER' | 'ONLY_MAP' | 'OVERRIDE_KEEP';

export interface ReconcileRow {
  student_id: string;
  student_name: string | null;
  /** 定金券里是否有预存记录 */
  voucher_prepaid: boolean;
  /** 映射表里的 is_prepaid 值 */
  map_prepaid: number | null;
  /** 映射表是否被人工覆盖 */
  map_overridden: boolean;
  /** 老师工号（映射表里的） */
  teacher_no: string | null;
  status: ReconcileStatus;
}

/** 取定金券最新批次里有真实 student_id 的集合 */
function getVoucherPrepaidStudents(): Set<string> {
  const batchRow = biDb.prepare(
    `SELECT id FROM upload_batch WHERE file_type = ? AND status = 'committed' ORDER BY id DESC LIMIT 1`
  ).get(FILE_TYPES.VOUCHER) as { id: number } | undefined;
  if (!batchRow) return new Set();

  const rows = biDb.prepare(
    `SELECT DISTINCT vsl.student_id
     FROM voucher_student_link vsl
     JOIN raw_voucher rv ON rv.id = vsl.voucher_id
     WHERE rv.batch_id = ? AND vsl.link_kind = 'real' AND vsl.student_id IS NOT NULL`
  ).all(batchRow.id) as Array<{ student_id: string }>;
  return new Set(rows.map(r => r.student_id));
}

/**
 * 对账主函数。
 * scope='all' 时做全量对比；传 scopeStudentIds 时只查这些学生。
 */
export function reconcilePrepaid(options: {
  scopeStudentIds?: string[];
} = {}): {
  rows: ReconcileRow[];
  summary: { match: number; onlyVoucher: number; onlyMap: number; overrideKeep: number; total: number };
} {
  const voucherSet = getVoucherPrepaidStudents();

  // 取映射表全部记录（student_id 去重，同一学生可能有多条记录关联不同老师）
  const mapRows = biDb.prepare(
    `SELECT student_id, student_name, is_prepaid, prepaid_overridden, teacher_no
     FROM teacher_student_map`
  ).all() as Array<{
    student_id: string;
    student_name: string | null;
    is_prepaid: number;
    prepaid_overridden: number;
    teacher_no: string;
  }>;

  // 先按 student_id 聚合（同一学生可能关联多个老师，取第一条）
  const mapByStudent = new Map<string, {
    student_name: string | null;
    is_prepaid: number;
    overridden: boolean;
    teacher_no: string | null;
  }>();
  for (const r of mapRows) {
    if (!r.student_id) continue;
    if (!mapByStudent.has(r.student_id)) {
      mapByStudent.set(r.student_id, {
        student_name: r.student_name,
        is_prepaid: r.is_prepaid,
        overridden: r.prepaid_overridden === 1,
        teacher_no: r.teacher_no,
      });
    }
  }

  // 所有涉及的 student_id
  const allStudentIds = new Set([...voucherSet, ...mapByStudent.keys()]);
  const scopeFilter = options.scopeStudentIds
    ? new Set(options.scopeStudentIds)
    : null;

  const rows: ReconcileRow[] = [];
  let match = 0, onlyVoucher = 0, onlyMap = 0, overrideKeep = 0;

  for (const sid of allStudentIds) {
    if (scopeFilter && !scopeFilter.has(sid)) continue;

    const inVoucher = voucherSet.has(sid);
    const mapEntry = mapByStudent.get(sid) ?? null;

    let status: ReconcileStatus;
    if (mapEntry && mapEntry.overridden) {
      status = 'OVERRIDE_KEEP';
      overrideKeep++;
    } else if (inVoucher && mapEntry && mapEntry.is_prepaid === 1) {
      status = 'MATCH';
      match++;
    } else if (inVoucher && (!mapEntry || mapEntry.is_prepaid === 0)) {
      status = 'ONLY_VOUCHER';
      onlyVoucher++;
    } else if (!inVoucher && mapEntry && mapEntry.is_prepaid === 1) {
      status = 'ONLY_MAP';
      onlyMap++;
    } else {
      // 两边都没有预存标记，跳过（不进结果集）
      continue;
    }

    rows.push({
      student_id: sid,
      student_name: mapEntry?.student_name ?? null,
      voucher_prepaid: inVoucher,
      map_prepaid: mapEntry?.is_prepaid ?? null,
      map_overridden: mapEntry?.overridden ?? false,
      teacher_no: mapEntry?.teacher_no ?? null,
      status,
    });
  }

  return {
    rows: rows.sort((a, b) => a.status.localeCompare(b.status) || a.student_id.localeCompare(b.student_id)),
    summary: { match, onlyVoucher, onlyMap, overrideKeep, total: rows.length },
  };
}
