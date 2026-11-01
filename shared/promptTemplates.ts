/**
 * AI Prompt 模板常量 —— 前后端共享
 * 
 * 包含：
 * - COMMON_RULES：1对1 + 家长视角的公共红线（回访 / 月度总结 / 课程规划 通用）
 * - MODULE_GUIDANCE：回访板块的写法指引（16 种模块）
 * - REPORT_PROMPT_VERSION：模板版本号，生成时记入数据库便于回放
 */

export type FollowUpModule = 
  | 'class_content' | 'homework_review' | 'class_performance' | 'notes_trace'
  | 'quiz_test' | 'preview' | 'review_consolidation' | 'learning_method'
  | 'focus_habits' | 'emotional_state' | 'parent_communication' | 'special_events'
  | 'knowledge_gaps' | 'next_week_focus' | 'custom_topic';

// ============ 版本号 ============
// 修改任何模板内容后，必须递增此版本号
export const REPORT_PROMPT_VERSION = '2025.10.31.0';

// ============ 公共硬性要求 ============
// 回访、月度总结、课程规划三类任务共用
export const COMMON_RULES = [
  '2. 只有一对一教学。严禁出现「小组讨论」「小组合作」「同学们」「多名学生」「全班」等集体表述。',
  '3. 不要出现学生的全名，也不要出现别的学生。',
  '4. 只写上面给到的内容。不要编造具体分数、考试排名、名次变化、课堂纪律细节，' +
    '没有回访记录时收获和不足就只依据课程内容清单来写。',
  '5. 收获和进步要落到具体课程内容上，不足要写成家长可以配合的动作，不要情绪化、不要指责孩子。',
  '6. 直接输出正文，不要前言、不要「以下是」这类话，不要重复段落小标题以外的任何说明。',
] as const;

// ============ 回访板块写法指引 ============
//
// 回访内容本质是向家长展示教学服务流程，一次回访要覆盖多个流程环节。
// 现在共 16 种（常规类 9 + 非常规类 7），每种的家长关注点完全不同：
// 「作业批改」关心错在哪，「笔记/解题痕迹」关心课堂吸收，「加课沟通」关心加哪块、什么时候加。
// 所以每个板块的写法要跟着模块变，而不是永远写同一套。
//
// 模板用 {占位符} 表达，由 buildPrompt 里的 fill() 替换；占位符清单见那里的 vars。
export interface ModuleGuidance {
  /** 中文名，用于提示词与前端回显 */
  label: string;
  /** 常规类 / 非常规类 */
  group: '常规类' | '非常规类';
  /** 这个打卡场景的定位，一句话，帮助模型理解上下文 */
  scene: string;
  /** 作为「一个板块」时的写法：多选板块时每个板块单独成段，只写这一段 */
  point: string;
  /** 三段的写法指引（约字数上限沿用学校「约 150 字」的总控口径） */
  sections: { classContent: string; gains: string; homework: string };
  /** 小组课专用的三段写法（面向全班，不用学生称呼） */
  groupSections?: { classContent: string; gains: string; homework: string };
  /** 本模块特有的补充要求，追加在通用硬性要求之外 */
  rules: string[];
}

