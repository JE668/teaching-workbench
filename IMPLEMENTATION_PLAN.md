# 14 个优化方向完整实施规划

> **背景**：用户要求对课后回访、月度总结规划两大核心模块进行全方位升级优化。已完成代码全链路探查（后端 routes + AI services + 前端页面 + 数据库 schema + 共享 prompt 模板），确认 14 个优化方向。

---

## 整体分阶段路线图（共 6 阶段，预估 13-15 周）

| 阶段 | 周数 | 主题 | 包含任务 | 关键产出 |
|------|------|------|----------|----------|
| Phase 1 | 1-2 | 数据结构化 + 多模态融合 | task-1, task-3 | followups 表 5 结构化字段、JSON Schema 输出、图片直传模型、板块级渲染 |
| Phase 2 | 3-4 | AI 基础设施加固 | task-5, task-6 | 优先级队列、断点续传、流式中断恢复 |
| Phase 3 | 5-7 | 知识资产化 | task-2, task-4 | 知识图谱表、错因标签体系、阶测自动分析 |
| Phase 4 | 8-9 | 协作与版本基建 | task-7, task-9 | 统一草稿协议、双向引用、变更通知 |
| Phase 5 | 10-12 | 差异化功能起步 | task-8, task-10 | 自定义 Excel 模板、学生画像自动构建 |
| Phase 6 | 13+ | 组织级/生态护城河 | task-11, task-12, task-13, task-14 | 教研组知识库、家长端、AI 备课、教学复盘仪表盘 |

---

## 14 个任务详细拆解

### task-1: 回访结构化入库（高价值·快落地）
**目标**：把 AI 产出的 5 板块拆成独立字段落库，支撑板块级历史建议/分析/导出
**涉及文件**：
- server/src/migrations/20240101000000_initial_schema.ts → 新增 migration 20250115000001_followup_structured_fields.ts
- server/src/routes/followups.ai.ts → 改用 response_format: { type: 'json_schema', json_schema: {...} }
- server/src/services/ai/prompt.ts → 新增 buildStructuredPrompt 返回 JSON Schema
- server/src/routes/followups.read.ts → 新增 /followups/:id/blocks 端点
- server/src/routes/followups.write.ts → 存储结构化字段 + 保留 content 兼容
- web/src/types/index.ts → FollowUp 接口加 blocks?: FollowUpBlock[]
- web/src/pages/FollowUp.tsx → 编辑态/预览态按板块渲染、板块级编辑、板块级历史建议

**数据库变更**：
ALTER TABLE followups ADD COLUMN knowledge_gain TEXT DEFAULT '';
ALTER TABLE followups ADD COLUMN class_performance TEXT DEFAULT '';
ALTER TABLE followups ADD COLUMN homework_assign TEXT DEFAULT '';
ALTER TABLE followups ADD COLUMN next_plan TEXT DEFAULT '';
ALTER TABLE followups ADD COLUMN teacher_remark TEXT DEFAULT '';
-- 保留 content 作为全文兼容，blocks JSON 冗余存储供前端直读
ALTER TABLE followups ADD COLUMN blocks TEXT DEFAULT '[]';

**JSON Schema 示例**：
{
  "type": "object",
  "properties": {
    "knowledge_gain": { "type": "string", "description": "学生收获/掌握情况" },
    "class_performance": { "type": "string", "description": "课堂表现/互动情况" },
    "homework_assign": { "type": "string", "description": "作业布置/完成要求" },
    "next_plan": { "type": "string", "description": "下步教学计划/重点" },
    "teacher_remark": { "type": "string", "description": "教师综合评价/建议" }
  },
  "required": ["knowledge_gain", "class_performance", "homework_assign", "next_plan", "teacher_remark"],
  "additionalProperties": false
}

**验收**：生成的回访可在前端按 5 卡片展开/折叠编辑；历史建议接口按板块返回；存库字段非空。

---

