import OpenAI from 'openai';
import { env } from '../config/env.js';
import { deriveNickname } from '../utils/nickname.js';
import { getAiConfig, getConfigVersion, getSetting, AiConfig } from '../config/settings.js';
import { normalizeFollowUpModule, FOLLOWUP_MODULES } from '../utils/mappers.js';
import type { FollowUpModule } from '../types/index.js';
import fs from 'fs';
import path from 'path';
import { log } from '../utils/logger.js';

// ============ SenseNova 客户端（OpenAI 兼容） ============
// 配置可在前端设置页修改，因此客户端要能按版本号重建，
// 否则改了模型/密钥还得重启容器才生效。
let client: OpenAI | null = null;
let clientVersion = -1;

function getClient(config: AiConfig): OpenAI {
  if (!client || clientVersion !== getConfigVersion()) {
    if (!config.apiKey) {
      throw new Error('未配置 SENSENOVA_API_KEY，请在「设置」页或 .env 中填写');
    }
    client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
      // 超时收紧（SDK 默认 10 分钟，用户等不起）
      timeout: config.timeoutMs,
      // SDK 层仅重试 1 次（网络抖动/5xx）；字数不达标的业务重试由本服务自行控制
      maxRetries: 1,
    });
    clientVersion = getConfigVersion();
  }
  return client;
}

/**
 * 取当前配置的共享客户端（供回访之外的其它 AI 能力复用，如听评课）。
 * 与 followup 走同一个模型/密钥/超时，无需各自维护。
 */
export function getSharedClient(): OpenAI {
  return getClient(getAiConfig());
}

export interface FollowUpGenerateParams {
  studentName: string;
  grade: string;
  subject: string;
  topic: string;
  performance: string;
  mastery: string;
  /** 本次回访涵盖的课次数（1-3），默认 1 */
  sessionCount?: number;
  /** 课程类型：1对1（默认）或小组课 */
  courseType?: 'one_on_one' | 'group';
  /** 流程打卡类型：决定生成内容侧重哪个模块，默认「课堂总结」 */
  module?: FollowUpModule;
  /**
   * 本次回访覆盖的板块（多选）。每个板块在生成内容里单独成一段。
   * 不传或为空时按 module 单板块处理（老数据 / 兼容旧调用方）。
   */
  modules?: FollowUpModule[];
  /** 自定义称呼；不传则由 studentName 推导 */
  nickname?: string;
  images: string[];
}

// 字数区间要求。流程打卡新规：「打卡文字约 150 字且通俗易懂」，
// 所以上限收到 200——之前 500 的上限等于默认写满三段 300 多字，家长根本不看。
export const MIN_WORDS = 140;
export const MAX_WORDS = 200;

/** 字数是否落在要求区间内 */
export function isWordCountOk(n: number, min = MIN_WORDS, max = MAX_WORDS): boolean {
  return n >= min && n <= max;
}

/**
 * 字数区间按板块数动态放宽。
 * 学校口径是「约 150 字」，那对应 1 个板块 + 两段收尾；每多覆盖一个板块，
 * 上下限各按固定增量放宽，保证每个板块仍能写出具体细节而不是被压成一句空话。
 */
export const WORDS_PER_EXTRA_BLOCK_MIN = 15;
export const WORDS_PER_EXTRA_BLOCK_MAX = 25;
export function followUpWordRange(blockCount: number): { min: number; max: number } {
  const n = Math.max(1, Math.min(FOLLOWUP_MODULES.length, Math.round(blockCount)));
  return {
    min: MIN_WORDS + (n - 1) * WORDS_PER_EXTRA_BLOCK_MIN,
    max: MAX_WORDS + (n - 1) * WORDS_PER_EXTRA_BLOCK_MAX,
  };
}

/** 由请求参数算出字数区间（没给板块清单时按单板块算） */
export function followUpWordRangeForParams(params: {
  module?: FollowUpModule;
  modules?: FollowUpModule[];
} = {}): { min: number; max: number } {
  const picked = params.modules && params.modules.length > 0
    ? params.modules
    : [normalizeFollowUpModule(params.module)];
  return followUpWordRange(picked.length);
}

/** 纯文字计数：去除空白与标点 */
export function countWords(text: string): number {
  return text.replace(/[\s\p{P}\p{S}]/gu, '').length;
}

const MASTERY_LABELS: Record<string, string> = {
  excellent: '优秀',
  good: '良好',
  average: '一般',
  needs_improvement: '需加强',
  优秀: '优秀',
  良好: '良好',
  一般: '一般',
  需加强: '需加强',
};

/**
 * 把 SDK 抛出的错误翻译成对用户有意义的中文提示。
 * 避免所有失败都显示笼统的"AI生成失败"。
 */