export const MODULE_GUIDANCE: Record<FollowUpModule, ModuleGuidance> = {
  // ---------- 常规类 ----------
  class_content: {
    label: '课程主题',
    group: '常规类',
    point: '说明这堂课讲了哪些内容、重点在哪，教学进度到哪了。',
    scene: '反馈这堂课具体教了什么：知识点、教学重点、教学进度，让家长知道孩子这一节课学了什么。',
    sections: {
      classContent:
        '说明{scopePhrase}讲授的知识点、教学重点与进度{multiRecap}，要与{grade}{subject}的课程标准相衔接。约 50-65 字。',
      gains:
        '从内容掌握角度写：{gainsDefault}{gainsTail}，并点出哪些知识点当场就接住了、哪些需要回家再消化。约 50-65 字。',
      homework: '{homeworkDefault}，任务围绕这节课讲的内容展开。约 35-50 字。',
    },
    rules: [],
    groupSections: {
      classContent: '描述同学们在{speechScope}的学习表现与进度{multiRecap}，要与{grade}{subject}的课程标准相衔接。约 50-65 字。',
      gains: '对全班的整体评价：{gainsDefault}{gainsTail}，点出集体掌握好的、集体还需加强的。约 50-65 字。',
      homework: '{homeworkDefault}，面向全班的巩固任务。约 35-50 字。',
    },
  },
  class_performance: {
    label: '课堂总结',
    group: '常规类',
    point: '综合总结这节课：讲了什么内容、孩子掌握得怎么样、课堂表现如何，让家长看到完整的一节课。',
    scene:
      '一节课收尾时的综合总结：先讲这节课的内容与掌握情况，再讲孩子的课堂状态（注意力、参与度、哪里卡住），内容与表现都要覆盖。',
    sections: {
      classContent:
        '概括{scopePhrase}讲授的知识点与教学进度{multiRecap}，点出孩子当场接住了哪些、还需要回家消化哪些。约 50-65 字。',
      gains:
        '综合写{call}的掌握与表现：内容掌握到什么程度，注意力持续多久、愿不愿意主动发言、哪一步开始跟不上。约 50-65 字。',
      homework: '{homeworkDefault}，围绕课堂薄弱点布置。约 35-50 字。',
    },
    rules: [],
  },
  homework_review: {
    label: '作业批改',
    group: '常规类',
    point: '把这节课布置的作业/练习批改结果反馈给家长：对错、错因、要不要重做。',
    scene:
      '批改上一节/这节课留的作业：逐题或分类型讲错因，区分粗心/不会/概念混淆，给出修正动作。',
    sections: {
      classContent:
        '列出{scopePhrase}作业的题型分布与完成情况{multiRecap}（如：计算 5 题全对，应用题 2/3 对）。约 50-65 字。',
      gains:
        '针对错题写{call}的错因分类：粗心几题、概念不清几题、完全不会几题。约 50-65 字。',
      homework:
        '错题标记重做、同类变式各 1 道；若概念不清，额外补 1 道基础题巩固。约 35-50 字。',
    },
    rules: ['必须区分「粗心」「概念不清」「完全不会」三类错因，不要笼统说「有错题」。'],
  },
  notes_trace: {
    label: '笔记/解题痕迹',
    group: '常规类',
    point: '看孩子课堂笔记、草稿纸、解题步骤，判断吸收程度与书写规范。',
    scene:
      '翻看课堂笔记/草稿纸：步骤是否完整、字迹是否工整、关键步骤有无标注，反映课堂专注度与思维规范。',
    sections: {
      classContent:
        '{scopePhrase}笔记/草稿覆盖了哪些知识点{multiRecap}，步骤是否分层、关键公式有无标注。约 50-65 字。',
      gains:
        '从书写规范与思维路径评价{call}：字迹工整度、步骤跳跃情况、自主标注关键点的能力。约 50-65 字。',
      homework: '本周每天抄写 1 道典型题步骤，要求分步书写、圈出关键字。约 35-50 字。',
    },
    rules: ['若笔记缺失或极其潦草，必须直说并给出「每日 1 道规范步骤抄写」的具体任务。'],
  },
  quiz_test: {
    label: '小测/测评',
    group: '常规类',
    point: '反馈阶段性测验/单元测评结果：分数区间、丢分板块、对应复习建议。',
    scene:
      '阶段性小测或单元测评：报分数段、逐板块丢分分析、给出针对性复习清单。',
    sections: {
      classContent:
        '{scopePhrase}测评涉及板块与分值分布{multiRecap}，{call}得分率如何。约 50-65 字。',
      gains:
        '按板块拆解丢分原因：基础题丢分=概念不牢，拓展题丢分=迁移不足，粗心丢分=审题习惯。约 50-65 字。',
      homework: '按丢分板块各补 2 道同类题；粗心型加「读题圈画」训练 5 分钟/天。约 35-50 字。',
    },
    rules: ['必须给出分板块得分率，不要只报总分。'],
  },
  preview: {
    label: '课前预习',
    group: '常规类',
    point: '记录预习完成度、预习中发现的疑问、课堂上预习转化为掌握的情况。',
    scene:
      '新课前预习：做了哪些题、标出哪些不懂、上课时这些疑问是否解决，形成「预习-带疑听课-疑问解决」闭环。',
    sections: {
      classContent:
        '{scopePhrase}预习完成了哪些内容{multiRecap}，标记了几个疑问、上课解决了几个。约 50-65 字。',
      gains:
        '评价{call}预习质量：是走马观花还是真思考、带疑听课效果如何。约 50-65 字。',
      homework: '下节课前继续预习下一讲，要求「做完例题、标出 2 个疑问」带到课堂。约 35-50 字。',
    },
    rules: [],
  },
  review_consolidation: {
    label: '复习巩固',
    group: '常规类',
    point: '本周/本月复习了哪些旧知识、遗忘了哪些、重新掌握了哪些。',
    scene:
      '定期复习旧知识：按遗忘曲线安排复习、检测保持率、对遗忘点再教一遍。',
    sections: {
      classContent:
        '本次复习覆盖了哪些旧知识点{multiRecap}，{call}现场测测保持率如何。约 50-65 字。',
      gains:
        '区分「仍牢固」「需唤醒」「完全遗忘」三类，重点写唤醒后的掌握情况。约 50-65 字。',
      homework: '遗忘点本周每天 1 道复现题；牢固点隔周抽查 1 道。约 35-50 字。',
    },
    rules: ['必须用「牢固/唤醒/遗忘」三分法，不要笼统说「复习了」。'],
  },
  parent_communication: {
    label: '家校沟通',
    group: '常规类',
    point: '记录与家长沟通的关键信息：配合事项、家庭端观察、约定的行动。',
    scene:
      '课后/课间与家长沟通：同步孩子状态、达成配合共识、约定家庭端具体行动。',
    sections: {
      classContent:
        '本次沟通的主题与达成共识{multiRecap}（如：同意每天监督朗读、周末补做错题）。约 50-65 字。',
      gains:
        '家长端观察到的变化/困难{call}，老师端回应与调整。约 50-65 字。',
      homework: '落实沟通中约定的家庭端行动（如：每晚 15 分钟听写、周末复盘错题本）。约 35-50 字。',
    },
    rules: ['沟通内容必须落到「家长具体做什么」的动作上，不要只写「沟通了」。'],
  },
  extra_class: {
    label: '加课沟通',
    group: '常规类',
    point: '说明加课的原因、安排的时间、加课内容、预期达成目标。',
    scene:
      '因进度落后/薄弱项攻克/考前冲刺等原因加课：讲清为什么加、加什么、什么时候加、加完要达到什么程度。',
    sections: {
      classContent:
        '加课原因（进度/薄弱/冲刺）、安排的时间与节次{multiRecap}。约 50-65 字。',
      gains:
        '加课要解决的具体问题{call}，预期经过几次课达到什么程度。约 50-65 字。',
      homework: '加课期间的配套练习安排，家长端配合事项。约 35-50 字。',
    },
    rules: ['必须写清「加什么内容、练到什么程度」，不能只写「加了 2 节课」。'],
  },

  // ---------- 非常规类 ----------
  habit_building: {
    label: '习惯养成',
    group: '非常规类',
    point: '针对某个学习习惯（如审题、书写、复盘）的专项训练进展。',
    scene:
      '长期习惯养成：指定 1 个微习惯、每天打卡、周末复盘，逐周收紧标准。',
    sections: {
      classContent:
        '本周重点训练哪个习惯{multiRecap}，执行频次与完成质量。约 50-65 字。',
      gains:
        '观察{call}习惯执行的稳定性、是否内化为自觉动作。约 50-65 字。',
      homework: '下周继续同一习惯，标准微升级（如：圈画关键字 → 圈画+列式子）。约 35-50 字。',
    },
    rules: ['同一习惯至少坚持 4 周才算初步定型，中途不要换目标。'],
  },
  mindset_coaching: {
    label: '心态辅导',
    group: '非常规类',
    point: '针对畏难、焦虑、抗拒、自卑等情绪的疏导与正向引导。',
    scene:
      '孩子出现「不想学、怕做错、一遇难题就放弃」时，老师的情绪接纳+认知重构+微小成功体验设计。',
    sections: {
      classContent:
        '触发情绪的具体场景{multiRecap}，老师用了什么话术/动作疏导。约 50-65 字。',
      gains:
        '{call}情绪缓和的迹象（如：愿意重试、不再哭闹、主动问「这道怎么做」）。约 50-65 字。',
      homework: '家长配合「只夸努力不夸聪明」、设置「微挑战」让孩子体验可控的成功。约 35-50 字。',
    },
    rules: ['严禁说「别怕、很简单」这类否定情绪的话；要先接纳再引导。'],
  },
  method_guidance: {
    label: '方法指导',
    group: '非常规类',
    point: '传授某个具体学习方法（如错题整理法、思维导图、费曼技巧）并督促落地。',
    scene:
      '针对孩子当前痛点（如错题重抄不看、背诵不理解），教 1 个具体方法、现场演练、布置落地任务。',
    sections: {
      classContent:
        '教了哪个方法、现场演练了哪道题{multiRecap}。约 50-65 字。',
      gains:
        '{call}现场上手程度、能否独立复现方法步骤。约 50-65 字。',
      homework: '本周指定 3 道题必须用该方法完成，拍照发老师检查。约 35-50 字。',
    },
    rules: ['方法要可操作、可检查，不要教「多思考、多总结」这类空泛建议。'],
  },
  reading_expression: {
    label: '阅读表达',
    group: '非常规类',
    point: '朗读/背诵/口语表达/写作表达的专项训练反馈。',
    scene:
      '语文/英语的朗读流利度、背诵准确率、口语开口度、写作起笔能力，分项反馈。',
    sections: {
      classContent:
        '本次训练的素材与任务{multiRecap}（如：课文第 3 段朗读、看图说话 2 分钟）。约 50-65 字。',
      gains:
        '{call}在语音语调/停顿/语法/丰富度上的表现。约 50-65 字。',
      homework: '每天朗读 1 段/口语描述 1 幅图，家长录音打卡。约 35-50 字。',
    },
    rules: [],
  },
  competition_prep: {
    label: '竞赛/考级备考',
    group: '非常规类',
    point: '针对特定竞赛/考级的专项训练进度、模考结果、冲刺计划。',
    scene:
      'AMC/奥数/英语考级/乐器考级等：专项题型训练、模拟考反馈、冲刺节奏把控。',
    sections: {
      classContent:
        '本阶段备考重点题型/考点{multiRecap}，模考/练习分数段。约 50-65 字。',
      gains:
        '{call}在核心考点上的拿分率、易失分陷阱。约 50-65 字。',
      homework: '按考纲权重每周刷 1 套真题/模拟卷，限时、对标评分。约 35-50 字。',
    },
    rules: ['必须引用具体考纲/真题编号，不要笼统说「练习了竞赛题」。'],
  },
  interest_expansion: {
    label: '兴趣拓展',
    group: '非常规类',
    point: '超纲有趣内容（如数学魔术、科学实验、编程入门、趣味阅读）的体验反馈。',
    scene:
      '非应试的趣味拓展：激发兴趣、拓宽视野、建立「学习=好玩」的正向联结。',
    sections: {
      classContent:
        '做了什么有趣的事{multiRecap}（如：托管实验、编程小游戏、数学魔术）。约 50-65 字。',
      gains:
        '{call}的好奇点、追问、想继续探索的方向。约 50-65 字。',
      homework: '推荐 1 个相关绘本/视频/小实验，亲子共做周末 30 分钟。约 35-50 字。',
    },
    rules: [],
  },
  other: {
    label: '其他',
    group: '非常规类',
    point: '不属于上述分类的补充说明。',
    scene: '兜底板块，记录任何不便归类但值得家长知道的信息。',
    sections: {
      classContent: '{scopePhrase}的补充情况{multiRecap}。约 50-65 字。',
      gains: '{call}的补充观察。约 50-65 字。',
      homework: '相应的补充建议。约 35-50 字。',
    },
    rules: [],
  },
} as const;

// ============ 类型导出 ============
export type { FollowUpModule };