### task-3: 多模态融合（高价值·快落地）
**目标**：图片 Base64 直传模型 + 结构化观察 JSON 输出，替代 OCR+文本拼接
**涉及文件**：
- server/src/services/ai/prompt.ts → buildMultimodalPrompt(params)：system prompt 引导模型输出 {observations: [{type, detail, evidence_image_index}]}
- server/src/services/ai/index.ts → buildUserContent 已支持 image_url，只需把 OCR 文本降级为辅助参考
- server/src/routes/followups.ai.ts → /generate /generate/stream 复用新 prompt
- web/src/pages/FollowUp.tsx → 图片上传后预览区显示 AI 观察到的细节 可编辑确认

**Prompt 关键变更**：
你是一位专业的1对1教育咨询师。请先仔细观察所有上传图片，识别：
1. 题目类型（计算/应用题/阅读/写作/实验等）
2. 学生的作答情况（步骤/最终答案/书写规范）
3. 出错位置与错因（概念/计算/审题/粗心/格式）
4. 老师批改痕迹（红笔标记/打分/评语）
5. 板书/笔记/草稿纸的关键信息

输出 JSON：
{
  "observations": [
    {"type": "question_type", "detail": "第3题为分数应用题，涉及通分、单位换算", "evidence_image_index": 0},
    {"type": "mistake", "detail": "通分时漏乘分子，导致结果错误", "evidence_image_index": 0},
    {"type": "teacher_mark", "detail": "红笔圈出第3步，写'漏乘分子'-2分", "evidence_image_index": 0},
    {"type": "handwriting", "detail": "书写工整，步骤清晰", "evidence_image_index": 1}
  ]
}

**验收**：上传作业图 → 生成回访时自动嵌入 观察到的细节 → 老师可删改确认 → 最终回访内容更具体（如 第3题通分漏乘分子 而非 看图有进步）。

---

### task-5: AI 优先级队列（中价值·架构完善）
**目标**：解决后台批量任务挤占交互式生成槽位问题
**涉及文件**：
- server/src/services/ai/index.ts → 重构 acquireAiSlot/releaseAiSlot/withAiSlot
- 新增 AiTaskPriority = 'interactive' | 'batch' | 'background'
- 新增 PriorityQueue 类：高优可抢占低优、低优自动背压分批
- 暴露指标：ai_queue_depth{priority}、ai_slot_usage{user,priority} → /metrics

**核心逻辑**：
interface QueuedTask {
  priority: AiTaskPriority;
  userId: number;
  resolve: () => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
  enqueuedAt: number;
}

// 抢占规则：interactive 到来时，若全局满且有 batch/background 在跑，
// 标记最旧的低优任务为 preempted，其 finally 中释放槽位后不再重试
// batch 任务自动分批：单次最多占 2 个槽位，完成一批释放再排队

**验收**：并发 20 个 batch 任务 + 5 个 interactive 请求时，interactive 平均等待 < 500ms；Grafana 告警 ai_queue_depth{batch}>10 持续 1 分钟触发。

---

### task-6: 流式断点续传（中价值·架构完善）
**目标**：SSE 断开不丢内容，支持 Last-Event-ID 补发
**涉及文件**：
- server/src/routes/followups.ai.ts → /generate/stream 写入 ai_stream_chunks(stream_id, seq, delta, phase)
- 新建表 ai_stream_chunks(stream_id TEXT, seq INTEGER, delta TEXT, phase TEXT, created_at)
- 前端 EventSource 重连带 Last-Event-ID → 后端查缺口补发
- server/src/services/ai/index.ts → streamOnce 合并外部 AbortSignal + 内部 watchdog

**数据库新表**：
CREATE TABLE IF NOT EXISTS ai_stream_chunks (
  stream_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  delta TEXT NOT NULL,
  phase TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  PRIMARY KEY (stream_id, seq)
);
CREATE INDEX idx_ai_stream_chunks_stream ON ai_stream_chunks(stream_id);

**验收**：模拟网络断开 10s 后重连，前端无感补全缺失文本，无重复、无乱序。

---

