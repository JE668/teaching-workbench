import OpenAI from 'openai';
import { env } from '../config/env.js';
import fs from 'fs';
import path from 'path';

// 初始化 OpenAI 客户端（SenseNova 兼容 OpenAI SDK）
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

interface FollowUpGenerateParams {
  studentName: string;
  grade: string;
  subject: string;
  topic: string;
  performance: string;
  mastery: string;
  images: string[];
}

/**
 * 将本地图片文件转换为 Base64 Data URL
 */
function imageToBase64DataUrl(imagePath: string): string {
  const fullPath = path.isAbsolute(imagePath)
    ? imagePath
    : path.resolve(env.UPLOAD_DIR, imagePath);

  const ext = path.extname(fullPath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
  };
  const mimeType = mimeTypes[ext] || 'image/png';

  const buffer = fs.readFileSync(fullPath);
  const base64 = buffer.toString('base64');
  return 'data:' + mimeType + ';base64,' + base64;
}

/**
 * 构建课后回访生成的提示词
 */
function buildPrompt(params: FollowUpGenerateParams): string {
  const { studentName, grade, subject, topic, performance, mastery } = params;

  const masteryMap: Record<string, string> = {
    'excellent': '优秀',
    'good': '良好',
    'average': '一般',
    'needs_improvement': '需加强',
    '优秀': '优秀',
    '良好': '良好',
    '一般': '一般',
    '需加强': '需加强',
  };

  const masteryLabel = masteryMap[mastery] || mastery;

  const prompt = [];
  prompt.push('# 角色');
  prompt.push('你是一位经验丰富的1对1教育咨询师，擅长为学生家长撰写专业、温馨、具有针对性的课后回访反馈。');
  prompt.push('');
  prompt.push('# 任务');
  prompt.push('根据老师提供的课堂信息，为' + studentName + '（' + grade + '，' + subject + '）生成一份课后回访内容。');
  prompt.push('');
  prompt.push('# 课堂信息');
  prompt.push('- 课程主题：' + topic);
  prompt.push('- 课堂表现：' + performance);
  prompt.push('- 掌握程度：' + masteryLabel);
  prompt.push('');
  prompt.push('# 输出要求');
  prompt.push('请严格按照以下三段式结构输出，不要添加任何多余内容：');
  prompt.push('');
  prompt.push('## 课堂内容');
  prompt.push('简要描述本次课程的授课内容和教学进度（约60-100字）。要具体说明本节课讲了什么知识点，与' + grade + subject + '的哪些内容相关。');
  prompt.push('');
  prompt.push('## 学生收获');
  prompt.push('根据课堂表现，描述学生本节课的收获和进步（约60-100字）。要体现学生的积极面，包括理解力、专注度、解题能力等方面的表现。结合掌握程度"' + masteryLabel + '"客观描述。');
  prompt.push('');
  prompt.push('## 课后任务');
  prompt.push('布置合理的课后作业和巩固练习（约40-80字）。任务要具体、可执行，与本次课程内容紧密相关，适合' + grade + '学生的水平。');
  prompt.push('');
  prompt.push('# 注意');
  prompt.push('1. 总字数控制在150-500字之间');
  prompt.push('2. 语气专业、温和、鼓励为主');
  prompt.push('3. 内容要具体、有针对性，避免空泛套话');
  prompt.push('4. 使用中文书写');
  prompt.push('5. 直接输出内容，不要加任何前言或总结');

  return prompt.join('\n');
}

/**
 * 调用 SenseNova AI 生成课后回访内容
 */
export async function generateFollowUpContent(params: FollowUpGenerateParams): Promise<string> {
  const ai = getClient();

  // 构建消息
  const userContent: any[] = [
    { type: 'text', text: buildPrompt(params) },
  ];

  // 添加图片输入
  for (const imagePath of params.images) {
    try {
      const base64Url = imageToBase64DataUrl(imagePath);
      userContent.push({
        type: 'image_url',
        image_url: { url: base64Url },
      });
    } catch (error) {
      console.warn('[AI] 图片加载失败: ' + imagePath, error);
    }
  }

  // 添加图片提示
  if (params.images.length > 0) {
    userContent.push({
      type: 'text',
      text: '以上是课堂相关图片（如作业、试卷、板书等），请参考图片内容生成更准确的课后回访。',
    });
  }

  const response = await ai.chat.completions.create({
    model: env.SENSENOVA_MODEL,
    messages: [
      {
        role: 'system',
        content: '你是一位专业的1对1教育咨询师，擅长撰写课后回访反馈。你的回复需要简洁、专业、有温度。',
      },
      {
        role: 'user',
        content: userContent,
      },
    ],
    max_tokens: 2000,
    temperature: 0.7,
    extra_body: {
      reasoning_effort: 'none',
    },
  });

  return response.choices[0].message.content || '';
}