export function describeAiError(error: any): { httpStatus: number; message: string } {
  const name = error?.name || '';
  const raw = error?.message || '';
  const status = error?.status;

  if (name === 'APIConnectionTimeoutError' || /timed?\s*out/i.test(raw)) {
    return {
      httpStatus: 504,
      message: 'AI 生成超时（' +
        Math.round(getAiConfig().timeoutMs / 1000) +
        '秒）。可稍后重试，或把 SENSENOVA_REASONING_EFFORT 调为 none 以加快速度。',
    };
  }

  if (name === 'APIConnectionError') {
    return {
      httpStatus: 502,
      message: '无法连接到 SenseNova 服务，请检查服务器网络或 SENSENOVA_BASE_URL 配置。',
    };
  }

  if (status === 401 || status === 403) {
    return {
      httpStatus: 502,
      message: 'SenseNova API Key 无效或无权限，请在 .env 中检查 SENSENOVA_API_KEY。',
    };
  }

  if (status === 429) {
    return {
      httpStatus: 429,
      message: '请求过于频繁或积分额度不足，请稍后重试。',
    };
  }

  if (status === 400) {
    return { httpStatus: 502, message: '请求被模型拒绝：' + raw };
  }

  if (typeof status === 'number' && status >= 500) {
    return {
      httpStatus: 502,
      message: 'SenseNova 服务暂时不可用（HTTP ' + status + '），请稍后重试。',
    };
  }

  if (/SENSENOVA_API_KEY 未配置/.test(raw)) {
    return { httpStatus: 500, message: raw };
  }

  return { httpStatus: 500, message: raw || '未知错误' };
}

/**
 * 将本地上传图片转为 Base64 Data URL（含路径穿越与存在性校验）
 */
function imageToBase64DataUrl(imagePath: string): string {
  const uploadRoot = path.resolve(env.UPLOAD_DIR);
  const fullPath = path.isAbsolute(imagePath) ? imagePath : path.resolve(uploadRoot, imagePath);

  if (!fullPath.startsWith(uploadRoot + path.sep)) {
    throw new Error('非法的图片路径');
  }
  if (!fs.existsSync(fullPath)) {
    throw new Error('图片文件不存在');
  }

  const ext = path.extname(fullPath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
  };
  const mimeType = mimeTypes[ext] || 'image/png';
  return 'data:' + mimeType + ';base64,' + fs.readFileSync(fullPath).toString('base64');
}

// ============ 流程打卡类型（模块）=
//
// 回访内容本质是向家长展示教学服务流程，一次回访要覆盖 5 个以上流程环节。
// 学校清单里的「课堂总结」已拆成课堂内容总结 + 课堂表现总结，
// 现在共 16 种（常规类 9 + 非常规类 7），每种的家长关注点完全不同：
// 「作业批改」关心错在哪，「笔记/解题痕迹」关心课堂吸收，「加课沟通」关心加哪块、什么时候加。
// 所以每个板块的写法要跟着模块变，而不是永远写同一套。
//
// 模板用 {占位符} 表达，由 buildPrompt 里的 fill() 替换；占位符清单见那里的 vars。
interface ModuleGuidance {
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
  /** 本模块特有的补充要求，追加在通用硬性要求之外 */
  rules: string[];
}