### task-2: 跨月知识图谱（高价值·快落地）
**目标**：抽取知识点/考点/错因实体，建立 student → knowledge_point → mastery 三元组
**涉及文件**：
- 新建 migration 20250115000002_knowledge_graph.ts
- server/src/services/knowledge/graph.ts → extractKnowledgePoints(text, images[])
- server/src/routes/reports.ai.ts → 月报生成时并行调用抽取，写入 report_knowledge_points
- server/src/routes/reports.read.ts → 新增 /reports/knowledge-radar/:studentId 端点
- web/src/pages/ReportEdit.tsx → 新增 知识雷达 Tab：雷达图 + 薄弱点 Top 5 + 推荐补缺题目

**数据库新表**：
CREATE TABLE IF NOT EXISTS knowledge_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  subject TEXT NOT NULL,
  grade TEXT NOT NULL,
  point_name TEXT NOT NULL,           -- 如 分数通分, 一元一次方程求解
  point_category TEXT NOT NULL,       -- concept/skill/method/habit
  mastery_level REAL DEFAULT 0,       -- 0-1 动态更新
  evidence_count INTEGER DEFAULT 0,   -- 命中次数
  last_seen_at TEXT,
  created_at TEXT DEFAULT (datetime('now', '+8 hours')),
  UNIQUE(user_id, student_id, subject, point_name)
);

CREATE TABLE IF NOT EXISTS report_knowledge_points (
  report_id INTEGER NOT NULL,
  point_id INTEGER NOT NULL,
  delta REAL NOT NULL,                -- 本月该知识点 mastery 变化量
  evidence TEXT,                      -- 引用的原文片段
  PRIMARY KEY (report_id, point_id)
);

**验收**：某生本学期 10 份月报 → 知识雷达图显示 8 个维度 mastery 变化曲线；薄弱点 Top 5 准确对应错因高频知识点；下月规划推荐的 精准补缺题目 命中率 > 70%（人工抽样）。

---

### task-4: 阶测错因分析（高价值·快落地）
**目标**：失分题目 + 作答图片 → 批量产出错因标签 + 个性化复习微计划
**涉及文件**：
- 新建 migration 20250115000003_exam_analysis.ts
- server/src/services/ai/examAnalysis.ts → analyzeExamImages(studentId, examId, images[])
- server/src/routes/reports.ai.ts → 新增 generateExamAnalysis 调用
- web/src/pages/ReportEdit.tsx → 阶测分析 区块新增 错因分布饼图 复习微计划 全班重点复习清单

**错因标签体系**：
| 一级 | 二级示例 |
|------|----------|
| 概念不清 | 定义记错、性质混淆、公式套用错误 |
| 技巧缺失 | 解题路径不熟、辅助线不会加、换元思维不到 |
| 审题失误 | 条件漏读、单位未换、问法理解偏 |
| 计算粗心 | 抄写错、符号漏、运算失误 |
| 表达不规范 | 步骤跳跃、格式不符、单位缺失 |
| 时间管理 | 易题超时、难题不放、卷面分配失衡 |

**数据库新表**：
CREATE TABLE IF NOT EXISTS exam_analysis_details (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  exam_id INTEGER NOT NULL,
  question_index INTEGER NOT NULL,
  question_type TEXT,
  mistake_tags TEXT NOT NULL,       -- JSON: ["概念不清:定义记错", "计算粗心:符号漏"]
  root_cause TEXT,                  -- 核心错因一句话
  review_actions TEXT NOT NULL,     -- JSON: ["重做同类题3道", "背诵定义5遍", "纠错本记录"]
  confidence REAL DEFAULT 0.8,
  created_at TEXT DEFAULT (datetime('now', '+8 hours'))
);

**验收**：上传 5 名学生的期中试卷图片 → 30 秒内输出全班错因分布饼图 + 每生 3-5 条可执行复习动作；老师确认准确率 > 85%。

---

### task-7: 统一草稿版本管理（中价值·架构完善）
**目标**：回访/月报/听评课共用一套草稿协议，支持分支/合并/冲突检测
**涉及文件**：
- 新建 migration 20250115000004_unified_drafts.ts
- server/src/services/drafts/unifiedDrafts.ts → 通用 CRUD + 版本图
- server/src/routes/followups.write.ts / reports.ts / observations.ts → 迁移到统一接口
- web/src/hooks/useDraftHistory.ts → 统一 Hook：useDraftHistory(entityType, entityId)
- web/src/pages/FollowUp.tsx / ReportEdit.tsx / ObservationEdit.tsx → 共用 草稿历史面板

