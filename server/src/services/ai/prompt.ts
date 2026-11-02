import { normalizeFollowUpModule, FOLLOWUP_MODULES } from '../../utils/mappers.js';
import type { FollowUpModule } from '../../types/index.js';
import { COMMON_RULES, MODULE_GUIDANCE, REPORT_PROMPT_VERSION } from '../../shared/promptTemplates.js';
import { getOcrText } from '../ocr.js';
import { getSetting, getAiConfig } from '../../config/settings.js';
import { countWords } from './utils.js';
import { log } from '../../utils/logger.js';

// ========== 常量 ==========

const CLOSING_GAINS = `结合这节课内容，具体写{call}掌握了什么、还有哪里跟不上，能写出哪怕一道题的细节。约 50-65 字。`;
const CLOSING_HOMEWORK = `针对上面提到的薄弱点或卡点，安排配套练习。写明做什么、大概花多久。约 35-50 字。`;

export interface FollowUpGenerateParams {
  studentName: string;
  grade: string;
  subject: string;
  topic: string;
  performance: string;
  mastery: string;
  sessionCount?: number;
  courseType?: 'one_on_one' | 'group';
  module?: FollowUpModule;
  modules?: FollowUpModule[];
  nickname?: string;
  images: string[];
  history?: FollowUpHistoryItem[];
}

export interface FollowUpHistoryItem {
  content: string;
  topic?: string;
  when: string;
}

export interface ModuleGuidance {
  label: string;
  group: '常规类' | '非常规类';
  point: string;
  scene: string;
  sections: {
    classContent: string;
    gains: string;
    homework: string;
  };
  rules: string[];
}

// 复用 shared 中的 MODULE_GUIDANCE
export { MODULE_GUIDANCE } from '../../shared/promptTemplates.js';

/** 字数区间随板块数动态放宽：1 块 150-280，每多 1 块 min +30、max +50 */
export function followUpWordRangeForParams(params: FollowUpGenerateParams): { min: number; max: number } {
  const mods = params.modules && params.modules.length > 0 ? params.modules : [params.module || 'class_content'];
  const blockCount = mods.length;
  return {
    min: 150 + (blockCount - 1) * 30,
    max: 280 + (blockCount - 1) * 50,
  };
}

export function isWordCountOk(n: number, min = 150, max = 280): boolean {
  return n >= min && n <= max;
}

