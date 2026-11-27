import { renewalDb, SQL_NOW } from './db.js';
import { ownsReport } from './renewalService.js';

export const MANAGER_PRODUCT_KEYS = ['one2one', 'one2many', 'small', 'other'] as const;
export type ManagerProductKey = typeof MANAGER_PRODUCT_KEYS[number];
export type ManagerProductTargets = Record<ManagerProductKey, number | null>;

const TARGET_COLUMNS: Record<ManagerProductKey, string> = {
  one2one: 'one2one_target',
  one2many: 'one2many_target',
  small: 'small_target',
  other: 'other_target',
};

interface TargetOverrideRow {
  target_amount: number | null;
  one2one_target: number | null;
  one2many_target: number | null;
  small_target: number | null;
  other_target: number | null;
}

interface ParsedTarget {
  managerName: string;
  hasTargetAmount: boolean;
  targetAmount: number | null;
  hasProductTargets: boolean;
  resetProductTargets: boolean;
  productTargets: Partial<ManagerProductTargets>;
}

export class ManagerTargetError extends Error {
  constructor(message: string, public readonly statusCode = 400) {
    super(message);
    this.name = 'ManagerTargetError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertKnownKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unknown = Object.keys(value).find(key => !allowed.includes(key));
  if (unknown) throw new ManagerTargetError(`${label}包含未知字段: ${unknown}`);
}

function nonNegativeNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new ManagerTargetError(`${label}必须是大于等于 0 的有限数值`);
  }
  return value;
}

function parseReportId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new ManagerTargetError('reportId 必须是正整数');
  }
  return value;
}

function parseTarget(value: unknown, index: number): ParsedTarget {
  const label = `targets[${index}]`;
  if (!isRecord(value)) throw new ManagerTargetError(`${label}必须是对象`);
  assertKnownKeys(value, ['managerName', 'targetAmount', 'productTargets'], label);
  if (typeof value.managerName !== 'string' || !value.managerName.trim()) {
    throw new ManagerTargetError(`${label}.managerName必须是非空字符串`);
  }
  const managerName = value.managerName.trim();
  if (managerName.length > 200) throw new ManagerTargetError(`${label}.managerName过长`);

  const hasTargetAmount = Object.hasOwn(value, 'targetAmount');
  const hasProductTargets = Object.hasOwn(value, 'productTargets');
  if (!hasTargetAmount && !hasProductTargets) {
    throw new ManagerTargetError(`${label}至少需要 targetAmount 或 productTargets`);
  }

  let targetAmount: number | null = null;
  if (hasTargetAmount && value.targetAmount !== null) {
    targetAmount = nonNegativeNumber(value.targetAmount, `${label}.targetAmount`);
  }

  let resetProductTargets = false;
  const productTargets: Partial<ManagerProductTargets> = {};
  if (hasProductTargets) {
    if (value.productTargets === null) {
      resetProductTargets = true;
    } else {
      if (!isRecord(value.productTargets)) {
        throw new ManagerTargetError(`${label}.productTargets必须是对象或 null`);
      }
      assertKnownKeys(value.productTargets, MANAGER_PRODUCT_KEYS, `${label}.productTargets`);
      for (const key of MANAGER_PRODUCT_KEYS) {
        if (!Object.hasOwn(value.productTargets, key)) continue;
        const target = value.productTargets[key];
        productTargets[key] = target === null
          ? null
          : nonNegativeNumber(target, `${label}.productTargets.${key}`);
      }
    }
  }

  return { managerName, hasTargetAmount, targetAmount, hasProductTargets, resetProductTargets, productTargets };
}

function parseBody(body: unknown): { reportId: number; targets: ParsedTarget[] } {
  if (!isRecord(body)) throw new ManagerTargetError('请求体必须是对象');
  assertKnownKeys(body, ['reportId', 'targets'], '请求体');
  const reportId = parseReportId(body.reportId);
  if (!Array.isArray(body.targets) || body.targets.length === 0) {
    throw new ManagerTargetError('targets 必须是非空数组');
  }
  const targets = body.targets.map(parseTarget);
  const names = new Set<string>();
  for (const target of targets) {
    if (names.has(target.managerName)) {
      throw new ManagerTargetError(`学管 ${target.managerName} 在 targets 中重复`);
    }
    names.add(target.managerName);
  }
  return { reportId, targets };
}

function overrideOf(row: TargetOverrideRow | undefined, key: ManagerProductKey): number | null {
  if (!row) return null;
  return row[TARGET_COLUMNS[key] as keyof TargetOverrideRow] as number | null;
}

/**
 * 批量按字段合并人工覆盖：未传字段保留原覆盖，null 清除对应覆盖。
 * productTargets=null 清除四个产品；同时传 targetAmount=null 即可恢复该学管全部导入/默认任务。
 */
export function saveManagerTargets(body: unknown, userId: number): number {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new ManagerTargetError('用户身份无效', 401);
  const { reportId, targets } = parseBody(body);
  if (!ownsReport(reportId, userId)) throw new ManagerTargetError('报表批次不存在', 404);

  const save = renewalDb.transaction((items: ParsedTarget[]) => {
    const managerRows = renewalDb.prepare(
      'SELECT manager_name FROM manager_perf WHERE report_id = ? AND manager_name IS NOT NULL',
    ).all(reportId) as Array<{ manager_name: string }>;
    const validManagers = new Set(managerRows.map(row => row.manager_name));
    for (const item of items) {
      if (!validManagers.has(item.managerName)) {
        throw new ManagerTargetError(`学管 ${item.managerName} 不属于该报表`);
      }
    }

    const select = renewalDb.prepare(`
      SELECT target_amount, one2one_target, one2many_target, small_target, other_target
      FROM renewal_manager_target
      WHERE report_id = ? AND user_id = ? AND manager_name = ?
    `);
    const upsert = renewalDb.prepare(`
      INSERT INTO renewal_manager_target (
        report_id, user_id, manager_name, target_amount,
        one2one_target, one2many_target, small_target, other_target, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${SQL_NOW})
      ON CONFLICT(report_id, user_id, manager_name) DO UPDATE SET
        target_amount = excluded.target_amount,
        one2one_target = excluded.one2one_target,
        one2many_target = excluded.one2many_target,
        small_target = excluded.small_target,
        other_target = excluded.other_target,
        updated_at = excluded.updated_at
    `);
    const remove = renewalDb.prepare(
      'DELETE FROM renewal_manager_target WHERE report_id = ? AND user_id = ? AND manager_name = ?',
    );

    for (const item of items) {
      const existing = select.get(reportId, userId, item.managerName) as TargetOverrideRow | undefined;
      const targetAmount = item.hasTargetAmount ? item.targetAmount : existing?.target_amount ?? null;
      const products = {} as ManagerProductTargets;
      for (const key of MANAGER_PRODUCT_KEYS) {
        products[key] = item.resetProductTargets
          ? null
          : Object.hasOwn(item.productTargets, key)
            ? item.productTargets[key] ?? null
            : overrideOf(existing, key);
      }
      const values = [targetAmount, ...MANAGER_PRODUCT_KEYS.map(key => products[key])];
      if (values.every(value => value === null)) {
        remove.run(reportId, userId, item.managerName);
      } else {
        upsert.run(reportId, userId, item.managerName, ...values);
      }
    }
  });

  save(targets);
  return reportId;
}