**数据库新表（替换现有 drafts/observation_drafts/draft_history）**：
CREATE TABLE IF NOT EXISTS unified_drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  entity_type TEXT NOT NULL,        -- followup | report | observation
  entity_id INTEGER,                -- 实体 ID（新建时为 null）
  version INTEGER NOT NULL DEFAULT 1,
  content_json TEXT NOT NULL,       -- 完整表单快照
  base_version INTEGER,             -- 基于哪个版本 fork
  fork_from INTEGER,                -- fork 来源 draft id
  is_branch BOOLEAN DEFAULT 0,
  label TEXT,                       -- 用户自定义标签如 给家长版
  created_at TEXT DEFAULT (datetime('now', '+8 hours')),
  updated_at TEXT DEFAULT (datetime('now', '+8 hours'))
);

CREATE INDEX idx_unified_drafts_entity ON unified_drafts(entity_type, entity_id);

**验收**：在回访页从 v3 fork 出分支 精简版给家长，月报页从 v5 fork 出 教研组汇报版；三方合并预览正确高亮冲突字段；历史记录不丢、不重复。

---

### task-9: 双向引用 + 变更通知（中价值·架构完善）
**目标**：观察记录修改 → 月报标记 有更新；回访引用观察记录 → 观察记录显示 被引用处
**涉及文件**：
- 新建 migration 20250115000005_content_references.ts
- server/src/services/content/references.ts → 建立/查询/通知
- server/src/routes/reports.write.ts / followups.write.ts / observations.write.ts → 保存时同步引用
- web/src/components/ReferencePanel.tsx → 通用引用面板组件
- web/src/pages/ReportEdit.tsx / FollowUp.tsx / ObservationEdit.tsx → 集成引用面板

**数据库新表**：
CREATE TABLE IF NOT EXISTS content_references (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type TEXT NOT NULL,        -- observation | followup | report
  source_id INTEGER NOT NULL,
  target_type TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  ref_role TEXT NOT NULL,           -- cites | derives_from | supplements
  created_at TEXT DEFAULT (datetime('now', '+8 hours')),
  UNIQUE(source_type, source_id, target_type, target_id, ref_role)
);

CREATE TABLE IF NOT EXISTS content_change_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  changed_fields TEXT NOT NULL,     -- JSON: ["report", "plan"]
  version INTEGER NOT NULL,
  notified BOOLEAN DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now', '+8 hours'))
);

**验收**：修改观察记录 → 关联月报顶部出现 引用的观察记录已更新，点击同步；点击同步后月报对应区块自动替换为最新内容；反向在观察记录页可见 被引用：张三 10 月月报·总结区。

---

### task-8: 自定义 Excel 模板（中价值·架构完善）
**目标**：老师上传 .xlsx 模板 → 标注字段映射 → 一键套用，保留条件格式/数据验证/透视表
**涉及文件**：
- 新建 migration 20250115000006_excel_templates.ts
- server/src/services/excel/templateEngine.ts → 解析模板、字段映射、数据填充
- server/src/routes/reports.ts → /reports/:id/export/excel 支持 template_id 参数
- web/src/pages/ReportEdit.tsx → 导出设置 抽屉：上传模板 → 可视化映射器（单元格点击选字段） → 保存模板 → 导出时选模板

**数据库新表**：
CREATE TABLE IF NOT EXISTS excel_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  file_blob BLOB NOT NULL,          -- 原始 .xlsx 二进制
  field_mappings TEXT NOT NULL,     -- JSON: {"A1": "student.name", "B2:B10": "loop:class_rows->student.name"}
  sheet_name TEXT DEFAULT 'Sheet1',
  created_at TEXT DEFAULT (datetime('now', '+8 hours')),
  updated_at TEXT DEFAULT (datetime('now', '+8 hours'))
);