export const MODULE_GUIDANCE: Record<FollowUpModule, ModuleGuidance> = {
  // ---------- 常规类 ----------
  class_content: {
    label: '课堂内容总结',
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
  },
  class_performance: {
    label: '课堂表现总结',
    group: '常规类',
    point: '说明孩子这节课的听讲状态、参与度，以及卡在哪一步。',
    scene:
      '向家长反馈孩子的课堂状态：注意力、参与度、互动情况，孩子在哪一步开始卡住，方便家长在家配合。',
    sections: {
      classContent:
        '交代本节内容背景：{scopePhrase}在讲什么、大概怎么推进的，让后面的表现描述有落脚点。约 50-65 字。',
      gains:
        '描述{call}这堂课的课堂状态：注意力持续多久、愿不愿意主动发言、哪一步开始跟不上。约 50-65 字。',
      homework: '针对上面提到的课堂表现卡点安排一个配套练习，写明做什么、大概花多久。约 35-50 字。',
    },
    rules: [
      '【课堂表现总结】要写具体的课堂行为细节，【不要】写成「表现良好」「认真听讲」这类空话',
    ],
  },
  preview: {
    label: '预习资料',
    group: '常规类',
    point: '说明发了哪份预习资料、覆盖哪些知识点、要完成到什么程度。',
    scene: '发放或布置了预习资料，告诉家长资料内容、孩子怎么用、要完成到什么程度。',
    sections: {
      classContent:
        '说明本次发放的预习资料覆盖了哪些知识点、这份资料该怎么用，跟{topic}有什么关系。约 50-65 字。',
      gains:
        '描述{call}拿到资料后的状态：知不知道从哪开始预习，预计会在哪一部分遇到困难。约 50-65 字。',
      homework:
        '把预习任务写具体：看哪几页、做哪几道题、大概花多少分钟，完成后怎么反馈给老师。约 35-50 字。',
    },
    rules: [
      '【预习资料】任务必须具体到页码或题号，【不要】写成「提前预习一下」这种没法执行的空话',
    ],
  },
  homework_review: {
    label: '作业批改',
    group: '常规类',
    point: '说明批改了哪份作业、错在哪几类题、怎么订正。',
    scene: '批改完作业后向家长反馈完成质量、错在哪里、要怎么订正。',
    sections: {
      classContent:
        '说明本次批改的作业范围、整体完成质量，以及错误主要集中在哪些知识点上。约 50-65 字。',
      gains:
        '描述{call}的正确率趋势：哪些有进步，哪些类型的题还容易出错，要写具体（例如「通分时容易漏乘分子」）。约 50-65 字。',
      homework:
        '写清订正要求和配套练习：哪几题重做、再练哪一组、下次课带什么来。约 35-50 字。',
    },
    rules: [
      '【作业批改】只能写老师真实批改出来的错误类型，【严禁】自己编造题目或编造错误',
    ],
  },
  mistake_drill: {
    label: '错题专练',
    group: '常规类',
    point: '说明专练了哪几类错题、现在还剩哪些不会。',
    scene: '针对之前做错的题做专项训练，反馈这些错题现在处于什么状态。',
    sections: {
      classContent:
        '说明本次专练了哪几类错题、一共多少道，针对这些错误专门练了什么方法。约 50-65 字。',
      gains:
        '描述{call}重做错题时的表现：哪些已经会了、哪些还需要提醒，方法上明白了什么。约 50-65 字。',
      homework:
        '布置同类题再练一组，并要求把错题整理进错题本、下次课前自查一遍。约 35-50 字。',
    },
    rules: [
      '【错题专练】全篇围绕「错题」展开，【不要】写成整节课的泛泛总结',
    ],
  },
  note_trace: {
    label: '笔记/解题痕迹',
    group: '常规类',
    point: '说明笔记记得全不全、有没有自己的标注或提问。',
    scene: '翻看孩子这节课的笔记，反馈记录得怎么样、有没有自己补充和思考，判断他当时跟没跟上。',
    sections: {
      classContent:
        '说明{scopePhrase}笔记的整体情况：板书有没有记全、关键词有没有标出来、有没有自己的补充和疑问。约 50-65 字。',
      gains:
        '描述{call}做笔记时的状态：是被动抄写还是会边听边思考、有没有主动提问或标记不理解的点。约 50-65 字。',
      homework:
        '让孩子自己把笔记里缺的地方补上、给重点内容加标注，并对照笔记向家长讲一遍这节课的重点。约 35-50 字。',
    },
    rules: [
      '【笔记/解题痕迹】要写看到的具体笔记细节，【不要】只写「笔记写得不错」这种空话',
    ],
  },
  homework_assign: {
    label: '作业布置',
    group: '常规类',
    point: '说明布置了什么作业、几项、针对哪块薄弱点、大概花多久。',
    scene: '这次回访的重点是布置接下来的作业：做什么、为什么做、大概花多久，家长要一次听懂。',
    sections: {
      classContent:
        '说明本次布置的作业具体包含哪几项、涉及{topic}的哪些内容，以及针对孩子哪块薄弱点。约 50-65 字。',
      gains:
        '说明这份作业想帮{call}解决什么问题，目前他在这一块的理解到什么程度，哪些还需要提醒。约 50-65 字。',
      homework:
        '逐项写清作业内容与完成方式、大概需要多少分钟、怎么反馈给老师，提醒孩子独立完成并标记不会的题。约 35-50 字。',
    },
    rules: [
      '【作业布置】要写清作业的具体内容和预计耗时，【不要】只写「布置了作业」，也不要写成批改反馈',
    ],
  },
  accumulation: {
    label: '积累打卡',
    group: '常规类',
    point: '说明今天积累了什么、多少量、完成得怎么样。',
    scene: '每天一点小量的积累打卡，贵在坚持。反馈今天攒了什么、明天接着做什么。',
    sections: {
      classContent:
        '说明今天积累的具体内容与数量（例如记了哪些词、背了哪段、练了多少道），完成情况怎么样。约 50-65 字。',
      gains:
        '描述{call}今天积累时的状态与节奏，是否按计划完成、有没有走神或卡住的地方。约 50-65 字。',
      homework:
        '安排明天继续积累的一点小量，说明今天的内容还要复习巩固，完成后再反馈给老师。约 35-50 字。',
    },
    rules: [
      '【积累打卡】要写清今天积累的具体内容与数量，【不要】加重成练习量，也不要评价成绩',
    ],
  },
  exam_prep: {
    label: '备考资料',
    group: '常规类',
    point: '说明发了什么备考资料、覆盖什么范围、孩子该怎么用。',
    scene: '备考阶段发放资料，说明资料是什么、覆盖什么范围、孩子怎么用。',
    sections: {
      classContent:
        '说明本次发放的备考资料是什么形式（真题、专项练习还是讲义）、覆盖哪些考试范围或知识点。约 50-65 字。',
      gains:
        '描述{call}目前的备考状态：哪些内容掌握得比较牢，哪些地方还需要集中突破。约 50-65 字。',
      homework:
        '说明资料怎么用：先做哪部分、按什么节奏做、错题怎么标记，提醒孩子按自己的节奏来不要贪多。约 35-50 字。',
    },
    rules: [
      '【备考资料】要写清资料的形式与使用方法，【不要】承诺具体的提分效果',
    ],
  },
  // ---------- 非常规类 ----------
  grade_analysis: {
    label: '成绩分析',
    group: '非常规类',
    point: '说明这次成绩从哪来、丢分集中在哪、接下来怎么提。',
    scene: '针对某次考试或测评的成绩做分析反馈，回答「分数怎么来的、接下来怎么提」。',
    sections: {
      classContent:
        '说明这次成绩来自哪次考试或测评、孩子的整体得分情况，以及各部分的得分分布。约 50-65 字。',
      gains:
        '分析分数背后反映的能力点：哪类题丢分多、说明哪个环节薄弱，以及值得肯定的进步。约 50-65 字。',
      homework:
        '给出针对性的提分计划：接下来重点补什么、用什么材料、下次什么时候复盘。约 35-50 字。',
    },
    rules: [
      '【成绩分析】成绩数字只能取自老师填写的内容；老师没给具体分数就不要编数字，也不要写具体名次',
    ],
  },
  stage_test: {
    label: '阶测反馈',
    group: '非常规类',
    point: '说明这次阶段测评的完成情况、哪块扎实、哪块还弱。',
    scene: '一次阶段性测评后的整体反馈，要体现「阶段」的视角，而不是一次课。',
    sections: {
      classContent:
        '说明这次阶段测评考察了哪些范围、难度如何，孩子的整体完成情况怎么样。约 50-65 字。',
      gains:
        '描述{call}目前掌握得比较扎实的板块、还有哪些短板，与上一次阶段测评相比有什么变化。约 50-65 字。',
      homework:
        '明确下一阶段要攻克的模块与具体任务，说明下次阶测前需要达到什么程度。约 35-50 字。',
    },
    rules: [
      '【阶测反馈】要有阶段性视角，【不要】写成一次普通课的总结',
    ],
  },
  plan_adjust: {
    label: '规划调整',
    group: '非常规类',
    point: '说明调整了什么、为什么改、改完之后按什么节奏走。',
    scene: '原来的学习规划要改：调整了什么、为什么改、改完之后孩子和家长分别要怎么做。',
    sections: {
      classContent:
        '说明本次调整的具体内容（节奏、进度、重点方向或时间安排的变化），以及为什么需要调整。约 50-65 字。',
      gains:
        '描述{call}目前的学习状态与卡点，说明这次调整希望帮他解决什么问题。约 50-65 字。',
      homework:
        '按调整后的规划说清下一步：接下来的重点、时间与频次，以及需要家长配合跟进的事项。约 35-50 字。',
    },
    rules: [
      '【规划调整】要写清调整了什么、为什么调整，【不要】只写「调整了规划」这类没有信息量的表述',
    ],
  },
  student_request: {
    label: '学生要求',
    group: '非常规类',
    point: '说明孩子提了什么诉求、老师怎么回应、接下来怎么落实。',
    scene: '孩子自己提出了诉求（想加练、想了解某个方向、对学习安排有想法），重点写怎么回应他。',
    sections: {
      classContent:
        '说明孩子提出的具体诉求是什么、老师的回应与处理方式，以及目前处理到哪一步。约 50-65 字。',
      gains:
        '描述{call}主动提出诉求背后的想法，说明他开始关注自己的学习、有了参与感。约 50-65 字。',
      homework:
        '说明答应做到的部分、需要孩子自己完成的前提条件，以及下次什么时候再确认效果。约 35-50 字。',
    },
    rules: [
      '【学生要求】要写清孩子的具体诉求和老师的回应，【不要】写成常规的教学内容或作业总结',
    ],
  },
  academic_assist: {
    label: '学管协助',
    group: '非常规类',
    point: '说明这次配合处理了什么事务（排课、上课方式等）、进展到哪一步。',
    scene: '家校配合上的沟通：排课时间、上课方式、作业提交方式、家长反馈的问题，由学管侧协助推进。',
    sections: {
      classContent:
        '说明本次协助的具体事项（排课、上课方式、作业提交或家长反馈的问题）以及当前处理到哪一步。约 50-65 字。',
      gains:
        '描述孩子目前的上课与配合状态，以及家长侧的顾虑或诉求是什么。约 50-65 字。',
      homework:
        '说明后续需要家长配合的事项与时间点，以及下次跟进的时间；老师侧需要同步的内容也要写清。约 35-50 字。',
    },
    rules: [
      '【学管协助】要写清协助事项与后续跟进时间，【不要】写成教学内容或作业批改的总结',
    ],
  },
  extra_class: {
    label: '加课沟通',
    group: '非常规类',
    point: '说明建议加哪一块的课、什么时间、为什么需要加。',
    scene: '沟通要不要多上一次课：加在哪一块、什么时间、为什么需要加。',
    sections: {
      classContent:
        '说明建议加课的具体内容与时间（加在哪一块知识点、建议的时间段与频次），以及为什么需要加。约 50-65 字。',
      gains:
        '描述{call}目前的掌握情况与卡点，说明加这次课预计能帮到什么。约 50-65 字。',
      homework:
        '写清加课的具体安排、需要孩子提前准备什么，以及需要家长确认的事项。约 35-50 字。',
    },
    rules: [
      '【加课沟通】要写清加课原因与建议时间，【不要】写成教学成果总结，也不要评价成绩',
    ],
  },
  makeup_plan: {
    label: '补课安排',
    group: '非常规类',
    point: '说明补的是哪一块、补完之后掌握得怎么样、接下来怎么巩固。',
    scene: '需要补课：说明补的是哪一块、补完孩子掌握得怎么样、接下来怎么巩固。',
    sections: {
      classContent:
        '说明这次补的内容对应原计划的哪一部分、为什么需要单独补这一块。约 50-65 字。',
      gains:
        '描述{call}补完这块内容后的掌握情况：之前卡住的地方有没有打通。约 50-65 字。',
      homework:
        '布置能把这块内容固化的练习，并说明下次课的安排。约 35-50 字。',
    },
    rules: [
      '【补课安排】语气要正向，强调主动补救和已经打通的环节，【不要】让家长觉得孩子掉队了',
    ],
  },
};

