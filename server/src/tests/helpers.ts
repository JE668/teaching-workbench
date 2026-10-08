import http from 'http';
import { AddressInfo } from 'net';
import { createApp } from '../app.js';

let server: http.Server | null = null;
let baseUrl = '';

/** 启动被测服务（随机端口，不污染 3000） */
export async function startServer(): Promise<string> {
  const app = createApp();
  server = http.createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = 'http://127.0.0.1:' + port;
  return baseUrl;
}

export async function stopServer(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = null;
}

export function url(path: string): string {
  return baseUrl + path;
}

interface JsonResponse {
  status: number;
  body: any;
  headers: Headers;
}

/** 发 JSON 请求并解析响应 */
export async function req(
  method: string,
  path: string,
  options: { token?: string; body?: any; raw?: BodyInit; headers?: Record<string, string> } = {}
): Promise<JsonResponse> {
  const headers: Record<string, string> = { ...(options.headers || {}) };
  let body: BodyInit | undefined;

  if (options.raw !== undefined) {
    body = options.raw;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  if (options.token) {
    headers['Authorization'] = 'Bearer ' + options.token;
  }

  const res = await fetch(url(path), { method, headers, body });
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed, headers: res.headers };
}

/** 从 Set-Cookie 中取出图片访问 cookie 的 "name=value" 片段 */
export function mediaCookieOf(res: JsonResponse): string {
  const raw = res.headers.getSetCookie?.() ?? [];
  const hit = raw.find((c) => c.startsWith('tw_media='));
  return hit ? hit.split(';')[0] : '';
}

/** 注册用户并返回 token + 图片 cookie（图片接口需要 cookie，不能只用 token） */
export async function createUserSession(
  username: string,
  password = 'passw0rd'
): Promise<{ token: string; cookie: string }> {
  const res = await req('POST', '/api/auth/register', { body: { username, password } });
  if (res.status !== 200) {
    throw new Error('注册失败: ' + JSON.stringify(res.body));
  }
  return { token: res.body.token as string, cookie: mediaCookieOf(res) };
}

/** 注册并登录一个独立用户，返回其 token（用于验证数据隔离） */
export async function createUser(username: string, password = 'passw0rd'): Promise<string> {
  const res = await req('POST', '/api/auth/register', { body: { username, password } });
  if (res.status !== 200) {
    throw new Error('注册失败: ' + JSON.stringify(res.body));
  }
  return res.body.token as string;
}

/** 创建学生，返回学生对象 */
export async function createStudent(token: string, overrides: Record<string, any> = {}) {
  const res = await req('POST', '/api/students', {
    token,
    body: {
      name: '李小明',
      grade: '小学五年级',
      subject: '数学',
      phone: '13900139000',
      notes: '计算能力较弱',
      ...overrides,
    },
  });
  if (res.status !== 200) {
    throw new Error('创建学生失败: ' + JSON.stringify(res.body));
  }
  return res.body.student;
}

/** 创建回访记录 */
export async function createFollowUp(token: string, overrides: Record<string, any> = {}) {
  const content =
    '【课堂内容】本节课围绕异分母分数加减法展开，重点讲解通分的原理与步骤，并结合图形演示帮助理解。' +
    '【学生收获】小明专注度较高，能够主动举手回答问题，对通分方法掌握比较到位，独立完成基础题型准确率良好。' +
    '【课后任务】完成练习册第12页第1-8题，重点巩固通分步骤；每天做10道口算提升计算速度。';

  const res = await req('POST', '/api/followups', {
    token,
    body: {
      studentId: null,
      studentName: '李小明',
      grade: '小学五年级',
      subject: '数学',
      topic: '分数加减法运算',
      performance: '专注度较高',
      mastery: 'good',
      images: [],
      content,
      ...overrides,
    },
  });
  if (res.status !== 200) {
    throw new Error('创建回访失败: ' + JSON.stringify(res.body));
  }
  return res.body.followup;
}

/** 一张合法的 1x1 PNG（用于上传测试） */
export const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/**
 * 返回 Uint8Array，且底层是独立的 ArrayBuffer。
 * Node 的 Buffer 底层可能是 SharedArrayBuffer，无法直接用作 BlobPart，
 * 因此显式复制一份。
 */
export function tinyPngBuffer(): Uint8Array<ArrayBuffer> {
  const src = Buffer.from(TINY_PNG_BASE64, 'base64');
  const out = new Uint8Array(src.byteLength);
  out.set(src);
  return out;
}