**映射语法示例**：
{
  "A1": "report.student_name",
  "B1": "report.year_month",
  "A3": "loop:report_items[kind=summary]->content",
  "B3": "loop:report_items[kind=summary]->type",
  "C3": "loop:report_items[kind=summary]->score",
  "A20": "report.farewell"
}

**验收**：老师上传自己维护的 .xlsx → 点击单元格选字段 → 保存 → 导出月报完全套用其模板（列宽/颜色/公式/透视表/数据验证全保留）。

---

### task-10: 学生画像自动构建（高天花板·差异化）
**目标**：聚合多模态长时序数据 → LLM 抽取 StudentProfile → 注入后续生成
**涉及文件**：
- 新建 migration 20250115000007_student_profiles.ts
- server/src/services/ai/studentProfile.ts → buildStudentProfile(studentId) 离线批量任务
- server/src/routes/followups.ai.ts / reports.ai.ts → 生成时注入 profile 到 system prompt
- web/src/pages/StudentProfile.tsx → 新页：画像可视化 + 老师可微调确认

**画像结构**：
interface StudentProfile {
  learning_style: 'visual' | 'auditory' | 'kinesthetic' | 'reading_writing';
  weak_points: string[];           // 如 ["分数运算", "应用题建模"]
  strong_points: string[];         // 如 ["几何直观", "逻辑推理"]
  motivation_drivers: string[];    // 如 ["竞赛排名", "老师表扬", "父母奖励"]
  pacing_preference: 'fast' | 'steady' | 'slow_deep';
  communication_style: 'concise' | 'detailed' | 'encouraging' | 'strict';
  attention_span_minutes: number;
  homework_compliance: 'high' | 'medium' | 'low';
  parental_involvement: 'high' | 'medium' | 'low';
  updated_at: string;
  confidence: number;              // 0-1
}

**数据库新表**：
CREATE TABLE IF NOT EXISTS student_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL UNIQUE,
  profile_json TEXT NOT NULL,
  source_summary TEXT,             -- 数据来源摘要：如 基于 23 条回访、5 份月报、12 张错题图
  confidence REAL DEFAULT 0,
  generated_at TEXT DEFAULT (datetime('now', '+8 hours')),
  confirmed_by_teacher BOOLEAN DEFAULT 0,
  teacher_notes TEXT
);

**验收**：某生积累 3 个月数据 → 离线跑一次画像 → 后续回访生成自动适配其 learning_style（如视觉型多用 看图可知、图表类比）；老师确认画像准确率 > 80%。

---

### task-11: 教研组知识库（高天花板·差异化）
**目标**：同教研组老师的回访/月报/观察记录 → 向量化检索 → 组织级资产复用
**涉及文件**：
- 新建 migration 20250115000008_group_knowledge.ts
- server/src/services/knowledge/vectorStore.ts → pgvector/Milvus 封装
- server/src/services/knowledge/indexer.ts → 定期增量索引（按 subject_group 分库）
- server/src/routes/knowledge.ts → 新路由：/knowledge/search /knowledge/similar-students /knowledge/weekly-digest
- web/src/pages/KnowledgeBase.tsx → 教研组知识库页：语义搜索/相似学生/高分范例/周报生成

**数据库新表**：
CREATE TABLE IF NOT EXISTS group_knowledge_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  subject_group TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id INTEGER NOT NULL,
  chunk_text TEXT NOT NULL,
  embedding BLOB,                   -- pgvector 存储或外部向量库 ID
  metadata_json TEXT,               -- {student_name, grade, topic, tags}
  indexed_at TEXT DEFAULT (datetime('now', '+8 hours'))
);
CREATE INDEX idx_gkc_group ON group_knowledge_chunks(subject_group);

**验收**：教研组 5 位老师积累 500+ 文档 → 搜索 分数通分教学话术 返回 10 条高分回访片段；相似学生画像检索 找到 3 个相似学情的历史案例；教研组周报一键生成（各老师本周重点/难点/建议汇总）。

---

