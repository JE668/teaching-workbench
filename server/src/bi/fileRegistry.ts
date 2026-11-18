import { biDb } from './db.js';

/**
 * 上传文件类型常量。
 * 
 * file_type 是稳定标识符（不随显示名变化），用于：
 *   - upload_batch.file_type 外部引用
 *   - 前端"上传报表"下拉框
 *   - 路由分发到对应 parser
 */
export const FILE_TYPES = {
  STUDENT_SNAPSHOT: 'student_snapshot',           // 在读学生明细
  SUBJECT_SNAPSHOT: 'subject_snapshot',           // 在册科次明细
  RENEW_CLOSE_RATIO: 'renew_close_ratio',         // 科组科次续结比(月)
  XUSHENG_DETAIL: 'xusheng_detail',               // 续生率-学生明细
  XUKE_DETAIL: 'xuke_detail',                     // 续科率(5分钟)-科次明细
  SCHEDULED_COURSE: 'scheduled_course',           // 预排课程状态统计
  VOUCHER: 'voucher',                             // 定金券使用报表
  PERSONAL_PERF: 'personal_perf',                 // 个人业绩统计（待用户重新导出后再启用）
} as const;

export type FileType = typeof FILE_TYPES[keyof typeof FILE_TYPES];

interface RegistryRow {
  file_type: string;
  display_name: string;
  sheet_name: string | null;
  header_row: number;
  parser_version: number;
  enabled: number;
  description: string | null;
}

/**
 * 文件类型注册表种子数据。启动时 INSERT OR REPLACE，保证最新。
 * 临时禁用的类型把 enabled 设 0，前端不显示但老 batch 仍可查。
 */
const REGISTRY_SEED: RegistryRow[] = [
  {
    file_type: FILE_TYPES.STUDENT_SNAPSHOT,
    display_name: '在读学生明细',
    sheet_name: null,
    header_row: 1,
    parser_version: 1,
    enabled: 1,
    description: '学生级快照，含学管师、年级、状态、剩余小时等。约 387 行 × 28 列。',
  },
  {
    file_type: FILE_TYPES.SUBJECT_SNAPSHOT,
    display_name: '在册科次明细',
    sheet_name: null,
    header_row: 1,
    parser_version: 1,
    enabled: 1,
    description: '学生×科目 级快照，含科目状态、剩余小时、停结课日期。约 600 行 × 21 列。',
  },
  {
    file_type: FILE_TYPES.RENEW_CLOSE_RATIO,
    display_name: '科组科次续结比(月)',
    sheet_name: null,
    header_row: 1,
    parser_version: 1,
    enabled: 1,
    description: '按月统计新增结课/新增续费，用于结课学生续费转化率。约 20 行 × 20 列。',
  },
  {
    file_type: FILE_TYPES.XUSHENG_DETAIL,
    display_name: '续生率-学生明细',
    sheet_name: '续生率-学生明细(实时)',
    header_row: 1,
    parser_version: 1,
    enabled: 1,
    description: '学管维度的续生明细，含本月是否续费、续费金额拆分等。约 207 行 × 29 列。',
  },
  {
    file_type: FILE_TYPES.XUKE_DETAIL,
    display_name: '续科率(5分钟)-科次明细',
    sheet_name: null,
    header_row: 1,
    parser_version: 1,
    enabled: 1,
    description: '老师维度的续科明细，含科组、课消产品类别、本月是否续科等。约 271 行 × 26 列。',
  },
  {
    file_type: FILE_TYPES.SCHEDULED_COURSE,
    display_name: '预排课程状态统计',
    sheet_name: null,
    header_row: 1,
    parser_version: 1,
    enabled: 1,
    description: '课程级明细，含上课日期、老师、学生、科目、扣费状态等。约 3581 行 × 31 列。',
  },
  {
    file_type: FILE_TYPES.VOUCHER,
    display_name: '定金券使用报表',
    sheet_name: '0',
    header_row: 1,
    parser_version: 1,
    enabled: 1,
    description: '预存明细，含建券员工、金额、使用状态、关联合同、关联学生（多值）。约 200 行 × 15 列。',
  },
  {
    file_type: FILE_TYPES.PERSONAL_PERF,
    display_name: '个人业绩统计',
    sheet_name: null,
    header_row: 5,
    parser_version: 1,
    enabled: 1,
    description: '业绩人员维度：合同 × 产品类型 业绩分配。数据从第 7 行起（第 3-5 行三层合并表头）。每行约 20 条。',
  },
];

/**
 * 同步文件类型注册表到 bi.db（幂等）。
 * 在 initBiDb() 之后调用。
 */
export function seedFileRegistry(): void {
  const stmt = biDb.prepare(`
    INSERT INTO file_registry
      (file_type, display_name, sheet_name, header_row, parser_version, enabled, description)
    VALUES
      (@file_type, @display_name, @sheet_name, @header_row, @parser_version, @enabled, @description)
    ON CONFLICT(file_type) DO UPDATE SET
      display_name = excluded.display_name,
      sheet_name = excluded.sheet_name,
      header_row = excluded.header_row,
      parser_version = excluded.parser_version,
      enabled = excluded.enabled,
      description = excluded.description
  `);

  const tx = biDb.transaction(() => {
    for (const row of REGISTRY_SEED) {
      stmt.run(row);
    }
  });
  tx();
  log.debug({ count: REGISTRY_SEED.length }, 'file_registry 已同步');
}

// 引入 log：避免循环依赖，直接从 utils 导入
import { log } from '../utils/logger.js';
