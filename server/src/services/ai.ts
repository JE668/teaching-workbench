import OpenAI from 'openai';
import { env } from '../config/env.js';
import fs from 'fs';
import path from 'path';

// ============ SenseNova 客户端（OpenAI 兼容） ============
let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    if (!env.SENSENOVA_API_KEY) {
      throw new Error('SENSENOVA_API_KEY 未配置，请在 .env 文件中设置');
    }
    client = new OpenAI({
      apiKey: env.SENSENOVA_API_KEY,
      baseURL: env.SENSENOVA_BASE_URL,
    });
  }
  return client;
}

export interface FollowUpGenerateParams {
  studentName: string;
  grade: string;
  subject: string;
  topic: string;
  performance: string;
  mastery: string;
  images: string[];
}

// 字数区间要求
const MIN_WORDS = 150;
const MAX_WORDS = 500;

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

/**
 * 构建提示词。correction 不为空时，追加纠偏指令（用于字数不达标时的重试）
 */
export function buildPrompt(params: FollowUpGenerateParams, correction?: string): string {
  const { studentName, grade, subject, topic, performance } = params;
  const masteryLabel = MASTERY_LABELS[params.mastery] || params.mastery;

  const lines: string[] = [
    '# 角色',
    '你是一位经验丰富的1对1教育咨询师，擅长为学生家长撰写专业、温馨、有针对性的课后回访反馈。',
    '',
    '# 任务',
    '根据以下课堂信息，为' + studentName + '（' + grade + '，' + subject + '）生成一份课后回访内容。',
    '',
    '# 课堂信息',
    '- 课程主题：' + topic,
    '- 课堂表现：' + performance,
    '- 掌握程度：' + masteryLabel,
    '',
    '# 使用场景（很重要）',
    '这段内容会由老师直接复制后发送给家长（微信等聊天工具），因此必须是干净的可读文本：',
    '禁止使用任何 Markdown 标记（如 #、##、*、-、>、`），禁止代码块，',
    '禁止添加"以下是回访内容"之类的前言或结语。',
    '',
    '# 输出格式（严格三段，段标题必须一字不差地原样保留）',
    '【课堂内容】',
    '说明本节课讲授的知识点、教学重点与进度，要与' + grade + subject + '的课程标准相衔接。约 80-130 字。',
    '',
    '【学生收获】',
    '结合课堂表现与掌握程度（' + masteryLabel + '），描述学生本节课的进步与亮点，体现理解力、专注度、解题能力等具体表现。约 80-130 字。',
    '',
    '【课后任务】',
    '布置具体、可执行、与本节课内容紧密相关的巩固练习，难度匹配' + grade + '水平。约 50-90 字。',
    '',
    '# 硬性要求',
    '1. 全文总字数必须控制在 ' + MIN_WORDS + '-' + MAX_WORDS + ' 字之间（中文字符计）',
    '2. 语气专业、温和、以鼓励为主',
    '3. 内容具体、有针对性，禁止空泛套话',
    '4. 全程使用中文',
    '5. 直接输出正文，不要任何前言、总结或额外说明',
    '6. 三个段标题必须写成【课堂内容】【学生收获】【课后任务】，不得改用 # 号或其他符号',
  ];

  if (correction) {
    lines.push(
      '',
      '# 重要修正',
      '你上一次的输出是 ' + correction + '，不符合字数要求。',
      '请重新撰写，确保总字数落在 ' + MIN_WORDS + '-' + MAX_WORDS + ' 字之间，同时保持三段结构与内容质量。'
    );
  }

  return lines.join('\n');
}

/**
 * 调用一次模型
 */
async function callModel(
  params: FollowUpGenerateParams,
  correction?: string
): Promise<string> {
  const ai = getClient();

  const userContent: any[] = [{ type: 'text', text: buildPrompt(params, correction) }];

  for (const imagePath of params.images) {
    try {
      userContent.push({
        type: 'image_url',
        image_url: { url: imageToBase64DataUrl(imagePath) },
      });
    } catch (error: any) {
      console.warn('[AI] 图片加载失败: ' + imagePath + ' - ' + error.message);
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

  // SenseNova 自定义参数（reasoning_effort）需直接放入请求体，
  // OpenAI Node SDK 的类型定义未包含该字段，故用 any 透传。
  const requestBody: any = {
    model: env.SENSENOVA_MODEL,
    messages: [
      {
        role: 'system',
        content: '你是一位专业的1对1教育咨询师，擅长撰写课后回访反馈。输出简洁、专业、有温度。',
      },
      { role: 'user', content: userContent },
    ],
    max_tokens: 2000,
    temperature: 0.7,
    // 思考强度：由 SENSENOVA_REASONING_EFFORT 控制（默认 low）
    reasoning_effort: env.SENSENOVA_REASONING_EFFORT,
  };

  const response = await ai.chat.completions.create(requestBody);
  return (response.choices[0].message.content || '').trim();
}

/**
 * 生成课后回访内容。
 * 若首轮字数不落在要求区间，自动追加纠偏指令重试一次；
 * 若仍不达标，返回更接近区间的那一版，交由前端提示用户微调。
 */
export async function generateFollowUpContent(params: FollowUpGenerateParams): Promise<string> {
  const first = await callModel(params);
  const firstWords = countWords(first);

  if (firstWords >= MIN_WORDS && firstWords <= MAX_WORDS) {
    return first;
  }

  console.warn('[AI] 首轮字数 ' + firstWords + ' 不在 ' + MIN_WORDS + '-' + MAX_WORDS + ' 区间，触发票重试');

  try {
    const retry = await callModel(params, '约 ' + firstWords + ' 字');
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
    console.warn('[AI] 重试失败，返回首轮结果: ' + error.message);
    return first;
  }
}