### task-12: 家长端只读视图 + 智能摘要推送（高天花板·差异化）
**目标**：生成结构化 家长版单页 → 微信模板消息/小程序卡片推送 → 家长可 确认阅读/我有疑问
**涉及文件**：
- 新建 migration 20250115000009_parent_view.ts
- server/src/services/ai/parentSummary.ts → generateParentView(followupId|reportId)
- server/src/routes/followups.read.ts / reports.read.ts → /followups/:id/parent-view /reports/:id/parent-view
- server/src/services/notify/wechat.ts → 模板消息/订阅消息发送
- web/src/pages/ParentView.tsx → 家长端单页（无需登录，token 访问）

**家长版结构**：
{
  "key_progress": ["第3题通分漏乘分子→已纠正", "几何直观强，辅助线主动添加", "作业书写规范度提升"],
  "focus_areas": ["应用题建模仍需练习", "考试时间分配不均"],
  "action_for_parent": "本周请监督完成《分数专项练习》P12-15，周五前拍照发群",
  "teacher_note": "小明本周专注度明显提升，继续鼓励！"
}

**数据库新表**：
CREATE TABLE IF NOT EXISTS parent_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type TEXT NOT NULL,        -- followup | report
  source_id INTEGER NOT NULL,
  view_json TEXT NOT NULL,
  access_token TEXT NOT NULL UNIQUE, -- 家长访问凭证
  expires_at TEXT,
  read_at TEXT,
  parent_feedback TEXT,             -- 我有疑问 回写内容
  created_at TEXT DEFAULT (datetime('now', '+8 hours'))
);

**验收**：老师点击 推送给家长 → 微信收到卡片消息 → 点开即看结构化摘要 → 点 确认阅读 / 我有疑问 → 老师端实时收到反馈；家长阅读率统计 > 60%。

---

### task-13: AI 备课助手（高天花板·差异化）
**目标**：月报规划 → 自动生成下周教案草案（目标/重难点/活动/分层作业/预设提问/板书）
**涉及文件**：
- 新建 migration 20250115000010_lesson_plans.ts
- server/src/services/ai/lessonPlanner.ts → generateWeeklyPlans(monthlyPlanItems, studentProfiles, textbookChapters, historicalPlans)
- server/src/routes/reports.ai.ts → 新增 /reports/:id/generate-lesson-plans
- web/src/pages/LessonPlanner.tsx → 教案编辑页：周视图/日视图、分层作业拖拽、板书预览

**教案结构**：
interface WeeklyLessonPlan {
  week_start: string;
  lessons: DailyLesson[];
}
interface DailyLesson {
  date: string;
  objectives: string[];              // 教学目标
  key_points: string[];              // 重点
  difficult_points: string[];        // 难点
  activities: Activity[];            // 教学活动设计
  tiered_homework: {                 // 分层作业
    basic: string[];
    advanced: string[];
    optional: string[];
  };
  preset_questions: string[];        // 预设提问
  board_design: string;              // 板书设计（文本描述）
  estimated_minutes: number;
}

**数据库新表**：
CREATE TABLE IF NOT EXISTS lesson_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  report_id INTEGER NOT NULL,       -- 来源月报
  week_start TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  status TEXT DEFAULT 'draft',      -- draft | confirmed | archived
  confirmed_at TEXT,
  created_at TEXT DEFAULT (datetime('now', '+8 hours')),
  updated_at TEXT DEFAULT (datetime('now', '+8 hours'))
);

**验收**：输入 10 月月报规划 + 5 学生画像 + 教材目录 → 输出 4 周教案草案；老师二次编辑确认后入库；同教研组可 克隆并调整。

---

### task-14: 教学复盘仪表盘（高天花板·差异化）
**目标**：量化教学质量视图（学生成长轨迹/班级对标/回访质量/AI 采纳指标）
**涉及文件**：
- server/src/routes/analytics.ts → 新增聚合查询：getTeachingAnalytics(userId, filters)
- web/src/pages/TeachingAnalyticsDashboard.tsx → 新页面：4 大板块可视化
- 复用 RenewalDashboard 的图表组件 + 新增雷达图/热力图/漏斗图

