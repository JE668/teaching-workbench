import { biDb } from './db.js';
import { log } from '../utils/logger.js';

/**
 * bi.db 初始化：幂等建表。
 *
 * 与业务库的 migrations/runner.ts 不同——bi 库表结构变更频率低，
 * 第一期直接用 CREATE TABLE IF NOT EXISTS 幂等初始化；
 * 后续结构演进时再引入版本号机制。
 */
export function initBiDb(): void {
  const sql = `-- bi.db 初始 schema
-- 所有 raw_* 表都带 batch_id，通过 batch_id 可整批回滚/删除。
-- 所有时间字段存 ISO8601 字符串（SQLite TEXT），避免时区歧义。

-- ============ 批次管理 ============

-- 上传批次：一次上传 = 一个 batch
CREATE TABLE IF NOT EXISTS upload_batch (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_type TEXT NOT NULL,             -- 见 file_registry.file_type
  file_name TEXT NOT NULL,             -- 原始文件名
  file_size INTEGER,                   -- 字节数
  uploaded_by INTEGER NOT NULL,        -- users.id（业务库），仅记录不做外键
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  row_count INTEGER,                   -- 解析后总行数
  error_count INTEGER DEFAULT 0,       -- 跳过的错误行数
  status TEXT NOT NULL DEFAULT 'pending',  -- pending/parsed/committed/failed
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
);
CREATE INDEX IF NOT EXISTS idx_upload_batch_file_type ON upload_batch(file_type);
CREATE INDEX IF NOT EXISTS idx_upload_batch_uploaded_at ON upload_batch(uploaded_at DESC);

-- 文件类型注册表：每种上传文件对应一个解析器
CREATE TABLE IF NOT EXISTS file_registry (
  file_type TEXT PRIMARY KEY,          -- stable identifier, e.g. 'continuation_student'
  display_name TEXT NOT NULL,          -- 中文显示名
  sheet_name TEXT,                     -- xlsx 主 sheet 名（空=第一个 sheet）
  header_row INTEGER NOT NULL DEFAULT 1,
  parser_version INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1,
  description TEXT
);

-- 解析错误明细（哪一行因为什么原因被跳过）
CREATE TABLE IF NOT EXISTS import_error (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL,
  row_number INTEGER NOT NULL,         -- xlsx 中的行号（含表头）
  error_code TEXT NOT NULL,            -- MISSING_FIELD / INVALID_TYPE / DUPLICATE / ...
  error_message TEXT,
  raw_data TEXT,                       -- 原始行 JSON（便于人工核对）
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  FOREIGN KEY (batch_id) REFERENCES upload_batch(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_import_error_batch ON import_error(batch_id);

-- ============ 在读学生明细 ============
-- 源：在读学生明细.xlsx（387 行×28 列，按统计日期快照）
CREATE TABLE IF NOT EXISTS raw_student_snapshot (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL,
  stat_date TEXT,                      -- 统计日期
  mentor_name TEXT,                    -- 学管师
  mentor_no TEXT,                      -- 学管师工号
  student_name TEXT,
  student_id TEXT,                     -- STU 开头的业务 ID
  grade TEXT,
  personalization_status TEXT,         -- 学生个性化状态
  student_status TEXT,                 -- 学生状态
  student_nature TEXT,                 -- 学生性质
  one_to_one_status TEXT,              -- 1对1学生状态
  one_to_one_end_date TEXT,            -- 1对1停结课日期
  one_to_many_status TEXT,             -- 1对多学生状态
  one_to_many_end_date TEXT,
  total_remaining_hours REAL,          -- 总剩余小时
  extra TEXT,                          -- 剩余列的 JSON 兜底（schema 演进用）
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  FOREIGN KEY (batch_id) REFERENCES upload_batch(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_raw_student_snapshot_batch ON raw_student_snapshot(batch_id);
CREATE INDEX IF NOT EXISTS idx_raw_student_snapshot_student ON raw_student_snapshot(student_id);
CREATE INDEX IF NOT EXISTS idx_raw_student_snapshot_date ON raw_student_snapshot(stat_date);

-- ============ 在册科次明细 ============
-- 源：在册科次明细.xlsx（600×21）
CREATE TABLE IF NOT EXISTS raw_subject_snapshot (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL,
  stat_date TEXT,
  mentor_name TEXT,
  student_name TEXT,
  student_id TEXT,
  grade TEXT,
  student_product_status TEXT,         -- 学生产品状态
  student_product_nature TEXT,         -- 学生产品性质
  subject_nature TEXT,                 -- 科目性质
  subject TEXT,                        -- 科目
  subject_status TEXT,                 -- 科目状态
  subject_remaining_hours REAL,        -- 科目剩余小时
  subject_end_date TEXT,               -- 科目停结课日期
  extra TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  FOREIGN KEY (batch_id) REFERENCES upload_batch(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_raw_subject_snapshot_batch ON raw_subject_snapshot(batch_id);
CREATE INDEX IF NOT EXISTS idx_raw_subject_snapshot_student ON raw_subject_snapshot(student_id);
CREATE INDEX IF NOT EXISTS idx_raw_subject_snapshot_student_subject ON raw_subject_snapshot(student_id, subject);

-- ============ 科组科次续结比(月) ============
-- 源：科组科次续结比(月)-学生明细.xlsx（20×20）
-- 关键语义：新增结课 / 新增续费 —— 用于判定"结课学生是否续"
CREATE TABLE IF NOT EXISTS raw_renew_close_ratio (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL,
  year_month TEXT,                     -- 年月，如 2026-11
  period_start TEXT,                   -- 月起
  period_end TEXT,                     -- 月止
  learning_center TEXT,                -- 学习中心
  product_type TEXT,                   -- 产品类型
  subject_group TEXT,                  -- 科组
  subject TEXT,
  student_id TEXT,
  student_name TEXT,
  status TEXT,                         -- 新增结课 / 新增续费
  event_date TEXT,                     -- 发生日期
  grade TEXT,
  mentor_no TEXT,
  mentor_name TEXT,
  teacher_no TEXT,
  teacher_name TEXT,
  extra TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  FOREIGN KEY (batch_id) REFERENCES upload_batch(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_raw_renew_close_batch ON raw_renew_close_ratio(batch_id);
CREATE INDEX IF NOT EXISTS idx_raw_renew_close_ym ON raw_renew_close_ratio(year_month);
CREATE INDEX IF NOT EXISTS idx_raw_renew_close_student ON raw_renew_close_ratio(student_id);
CREATE INDEX IF NOT EXISTS idx_raw_renew_close_teacher ON raw_renew_close_ratio(teacher_no);

-- ============ 续生率-学生明细 ============
-- 源：续生率-学生明细.xlsx（207×29，sheet='续生率-学生明细(实时)'）
CREATE TABLE IF NOT EXISTS raw_xusheng_detail (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL,
  stat_month TEXT,                     -- 月份
  mentor_name TEXT,
  student_name TEXT,
  student_id TEXT,
  grade TEXT,
  first_enroll_date TEXT,              -- 首次报读个性化日期
  enroll_days INTEGER,                 -- 报读时长(天)
  category TEXT,                       -- 类型：前2月有课消 / 前2月无课消
  renewed_this_month TEXT,             -- 本月是否续费 是/否
  renew_time TEXT,                     -- 续费时间
  renew_product TEXT,                  -- 续费产品
  renew_personalized_amount REAL,      -- 续个性化金额
  renew_one_to_one_amount REAL,        -- 续1对1金额
  renew_one_to_many_amount REAL,       -- 续1对多金额
  renew_class_amount REAL,             -- 续班课金额
  renew_hours_standard REAL,           -- 续费小时(正价)
  extra TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  FOREIGN KEY (batch_id) REFERENCES upload_batch(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_raw_xusheng_batch ON raw_xusheng_detail(batch_id);
CREATE INDEX IF NOT EXISTS idx_raw_xusheng_student ON raw_xusheng_detail(student_id);
CREATE INDEX IF NOT EXISTS idx_raw_xusheng_month ON raw_xusheng_detail(stat_month);
CREATE INDEX IF NOT EXISTS idx_raw_xusheng_mentor ON raw_xusheng_detail(mentor_name);

-- ============ 续科率(5分钟)-科次明细 ============
-- 源：续科率(5分钟)-科次明细.xlsx（271×26）
-- 老师维度核心数据
CREATE TABLE IF NOT EXISTS raw_xuke_detail (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL,
  stat_month TEXT,
  teacher_name TEXT,
  teacher_no TEXT,
  student_name TEXT,
  student_id TEXT,
  grade TEXT,
  mentor_name TEXT,
  mentor_no TEXT,
  major_subject_group TEXT,            -- 大科组
  subject_group TEXT,                  -- 科组
  subject TEXT,
  month_start_remaining_hours REAL,    -- 月初科目剩余小时
  remaining_hours_segment TEXT,        -- 剩余小时分段
  prev_month_subject_status TEXT,      -- 上月末科目状态
  consume_product_category TEXT,       -- 课消产品类别（用于跨表模糊匹配）
  attended_prev_1m TEXT,               -- 前1个月是否上课
  attended_prev_2m TEXT,               -- 前2个月是否上课
  renewed_this_month TEXT,             -- 本月是否续科 是/否
  renew_product_category TEXT,         -- 续费产品类别
  renew_hours REAL,
  prev_2m_learning_center TEXT,        -- 前2个月上课学习中心
  prev_6m_learning_center TEXT,        -- 前6个月上课学习中心
  extra TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  FOREIGN KEY (batch_id) REFERENCES upload_batch(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_raw_xuke_batch ON raw_xuke_detail(batch_id);
CREATE INDEX IF NOT EXISTS idx_raw_xuke_student ON raw_xuke_detail(student_id);
CREATE INDEX IF NOT EXISTS idx_raw_xuke_teacher ON raw_xuke_detail(teacher_no);
CREATE INDEX IF NOT EXISTS idx_raw_xuke_month ON raw_xuke_detail(stat_month);

-- ============ 预排课程状态统计 ============
-- 源：预排课程状态统计-学生明细.xlsx（3581×31）
CREATE TABLE IF NOT EXISTS raw_scheduled_course (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL,
  province TEXT,
  branch_company TEXT,                 -- 分公司
  learning_center TEXT,
  course_id TEXT,
  class_date TEXT,                     -- 上课日期
  class_time TEXT,                     -- 上课时间
  mentor_name TEXT,
  mentor_no TEXT,
  teacher_name TEXT,
  teacher_employment_type TEXT,        -- 老师用工类型
  teacher_no TEXT,
  student_name TEXT,
  student_id TEXT,
  is_new_student TEXT,                 -- 是否新签学生
  grade TEXT,
  subject_group TEXT,
  subject TEXT,
  scheduled_hours REAL,                -- 预排小时
  actual_hours REAL,                   -- 实际小时
  course_status TEXT,                  -- 课程状态
  student_charge_status TEXT,          -- 学生扣费状态
  student_attendance_status TEXT,      -- 学生考勤状态
  course_tag TEXT,                     -- 课程标签
  product_name TEXT,                   -- 产品名称
  course_nature TEXT,                  -- 课程性质
  teacher_attendance_time TEXT,
  mentor_review_time TEXT,
  charge_time TEXT,
  product_type TEXT,                   -- 产品类型
  one_to_many_type TEXT,
  charge_coefficient REAL,             -- 扣费系数
  extra TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  FOREIGN KEY (batch_id) REFERENCES upload_batch(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_raw_scheduled_batch ON raw_scheduled_course(batch_id);
CREATE INDEX IF NOT EXISTS idx_raw_scheduled_student ON raw_scheduled_course(student_id);
CREATE INDEX IF NOT EXISTS idx_raw_scheduled_teacher ON raw_scheduled_course(teacher_no);
CREATE INDEX IF NOT EXISTS idx_raw_scheduled_date ON raw_scheduled_course(class_date);
CREATE INDEX IF NOT EXISTS idx_raw_scheduled_student_subject ON raw_scheduled_course(student_id, subject);

-- ============ 定金券使用报表 ============
-- 源：定金券使用报表.xlsx（~200 行）
-- 注意：关联学生ID/关联学生 是逗号分隔的多值，需要拆到 voucher_student_link
CREATE TABLE IF NOT EXISTS raw_voucher (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL,
  voucher_no TEXT,                     -- 若源文件有券号（目前没有，预留）
  branch_company TEXT,                 -- 分公司
  campus TEXT,                         -- 校区
  builder_name TEXT,                   -- 建券员工
  amount REAL,                         -- 金额
  customer_phone_masked TEXT,          -- 客户手机号（已脱敏，保留原样）
  voucher_created_at TEXT,             -- 建券时间（业务字段）
  usage_status TEXT,                   -- 使用状态：正常 / 已使用 / 已取消
  used_or_refunded_at TEXT,            -- 使用/退费时间
  contract_no TEXT,                    -- 关联合同编号
  payment_status TEXT,                 -- 支付状态：已支付 / 未支付
  intent_grade TEXT,                   -- 意向使用年级
  remark TEXT,                         -- 备注
  extra TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  FOREIGN KEY (batch_id) REFERENCES upload_batch(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_raw_voucher_batch ON raw_voucher(batch_id);
CREATE INDEX IF NOT EXISTS idx_raw_voucher_contract ON raw_voucher(contract_no);
CREATE INDEX IF NOT EXISTS idx_raw_voucher_builder ON raw_voucher(builder_name);
CREATE INDEX IF NOT EXISTS idx_raw_voucher_created ON raw_voucher(created_at);

-- 个人业绩统计：每行 = 合同 × 产品类型 业绩分配
-- 源文件是三层合并表头（个人业绩/直播合作业绩/总业绩），入库时拍平为独立列。
CREATE TABLE IF NOT EXISTS raw_personal_perf (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL,
  group_name TEXT,                       -- 集团
  branch_company TEXT,                   -- 分公司
  learning_center TEXT,                  -- 学习中心
  performer TEXT,                        -- 业绩人员（原字段含工号括号，原样保存）
  performer_no TEXT,                     -- 括号里的工号（如 X49763），拆出来便于关联
  department TEXT,                       -- 归属部门
  perf_source TEXT,                      -- 业绩来源
  operator TEXT,                         -- 签单人/操作人
  contract_grade TEXT,                   -- 合同年级
  student_name TEXT,                     -- 学生姓名
  contract_type TEXT,                    -- 合同类型：新签合同 / 续费合同
  product_type TEXT,                     -- 产品类型：一对一 / 小班 / ...
  -- 个人业绩
  perf_new_sign REAL,                    -- 新签合同业绩
  perf_renew REAL,                       -- 续费合同业绩
  perf_received REAL,                    -- 收款业绩
  perf_refund REAL,                      -- 退费责任业绩
  perf_total REAL,                       -- 个人总业绩
  -- 直播合作业绩
  live_new_sign REAL,                    -- 新签业绩
  live_renew REAL,                       -- 续费业绩
  live_new_refund REAL,                  -- 新签退费责任业绩
  live_renew_refund REAL,                -- 续费退费责任业绩
  live_total REAL,                       -- 合作总业绩
  -- 总业绩
  grand_received REAL,                   -- 总收款业绩
  grand_refund REAL,                     -- 总退费责任
  grand_total REAL,                      -- 总业绩
  source_row INTEGER,                    -- 源文件行号（排查用）
  extra TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  FOREIGN KEY (batch_id) REFERENCES upload_batch(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_raw_personal_perf_batch ON raw_personal_perf(batch_id);
CREATE INDEX IF NOT EXISTS idx_raw_personal_perf_performer ON raw_personal_perf(performer_no);
CREATE INDEX IF NOT EXISTS idx_raw_personal_perf_center ON raw_personal_perf(learning_center);
CREATE INDEX IF NOT EXISTS idx_raw_personal_perf_contract_grade ON raw_personal_perf(contract_grade);

-- 定金券 ↔ 学生 关联表（多对多，一行定金券可关联多个学生/线索）
CREATE TABLE IF NOT EXISTS voucher_student_link (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  voucher_id INTEGER NOT NULL,
  student_id TEXT,                     -- STU 开头，可能为 NULL（线索）
  student_name TEXT,
  student_grade TEXT,
  link_kind TEXT NOT NULL,             -- real / parent_lead / student_lead / unknown / empty
  position INTEGER NOT NULL,           -- 在原单元格中的位置（从 1 起）
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  FOREIGN KEY (voucher_id) REFERENCES raw_voucher(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_voucher_student_link_voucher ON voucher_student_link(voucher_id);
CREATE INDEX IF NOT EXISTS idx_voucher_student_link_student ON voucher_student_link(student_id);

-- ============ 人工维护的真值表 ============
-- 源：Excel 主表里的"老师学生" / "学管学生"，由用户手动维护
-- 注意：预存标记（is_prepaid）由系统从定金券自动算出，人工可覆盖

-- 老师 ↔ 学生 映射（含预存标记）
CREATE TABLE IF NOT EXISTS teacher_student_map (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_no TEXT NOT NULL,
  teacher_name TEXT,
  student_id TEXT NOT NULL,
  student_name TEXT,
  is_prepaid INTEGER NOT NULL DEFAULT 0,     -- 系统从定金券计算，可人工覆盖
  prepaid_overridden INTEGER NOT NULL DEFAULT 0,  -- 人工是否覆盖过
  grade TEXT,
  note TEXT,
  updated_by INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  UNIQUE(teacher_no, student_id)
);
CREATE INDEX IF NOT EXISTS idx_teacher_student_teacher ON teacher_student_map(teacher_no);
CREATE INDEX IF NOT EXISTS idx_teacher_student_student ON teacher_student_map(student_id);

-- 学管 ↔ 学生 映射
CREATE TABLE IF NOT EXISTS mentor_student_map (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mentor_no TEXT NOT NULL,
  mentor_name TEXT,
  student_id TEXT NOT NULL,
  student_name TEXT,
  grade TEXT,
  note TEXT,
  updated_by INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  UNIQUE(mentor_no, student_id)
);
CREATE INDEX IF NOT EXISTS idx_mentor_student_mentor ON mentor_student_map(mentor_no);
CREATE INDEX IF NOT EXISTS idx_mentor_student_student ON mentor_student_map(student_id);

-- ============ 配置/例外/激励 ============

-- 指标例外：替代 Excel 里的硬编码（罗卢熙那种）
CREATE TABLE IF NOT EXISTS indicator_overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL,                 -- student / teacher / mentor / subject_group / learning_center
  key_type TEXT NOT NULL,              -- student_id / teacher_no / mentor_no / ...
  key_value TEXT NOT NULL,             -- 实际键值
  indicator TEXT NOT NULL,             -- xusheng / xuke / prepaid / close_ratio / ...
  override_value TEXT NOT NULL,        -- 'no' / 'yes' / 'exclude' / 'include' / 数值字符串
  reason TEXT,
  effective_from TEXT,                 -- 生效起始（含）
  effective_to TEXT,                   -- 生效结束（含），NULL=永久
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  updated_by INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
);
CREATE INDEX IF NOT EXISTS idx_indicator_overrides_lookup
  ON indicator_overrides(scope, key_type, key_value, indicator);

-- 续生激励设置：目标比例（分公司/科组/学段可分别设）
CREATE TABLE IF NOT EXISTS incentive_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL,                 -- branch / subject_group / grade_stage / learning_center
  scope_value TEXT NOT NULL,           -- 如 '中山分公司' / '数学组' / '高三' / '小榄龙山学习中心'
  target_rate REAL NOT NULL,           -- 0.0 ~ 1.0，例如 0.80
  effective_from TEXT NOT NULL,        -- YYYY-MM-DD
  effective_to TEXT,                   -- NULL = 永久
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  updated_by INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
);
CREATE INDEX IF NOT EXISTS idx_incentive_settings_lookup
  ON incentive_settings(scope, scope_value, effective_from);

-- 产品匹配规则：替代 Excel 里 "*"&课消产品&"*" 的子串匹配
CREATE TABLE IF NOT EXISTS product_match_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_category TEXT NOT NULL,       -- 课消产品类别
  match_mode TEXT NOT NULL DEFAULT 'contains',  -- contains / exact / prefix / suffix / regex
  enabled INTEGER NOT NULL DEFAULT 1,
  note TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
);
CREATE INDEX IF NOT EXISTS idx_product_match_rules_cat ON product_match_rules(course_category);
`;
  biDb.exec(sql);
  log.info('bi.db 表结构初始化完成');
}