/** 组装提示词 */
export function buildPrompt(params: FollowUpGenerateParams, correction?: string, userId?: number): string {
  const isGroup = params.courseType === 'group';

  // 掌握程度中文标签
  const MASTERY_LABELS: Record<string, string> = {
    good: '良好',
    fair: '一般',
    weak: '薄弱',
  };
  const masteryLabel = MASTERY_LABELS[params.mastery] || params.mastery;

  // 按涵盖课次调整措辞：单次课聚焦本节课，多次课作为一个阶段整体反馈
  const sessionCount = Math.min(3, Math.max(1, parseInt(String(params.sessionCount ?? 1), 10) || 1));
  const multi = sessionCount > 1;
  const scope = multi ? '最近 ' + sessionCount + ' 次课' : '本次课';
  const scopePhrase = multi ? '这 ' + sessionCount + ' 次课' : '本节课';

  // 亲切称呼：李一一 → 一一
  const nickname = params.nickname || (params.studentName ? params.studentName.slice(-2) : '学生');

  const call = isGroup ? '孩子们' : (nickname || '学生');

  const grade = params.grade || '';
  const subject = params.subject || '';
  const topic = params.topic || '';

  // 选中的板块（支持多选）
  const selectedMods = (params.modules && params.modules.length > 0
    ? params.modules
    : [params.module || 'class_content']
  ) as FollowUpModule[];

  const multiBlock = selectedMods.length > 1;
  const mod = MODULE_GUIDANCE[selectedMods[0]];
  const wordRange = followUpWordRangeForParams(params);

  // 模板占位符
  const vars: Record<string, string> = {
    scope,
    scopePhrase,
    grade,
    subject,
    topic,
    masteryLabel,
    performance: params.performance?.trim() || '专注度尚可、能跟上教学节奏',
    sessionCount: String(sessionCount),
    call,
    multiRecap: multi ? '，体现知识之间的递进关系' : '',
    gainsDefault: isGroup
      ? '结合课堂表现与掌握程度（' + masteryLabel + '），描述同学们在' + scopePhrase +
        '的整体进步与亮点（理解力、专注度、解题能力等），并给出对全班的整体评价'
      : '结合课堂表现与掌握程度（' + masteryLabel + '），描述' + call +
        (multi
          ? '在这 ' + sessionCount + ' 次课中的进步轨迹与当前'
          : '本节课的进步与亮点，体现理解力、专注度、解题能力等具体表现，并反映其当前'),
    gainsTail: isGroup ? '' : '掌握情况',
    homeworkDefault: multi
      ? '针对' + scopePhrase + '的综合情况布置巩固练习，注意覆盖主要薄弱点'
      : '布置具体、可执行、与本节课内容紧密相关的巩固练习',
    speechScope: isGroup ? scopePhrase : '本节课',
  };
  const fill = (tpl: string) => tpl.replace(/\{(\w+)\}/g, (_m, k: string) => vars[k] ?? '');

  // 历史回访：去重 + 轮转（每次生成最多用 3 条，轮换避免只盯着最近那几条）
  // 小组课不带历史（小组课无按学生的回访记录）
  const historyPool = !isGroup && params.history ? (params.history || []).filter((h) => (h.content || '').trim()) : [];
  const history = historyPool.slice(0, 3);

  const lines: string[] = [];

  lines.push(
    '# Role',
    '你是一位专业的 1 对 1 教育咨询师，擅长撰写课后回访反馈。',
    '输出给家长看（微信等聊天工具），要求：纯文本、无 Markdown、语气温暖专业、细节具体。',
    '',
    '# 学生与本次课程信息',
    '学生称呼：' + call,
    '年级：' + grade,
    '学科：' + subject,
    '课程主题：' + topic,
    '课堂表现（老师原文）：' + (params.performance || '（未提供）'),
    '掌握程度（老师原文）：' + (params.mastery || '（未提供）'),
    '课次数：' + (params.sessionCount || 1) + ' 节',
    '课程类型：' + (isGroup ? '小组课' : '1 对 1'),
    // 课次数自适应：多次课要按「一个阶段」整体反馈，而不是逐次罗列流水账。
    // 单次课不加这句——「作为一个阶段」对单次课是噪音。
    multi
      ? '- 本次回访**涵盖' + scope + '**，请把这几次课作为一个阶段来整体反馈，体现内容的递进关系与学生的阶段性变化，而不是逐次罗列流水账。'
      : '',
    '- 涵盖课次：' + (multi ? scope : '本次课'),
    // 打卡类型定位：先让模型知道「这次要覆盖哪块」，再决定怎么写
    multiBlock
      ? '- 覆盖板块（' + selectedMods.length + ' 个，都要写进内容）：' +
        selectedMods.map((m) => MODULE_GUIDANCE[m].label).join('、')
      : '- 打卡类型：' + mod.group + ' · ' + mod.label,
    '',
    // 1对1 时给出亲切称呼；小组课不给任何姓名信息
    !isGroup && nickname
      ? '- 对学生的称呼：' + nickname + '（行文中请用这个亲切的称呼，不要反复使用全名「' + (params.studentName || '学生') + '」）'
      : !isGroup && params.studentName
        ? '- 学生姓名：' + params.studentName
        : '',
    // 历史上下文：AI 最大的质量短板是"没有记忆"。
    // 这里刻意把指令写成"防重复 + 可引用进步点"两面：既避免照抄上次的话，
    // 又允许呼应明确的进展（这才是家长最想看到的）。
    history.length === 0
      ? '（该学生暂无历史回访，直接依据本次信息撰写）'
      : [
          '# 历史回访（若有，用于避免重复、体现进步轨迹）',
          '下面是这个孩子最近几次回访已经写给家长的内容。你只负责本次课，因此：',
          '- 【不要】复述下面已有的内容，也不要重复相同的句子、句式或细节（例如上次已写过"通分时容易漏乘分子"，这次就别再原样说一遍）',
          '- 如果本次课在某个方面确有进展或改善，【可以】用一句话呼应它（例如"上次提到的漏乘分子问题这次已经掌握"），',
          '  但必须落到本次课信息里真实发生的事，不要泛泛地写"比上次有进步"',
          '- 历史记录里出现但本次课信息里没有再次出现的具体题目、数字、细节，一律不要写',
          '',
          ...history.map(
            (h, i) =>
              '【' + h.when + (h.topic ? ' · ' + h.topic : '') + '】\n' + h.content.trim()
          ),
        ].join('\n'),
    '',
    '# 使用场景（很重要）',
    '这段内容会由老师直接复制后发送给家长（微信等聊天工具），因此必须是干净的可读文本：',
    '禁止使用任何 Markdown 标记（如 #、##、*、-、>、`），禁止代码块，',
    '禁止添加"以下是回访内容"之类的前言或结语。',
    '',
    '# 关于课堂照片（务必注意）',
    (params.images?.length ?? 0) > 0
      ? '你会看到课堂照片。照片是给老师看的，**家长看不到这些照片** —— ' +
        '因此【严禁】出现"图中""图片中""如图所示""照片里""图中的题目"这类指代图片的字眼。' +
        '需要传达的信息，请直接用文字描述出来（例如写"第 3 题漏乘了分子"，而不要写"图中第 3 题"）。'
      : '（本次没有课堂照片，直接依据文字信息撰写即可。）',
    '',
    '# 语气与表情',
    '语气亲切自然，像老师和家长聊天，可以适度使用 emoji 让表达更温暖',
    '（如 ✨📚💪🌟👍），全文用 2-4 个即可，放在句子或段落末尾；',
    '不要每句都加，不要堆砌，也不要使用与学习场景无关的表情。',
    ''
  );

  // 小组课最高优先级要求：分别私发给多位家长，绝不出现个性化细节
  if (isGroup) {
    lines.push(
      '# ⚠️ 小组课最高优先级要求',
      '这段内容会由老师**分别私发给多位家长**，请务必遵守：',
      '- 【严禁】出现任何学生姓名、昵称、小名，也不要写"某某同学""XX 同学"',
      '- 【严禁】描述只有某个孩子才有的个性化细节（如"某某做错了第 3 题"）',
      '- 统一使用「孩子们」「同学们」「孩子」这类通用称呼',
      '- 内容写成对全班都适用的通用反馈，让每位家长读起来都自然贴切',
      ''
    );
  }

  // 老师自定义的风格补充（设置页可改，留空则不追加）。
  const styleHint = userId ? getSetting('ai.prompt.style', userId).trim() : '';
  if (styleHint) {
    lines.push('# 风格偏好（老师自定义，优先遵循)', styleHint, '');
  }

  // 打卡类型定位场景块：让模型先明白「这次要覆盖哪几块、家长关心什么」，再决定怎么写
  lines.push(
    multiBlock
      ? '# 本次回访覆盖的板块（' + selectedMods.length + ' 个）'
      : '# 本次打卡类型：' + mod.group + ' · ' + mod.label,
    multiBlock
      ? selectedMods.map((m) => MODULE_GUIDANCE[m].label).join('、') +
        '（每个板块都要单独成一段，具体写法见下文「输出格式」）'
      : mod.label + '：' + mod.scene,
    ''
  );

  // 内容结构由覆盖的板块决定：多选时每个板块单独成段，末尾再接两段收尾
  if (multiBlock) {
    lines.push(
      '# 输出格式（每个板块单独成段，段标题必须一字不差地原样保留，顺序也不要变）',
      '本次回访覆盖 ' + selectedMods.length + ' 个板块，每个板块写一段。',
      '一段只写它自己那个板块具体做了什么，不要在同一段里混写两三个板块。',
      '',
      '# 素材分配（避免重复，很重要）',
      '课堂信息里的素材（课程内容、课堂表现）是全部素材，不是每个板块都要复述一遍的素材库：',
      '- 同一件事（如某道题做错了）只写进最相关的那一个板块，并在那里写透细节；' +
        '【严禁】同一件事在多个板块里重复出现，或换个说法再写一遍',
      '- 各板块写自己教学环节里的事：作业批改板块写批改时发现了什么，错题专练板块写这次专练练了什么、' +
        '与批改发现是两件事，其余板块同理——围绕本板块的教学动作组织内容，不要往里硬塞素材',
      '- 若素材只够支撑少数板块，其余板块按常规教学流程如实撰写，宁简勿凑',
      ''
    );
    selectedMods.forEach((m) => {
      lines.push('【' + MODULE_GUIDANCE[m].label + '】', fill(MODULE_GUIDANCE[m].point), '');
    });
    lines.push('【学生收获】', fill(CLOSING_GAINS), '', '【课后任务】', fill(CLOSING_HOMEWORK), '');
  } else {
    // 小组课使用 groupSections（如有），否则回落到普通 sections
    const useGroupSections = isGroup && !!mod.groupSections;
    lines.push(
      '# 输出格式（严格三段，段标题必须一字不差地原样保留）',
      '【课堂内容】',
      fill(useGroupSections ? mod.groupSections!.classContent : mod.sections.classContent),
      '',
      '【学生收获】',
      fill(useGroupSections ? mod.groupSections!.gains : mod.sections.gains),
      '',
      '【课后任务】',
      fill(useGroupSections ? mod.groupSections!.homework : mod.sections.homework),
      ''
    );
  }

  lines.push(
    '# 硬性要求（学校流程打卡标准）',
    '1. 全文总字数必须控制在 ' + wordRange.min + '-' + wordRange.max +
      ' 字之间（中文字符计，不含标点与空白）' +
      (multiBlock
        ? '—— 板块多时上下限已按板块数放宽，但每段仍然要写具体，不要为了塞进字数就写空话'
        : '—— 学校要求「约 150 字」，写长了家长不看'),
    '2. 语气专业、温和、以鼓励为主',
    '3. 通俗易懂：用家长日常能听懂的话写，不用学科术语和教研行话；确需保留的术语' +
      '（如"通分""异分母"）紧跟一句大白话解释',
    '4. 真实：只写老师提供的课堂情况里出现的事实，严禁编造分数、排名、成绩、未布置的作业或未发生的事',
    '5. 个性化：每一句都要具体到这节课和这个学生，换成别人就不成立的写法；' +
      '禁止"表现良好""继续努力""认真听讲"这类能套用到任何学生的空话',
    '6. 无错误：不出现错别字，句子读起来通顺，标点使用正确',
    '7. 全程使用中文',
    '8. 直接输出正文，不要任何前言、总结或额外说明',
    '9. ' + (multiBlock
      ? '段标题必须原样写成 ' +
        selectedMods.map((m) => '【' + MODULE_GUIDANCE[m].label + '】').join('') +
        '、【学生收获】、【课后任务】，' + selectedMods.length + ' 个板块一段都不能少，不得改用 # 号或其他符号'
      : '三个段标题必须写成【课堂内容】【学生收获】【课后任务】，不得改用 # 号或其他符号'),
    '10. 【严禁】出现"图中""图片中""如图所示""照片里"这类指代图片的字眼',
    isGroup
      ? '11. 【严禁】出现任何学生姓名、昵称，一律使用通用称呼'
      : '11. 行文使用亲切称呼，不要反复使用学生全名'
  );

  // 板块专属要求：追加在通用硬性要求之外，不动通用条目的序号。
  // 单板块沿用老标题（调用方与测试锁的就是这个形状），多板块用汇总标题。
  const allRules = selectedMods.flatMap((m) => MODULE_GUIDANCE[m].rules);
  if (allRules.length > 0) {
    lines.push('', multiBlock ? '# 各板块专属要求' : '# 本模块专属要求（' + mod.label + '）');
    allRules.forEach((r, i) => lines.push(String(i + 1) + '. ' + r));
  }

  // 字数纠偏：追加为一条指令
  if (correction && correction.trim()) {
    lines.push('# 字数纠偏指令', correction.trim());
  }

  return lines.join('\n');
}