/* 多板块模式下【学生收获】与【课后任务】的收尾写法。
 * 单板块模式仍用各类型自己的 sections.gains / sections.homework。 */
const CLOSING_GAINS =
  '结合上面这几个板块，说清{call}这次整体收获最大的一点，以及哪一块还卡着。约 30 字。';
const CLOSING_HOMEWORK =
  '把上面几个板块里提到的事合并成一份清晰的清单：做哪几项、大概花多久、完成后怎么反馈给老师。约 35 字。';

/**
 * 构建提示词。correction 不为空时，追加纠偏指令（用于字数不达标时的重试）
 */
export function buildPrompt(params: FollowUpGenerateParams, correction?: string): string {
  const { studentName, grade, subject, topic, performance } = params;
  const masteryLabel = MASTERY_LABELS[params.mastery] || params.mastery;

  // 按涵盖课次调整措辞：单次课聚焦本节课，多次课作为一个阶段整体反馈
  const sessionCount = Math.min(3, Math.max(1, parseInt(String(params.sessionCount ?? 1), 10) || 1));
  const multi = sessionCount > 1;
  const scope = multi ? '最近 ' + sessionCount + ' 次课' : '本次课';
  const scopePhrase = multi ? '这 ' + sessionCount + ' 次课' : '本节课';

  // 课程类型：小组课面向多位家长，绝不能出现学生姓名
  const isGroup = params.courseType === 'group';
  // 亲切称呼：李一一 → 一一
  const nickname = deriveNickname(params.nickname || studentName);

  // 本次回访覆盖的板块：多选时每个板块在内容里单独成段；
  // 只选 1 个（含老数据里只有单个 module 的记录）时保持原来的三段富写法。
  const pickedMods = (params.modules && params.modules.length > 0
    ? params.modules
    : [normalizeFollowUpModule(params.module)]);
  const selectedMods = pickedMods.filter((m, i, a) => a.indexOf(m) === i);
  const multiBlock = selectedMods.length > 1;
  const wordRange = followUpWordRange(selectedMods.length);
  const mod = MODULE_GUIDANCE[selectedMods[0]];

  // 模板占位符。gainsDefault / gainsTail / homeworkDefault 把原有「1对1 与小组课、
  // 单次与多次」的分支收敛成字符串，模块模板只需要引用它们，不用各自重复分支逻辑。
  const vars: Record<string, string> = {
    scope,
    scopePhrase,
    grade,
    subject,
    topic,
    masteryLabel,
    performance:
      params.performance?.trim() || '专注度尚可、能跟上教学节奏',
    sessionCount: String(sessionCount),
    call: isGroup ? '孩子们' : (nickname || '学生'),
    multiRecap: multi ? '，体现知识之间的递进关系' : '',
    gainsDefault: isGroup
      ? '结合课堂表现与掌握程度（' + masteryLabel + '），描述同学们在' + scopePhrase +
        '的整体进步与亮点（理解力、专注度、解题能力等），并给出对全班的整体评价'
      : '结合课堂表现与掌握程度（' + masteryLabel + '），描述' + (nickname || '学生') +
        (multi
          ? '在这 ' + sessionCount + ' 次课中的进步轨迹与当前'
          : '本节课的进步与亮点，体现理解力、专注度、解题能力等具体表现，并反映其当前'),
    gainsTail: isGroup ? '' : '掌握情况',
    homeworkDefault: multi
      ? '针对' + scopePhrase + '的综合情况布置巩固练习，注意覆盖主要薄弱点'
      : '布置具体、可执行、与本节课内容紧密相关的巩固练习',
  };
  const fill = (tpl: string) => tpl.replace(/\{(\w+)\}/g, (_m, k: string) => vars[k] ?? '');

  const lines: string[] = [
    '# 角色',
    '你是一位经验丰富的教育咨询师，擅长为学生家长撰写专业、温馨、有针对性的课后回访反馈。',
    '',
    '# 任务',
    isGroup
      ? '根据以下课堂信息，为' + grade + subject + '的**小组课**生成一份课后回访内容。'
      : '根据以下课堂信息，为' + studentName + '（' + grade + '，' + subject + '）生成一份课后回访内容。',
  ];

  if (multi) {
    lines.push(
      '本次回访**涵盖' + scope + '**，请把这几次课作为一个阶段来整体反馈，',
      '体现内容的递进关系与学生的阶段性变化，而不是逐次罗列流水账。'
    );
  }

  lines.push('', '# 课堂信息');

  // 1对1 时给出亲切称呼；小组课不给任何姓名信息
  if (!isGroup) {
    if (nickname) {
      lines.push(
        '- 对学生的称呼：' + nickname +
          '（行文中请用这个亲切的称呼，不要反复使用全名「' + studentName + '」）'
      );
    } else {
      lines.push('- 学生姓名：' + studentName);
    }
  }

  lines.push(
    multi ? '- 涵盖课次：' + scope : '- 涵盖课次：本次课',
    multiBlock
      ? '- 覆盖板块（' + selectedMods.length + ' 个，都要写进内容）：' +
        selectedMods.map((m) => MODULE_GUIDANCE[m].label).join('、')
      : '- 打卡类型：' + mod.group + ' · ' + mod.label,
    '- 课程内容：' + topic,
    '- 课堂表现：' + performance,
    '- 掌握程度（整体评价）：' + masteryLabel,
    ''
  );

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

  // 打卡类型定位：让模型先明白「这次要覆盖哪几块」，再决定内容怎么写
  lines.push(
    multiBlock
      ? '# 本次回访覆盖的板块（' + selectedMods.length + ' 个）'
      : '# 本次打卡类型：' + mod.group + ' · ' + mod.label,
    multiBlock
      ? selectedMods.map((m) => MODULE_GUIDANCE[m].label).join('、') +
        '（每个板块都要单独成一段，具体写法见下文「输出格式」）'
      : selectedMods.map((m) => MODULE_GUIDANCE[m].label + '：' + MODULE_GUIDANCE[m].scene).join('\n'),
    ''
  );

  lines.push(
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
    '',
  );

  // 老师自定义的风格补充（设置页可改，留空则不追加）。
  // 刻意只做"追加"而不是"整段替换"：小组课隐私、图片指代禁令、三段格式
  // 这些硬性约束必须留在代码里，不能被一条自定义设置误删。
  const styleHint = getSetting('ai.prompt.style').trim();
  if (styleHint) {
    lines.push('# 风格偏好（老师自定义，优先遵循）', styleHint, '');
  }

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
    lines.push(
      '# 输出格式（严格三段，段标题必须一字不差地原样保留）',
      '【课堂内容】',
      fill(mod.sections.classContent),
      '',
      '【学生收获】',
      fill(mod.sections.gains),
      '',
      '【课后任务】',
      fill(mod.sections.homework),
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

  // 板块专属要求：追加在通用硬性要求之外，不动通用条目的序号
  const allRules = selectedMods.flatMap((m) => MODULE_GUIDANCE[m].rules);
  if (allRules.length > 0) {
    // 单板块沿用原标题（老调用方的提示词形状完全不变）
    lines.push('', multiBlock ? '# 各板块专属要求' : '# 本模块专属要求（' + mod.label + '）');
    allRules.forEach((r, i) => lines.push(String(i + 1) + '. ' + r));
  }

  if (correction) {
    lines.push(
      '',
      '# 重要修正',
      '你上一次的输出是 ' + correction + '，不符合字数要求。',
      '请重新撰写，确保总字数落在 ' + wordRange.min + '-' + wordRange.max +
        ' 字之间，同时保持原有段落结构与内容质量。'
    );
  }

  return lines.join('\n');
}

/** 组装 user 消息内容块：提示词 + 图片（Base64 Data URL） */
function buildUserContent(params: FollowUpGenerateParams, correction?: string): any[] {
  const userContent: any[] = [{ type: 'text', text: buildPrompt(params, correction) }];

  for (const imagePath of params.images) {
    try {
      userContent.push({
        type: 'image_url',
        image_url: { url: imageToBase64DataUrl(imagePath) },
      });
    } catch (error: any) {
      log.warn({ image: imagePath, err: error.message }, '图片加载失败');
    }
  }

  if (params.images.length > 0) {
    userContent.push({
      type: 'text',
      text: [
        '以上是与本次课程相关的图片（作业、试卷、板书等）。',
        '',
        '请先仔细观察图片，识别：题目类型、学生的作答情况、出错位置、书写规范程度、老师批改痕迹。',
        '',
        '然后在【学生收获】或【课后任务】中，结合你实际观察到的细节来写。',
        '例如写成"第3题在通分时漏乘分子导致失分"，而不是笼统地说"看图有进步"。',
        '',
        '如果图片与本次课程主题关联不大、或内容模糊无法辨识，请以文字信息为准，',
        '不要凭空编造图片里并不存在的内容。',
      ].join('\n'),
    });
  }

  return userContent;
}

/**
 * 构造请求体。
 * SenseNova 自定义参数（reasoning_effort）需直接放入请求体，
 * OpenAI Node SDK 的类型定义未包含该字段，故用 any 透传。
 */
function buildRequest(params: FollowUpGenerateParams, correction?: string, stream = false): any {
  const config = getAiConfig();

  const body: any = {
    model: config.model,
    messages: [
      {
        role: 'system',
        content: '你是一位专业的1对1教育咨询师，擅长撰写课后回访反馈。输出简洁、专业、有温度。',
      },
      { role: 'user', content: buildUserContent(params, correction) },
    ],
    max_tokens: 2000,
    temperature: 0.7,
    // 思考强度：可在前端设置页调整（默认 low）
    reasoning_effort: config.reasoningEffort,
  };
  if (stream) body.stream = true;
  return body;
}

// ============ 并发闸门 ============
//
// 老师连点两次「生成」，或两个学生在两个标签页同时生成，就是两个请求一起打出去：
// 双倍计费，而且两份结果会互相覆盖（后返回的把先返回的冲掉）。
//
// 限到 2 个对单人使用绰绰有余；超出就排队，不会丢请求。
// 闸门加在真正调用 SDK 的地方（generateOnce / streamOnce），
// 所有上层入口（非流式、流式、字数重试）自动被覆盖。
export const MAX_CONCURRENT_AI = 2;
let aiInFlight = 0;
const aiWaiters: Array<() => void> = [];

export async function acquireAiSlot(): Promise<void> {
  while (aiInFlight >= MAX_CONCURRENT_AI) {
    await new Promise<void>((resolve) => aiWaiters.push(resolve));
  }
  aiInFlight++;
}

export function releaseAiSlot(): void {
  aiInFlight = Math.max(0, aiInFlight - 1);
  // 唤醒一个等待者；被唤醒的一方会重新检查占用，避免多抢同一个槽位
  const next = aiWaiters.shift();
  if (next) next();
}

/**
 * 把一次 AI 调用放进并发闸门。
 * 星级定档（catalogStar）、听评课（observation）这些走 `getSharedClient()` 的能力
 * 也要套上，否则闸门只管得住回访生成，其它能力照样能并发打满。
 */
export async function withAiSlot<T>(fn: () => Promise<T>): Promise<T> {
  await acquireAiSlot();
  try {
    return await fn();
  } finally {
    releaseAiSlot();
  }
}

/** 当前正在跑的 AI 请求数（仅供测试断言） */
export function getAiInFlightCount(): number {
  return aiInFlight;
}

/** 重置闸门计数（仅供测试） */
export function resetAiGate(): void {
  aiInFlight = 0;
  aiWaiters.length = 0;
}

/** 单次调用（非流式）。供字数重试逻辑复用。 */
export async function generateOnce(
  params: FollowUpGenerateParams,
  correction?: string
): Promise<string> {
  return withAiSlot(async () => {
    const ai = getClient(getAiConfig());
    const response = await ai.chat.completions.create(buildRequest(params, correction));
    return (response.choices[0].message.content || '').trim();
  });
}

/** 单次调用（流式），逐块产出文本增量 */
export async function* streamOnce(
  params: FollowUpGenerateParams,
  correction?: string
): AsyncGenerator<string> {
  // 流式占用槽位直到流读完：一次生成可持续几十秒，
  // 如果只在 create 时占一瞬间，等于没限流。
  await acquireAiSlot();
  try {
    const ai = getClient(getAiConfig());
    const stream = (await ai.chat.completions.create(
      buildRequest(params, correction, true)
    )) as any;
    for await (const chunk of stream) {
      const delta = chunk && chunk.choices && chunk.choices[0] && chunk.choices[0].delta
        ? chunk.choices[0].delta.content
        : null;
      if (delta) yield delta as string;
    }
  } finally {
    releaseAiSlot();
  }
}

/** 通用对话消息。回访之外的 AI 能力（月度总结 / 课程规划）共用这条通道 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  maxTokens?: number;
  temperature?: number;
}

function buildChatRequest(messages: ChatMessage[], opts: ChatOptions, stream: boolean): any {
  const config = getAiConfig();
  return {
    model: config.model,
    messages,
    max_tokens: opts.maxTokens ?? 1600,
    temperature: opts.temperature ?? 0.7,
    // 思考强度：与回访共用同一份「设置」页配置
    reasoning_effort: config.reasoningEffort,
    stream,
  };
}

/** 通用单次调用（非流式）。进闸门，与回访的 generateOnce 同口径 */
export async function generateChatOnce(
  messages: ChatMessage[],
  opts: ChatOptions = {}
): Promise<string> {
  return withAiSlot(async () => {
    const ai = getClient(getAiConfig());
    const response = await ai.chat.completions.create(buildChatRequest(messages, opts, false));
    return (response.choices[0].message.content || '').trim();
  });
}

/** 通用单次调用（流式），逐块产出文本增量。占位到流读完，与 streamOnce 同一套口径 */
export async function* streamChat(
  messages: ChatMessage[],
  opts: ChatOptions = {}
): AsyncGenerator<string> {
  await acquireAiSlot();
  try {
    const ai = getClient(getAiConfig());
    const stream = (await ai.chat.completions.create(
      buildChatRequest(messages, opts, true)
    )) as any;
    for await (const chunk of stream) {
      const delta = chunk && chunk.choices && chunk.choices[0] && chunk.choices[0].delta
        ? chunk.choices[0].delta.content
        : null;
      if (delta) yield delta as string;
    }
  } finally {
    releaseAiSlot();
  }
}

/**
 * 生成课后回访内容。
 * 若首轮字数不落在要求区间，自动追加纠偏指令重试一次；
 * 若仍不达标，返回更接近区间的那一版，交由前端提示用户微调。
 */
export async function generateFollowUpContent(params: FollowUpGenerateParams): Promise<string> {
  const first = await generateOnce(params);
  const firstWords = countWords(first);

  if (firstWords >= MIN_WORDS && firstWords <= MAX_WORDS) {
    return first;
  }

  log.warn({ firstWords, minWords: MIN_WORDS, maxWords: MAX_WORDS }, '首轮字数不在要求区间，触发重试');

  try {
    const retry = await generateOnce(params, '约 ' + firstWords + ' 字');
    const retryWords = countWords(retry);

    // 重试结果达标则采用
    if (retryWords >= MIN_WORDS && retryWords <= MAX_WORDS) {
      return retry;
    }

    // 都没达标时，返回更接近区间的一版
    const distance = (n: number) =>
      n < MIN_WORDS ? MIN_WORDS - n : n > MAX_WORDS ? n - MAX_WORDS : 0;

    return distance(retryWords) < distance(firstWords) ? retry : first;
  } catch (error: any) {
    log.warn({ err: error.message }, '重试失败，返回首轮结果');
    return first;
  }
}

// ============ 测试注入点 ============
// 路由通过 runFollowUpGeneration 调用生成逻辑，测试可替换实现以避免真实 API 请求。
type FollowUpGenerator = (params: FollowUpGenerateParams) => Promise<string>;
type FollowUpStreamer = (params: FollowUpGenerateParams) => AsyncGenerator<string>;

type OnceGenerator = (params: FollowUpGenerateParams, correction?: string) => Promise<string>;

let generatorImpl: FollowUpGenerator = generateFollowUpContent;
let streamerImpl: FollowUpStreamer = (params) => streamOnce(params);
// 单次调用（带纠偏指令），流式路由的字数重试走这里
let onceImpl: OnceGenerator = (params, correction) => generateOnce(params, correction);

/**
 * 替换非流式生成实现（仅供测试）。
 * 同时接管单次调用，确保流式路由的"字数重试"路径也可被测试控制。
 */
export function setFollowUpGenerator(fn: FollowUpGenerator): void {
  generatorImpl = fn;
  onceImpl = async (params) => fn(params);
}

/** 替换流式生成实现（仅供测试） */
export function setFollowUpStreamer(fn: FollowUpStreamer): void {
  streamerImpl = fn;
}

/** 恢复为真实的 SenseNova 调用 */
export function resetFollowUpGenerator(): void {
  generatorImpl = generateFollowUpContent;
  streamerImpl = (params) => streamOnce(params);
  onceImpl = (params, correction) => generateOnce(params, correction);
}

/** 路由统一入口：非流式（含字数重试） */
export function runFollowUpGeneration(params: FollowUpGenerateParams): Promise<string> {
  return generatorImpl(params);
}

/** 路由统一入口：流式 */
export function runStreamGeneration(params: FollowUpGenerateParams): AsyncGenerator<string> {
  return streamerImpl(params);
}

/** 带纠偏指令的单次调用（流式路由用于字数重试） */
export function retryGeneration(params: FollowUpGenerateParams, correction: string): Promise<string> {
  return onceImpl(params, correction);
}

// ============ 通用通道的测试注入点（月度总结 / 课程规划） ============
type ChatGenerator = (messages: ChatMessage[], opts: ChatOptions) => Promise<string>;
type ChatStreamer = (messages: ChatMessage[], opts: ChatOptions) => AsyncGenerator<string>;

let chatOnceImpl: ChatGenerator = (messages, opts) => generateChatOnce(messages, opts);
let chatStreamImpl: ChatStreamer = (messages, opts) => streamChat(messages, opts);

/** 替换通用非流式实现（仅供测试） */
export function setChatGenerator(fn: ChatGenerator): void {
  chatOnceImpl = fn;
}

/** 替换通用流式实现（仅供测试） */
export function setChatStreamer(fn: ChatStreamer): void {
  chatStreamImpl = fn;
}

/** 恢复为真实的模型调用 */
export function resetChatGenerator(): void {
  chatOnceImpl = (messages, opts) => generateChatOnce(messages, opts);
  chatStreamImpl = (messages, opts) => streamChat(messages, opts);
}

/** 路由统一入口：通用非流式 */
export function runChatOnce(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
  return chatOnceImpl(messages, opts);
}

/** 路由统一入口：通用流式 */
export function runChatStream(messages: ChatMessage[], opts: ChatOptions = {}): AsyncGenerator<string> {
  return chatStreamImpl(messages, opts);
}