**4 大板块指标**：
| 板块 | 核心指标 | 图表形式 |
|------|----------|----------|
| 学生成长轨迹 | 知识/习惯/态度/技能 4 维雷达图、月度 mastery 变化曲线 | 雷达图 + 折线图 |
| 班级/教研组对标 | 同阶段横向对比：平均 mastery、进步率、作业完成率 | 分组柱状图 + 百分位线 |
| 回访质量 | 字数/结构化率/图片占比/历史引用率/家长阅读率/AI 采纳率/修改幅度/重试率 | 仪表盘 + 趋势线 |
| AI 生成效能 | 采纳率、平均修改字数、重试率、字数达标率、流式中断率 | 漏斗图 + 散点图 |

**验收**：教学主管打开仪表盘 → 一眼看到全组教学质量健康度；点击某班级 → 下钻到学生/老师/知识点三维；AI 指标反哺 prompt 优化（如重试率高 → 调宽字数区间/改 prompt）。

---

## 任务依赖图

task-1 结构化入库 → task-2 知识图谱
task-3 多模态融合 → task-2
task-3 多模态融合 → task-4 阶测错因
task-1 结构化入库 → task-7 统一草稿
task-5 优先级队列 → task-6 断点续传
task-2 知识图谱 → task-10 学生画像
task-4 阶测错因 → task-10 学生画像
task-7 统一草稿 → task-9 双向引用
task-8 自定义模板 -.-> task-14 仪表盘
task-10 学生画像 → task-11 教研组知识库
task-10 学生画像 → task-12 家长端
task-10 学生画像 → task-13 AI备课
task-2 知识图谱 → task-14 仪表盘
task-10 学生画像 → task-14 仪表盘
task-5 优先级队列 -.-> task-14 仪表盘

---

## 通用技术规范（所有任务遵守）

1. 数据库迁移：每任务独立 migration 文件，版本号 YYYYMMDDNNNNNN_kebab_case.ts，up/down 完整可回滚
2. 类型安全：共享类型放 shared/types/，前后端 npm run typecheck 必须通过
3. 测试覆盖：核心逻辑（prompt 构建、JSON 解析、队列调度、向量检索）单测 >= 80%；E2E 覆盖主流程
4. 观测性：新增端点必打 ai_metrics/api_latency/queue_depth；关键路径有 Sentry breadcrumb
5. 向后兼容：老数据字段保留，新字段默认空；前端对缺失字段优雅降级
6. 文档同步：每任务完成更新 docs/architecture/*.md + CHANGELOG.md

---

## 启动建议

**本周即刻开工**：
1. 创建 task-1 分支 feat/followup-structured，先跑 migration + JSON Schema 生成
2. 并行创建 task-3 分支 feat/multimodal-fusion，改 buildMultimodalPrompt + 前端观察预览
3. 两分支各自 PR → review → merge main → 触发 CI/CD

**下周并行**：
- task-5 优先级队列（后端单测可独立跑，不阻塞前端）
- task-2 知识图谱表建表 + 抽取服务骨架

**风险缓冲**：
- JSON Schema 在某些模型（如 gemini-proxy）不支持 → 降级为 结构化文本 + 正则解析 兜底
- 向量检索依赖 pgvector 扩展 → NAS 部署需确认 SQLite 支持或改用外部 Milvus
- 家长端微信推送需服务号模板消息审核 → 提前准备备案素材

---

## 交付清单（每任务完成必须产出）

| 产出 | 说明 |
|------|------|
| Migration 文件 | server/src/migrations/YYYYMMDDNNNNNN_*.ts |
| 后端路由/服务 | 对应 routes/ services/ 新增/修改文件 |
| 前端页面/组件 | web/src/pages/ components/ 新增/修改文件 |
| 共享类型 | shared/types/ 更新 |
| 单测 | __tests__/ 对应文件 |
| E2E 用例 | web/e2e/ 关键流程 |
| 文档更新 | docs/architecture/ + CHANGELOG.md |
| 部署验证 | staging 环境冒烟测试通过截图 |

---

下一步：确认启动 task-1 + task-3 并行开发？我可直接在代码库中创建分支、编写 migration、实现核心逻辑、跑通类型检查与单测。