import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// 数据目录：允许通过 DATA_DIR 覆盖，便于测试隔离与自定义挂载路径
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(__dirname, '../../data');
const SECRET_FILE = path.join(DATA_DIR, '.jwt_secret');

// 源码中公开的占位密钥，绝不能在运行中使用
const INSECURE_DEFAULT = 'teaching-workbench-secret-key-change-in-production';

/**
 * 解析 JWT 密钥。
 * 优先级：环境变量（非占位值） > 数据卷中已持久化的密钥 > 新生成并持久化。
 * 这样即使忘记配置，也不会退回到源码里公开的默认密钥。
 */
function resolveJwtSecret(): string {
  const fromEnv = (process.env.JWT_SECRET || '').trim();

  if (fromEnv && fromEnv !== INSECURE_DEFAULT) {
    return fromEnv;
  }

  // 复用数据卷中已持久化的密钥（重启/更新镜像后会话不失效）
  try {
    if (fs.existsSync(SECRET_FILE)) {
      const saved = fs.readFileSync(SECRET_FILE, 'utf8').trim();
      if (saved) {
        console.warn('[SECURITY] 未设置 JWT_SECRET，正在使用 data/.jwt_secret 中已持久化的自动生成密钥');
        return saved;
      }
    }
  } catch (err: any) {
    console.warn('[SECURITY] 读取 .jwt_secret 失败: ' + err.message);
  }

  // 自动生成强随机密钥并持久化
  const generated = crypto.randomBytes(32).toString('hex');
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SECRET_FILE, generated, { mode: 0o600 });
    console.warn(
      '[SECURITY] 未检测到 JWT_SECRET，已自动生成强随机密钥并保存到 data/.jwt_secret。\n' +
      '           如需自行管理，请在 .env 中设置 JWT_SECRET（openssl rand -hex 32）。'
    );
  } catch (err: any) {
    console.warn(
      '[SECURITY] 已为本次进程生成临时密钥，但持久化失败: ' + err.message + '\n' +
      '           容器重启后登录状态会失效，建议显式设置 JWT_SECRET。'
    );
    return generated;
  }

  return generated;
}

/**
 * 思考强度。官方取值：none / low / medium / high / max（默认 high）。
 * 本任务需要同时满足"三段结构 + 字数区间 + 结合图片"，属中等复杂度约束生成，
 * 全关（none）会导致首次通过率偏低，故默认 low，兼顾速度与遵循度。
 */
const REASONING_EFFORTS = ['none', 'low', 'medium', 'high', 'max'];

function resolveReasoningEffort(): string {
  const raw = (process.env.SENSENOVA_REASONING_EFFORT || '').trim().toLowerCase();
  if (REASONING_EFFORTS.includes(raw)) {
    return raw;
  }
  if (raw) {
    console.warn(
      '[AI] SENSENOVA_REASONING_EFFORT 取值无效: "' + raw + '"，可选 ' +
        REASONING_EFFORTS.join('/') + '，已回退为 low'
    );
  }
  return 'low';
}

const DEFAULT_ADMIN_PASS = process.env.DEFAULT_ADMIN_PASS || '123456';

// 弱口令告警
if (['123456', 'password', 'admin', ''].includes(DEFAULT_ADMIN_PASS)) {
  console.warn('[SECURITY] 管理员密码仍为弱口令，请尽快在 .env 中修改 DEFAULT_ADMIN_PASS');
}

export const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '3000', 10),
  HOST: process.env.HOST || '0.0.0.0',
  JWT_SECRET: resolveJwtSecret(),
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  SENSENOVA_API_KEY: process.env.SENSENOVA_API_KEY || '',
  SENSENOVA_BASE_URL: process.env.SENSENOVA_BASE_URL || 'https://token.sensenova.cn/v1',
  SENSENOVA_MODEL: process.env.SENSENOVA_MODEL || 'sensenova-6.8-flash-lite',
  // Gemini 转发代理（boss 自建，OpenAI 兼容层）。key 在设置页填，env 只做兜底。
  // 接口地址没有默认值：自建代理域名由用户在部署机 .env 显式配置，代码里不留，
  // 避免把自建域名带进仓库。
  GEMINI_PROXY_BASE_URL: process.env.GEMINI_PROXY_BASE_URL || '',
  GEMINI_PROXY_API_KEY: process.env.GEMINI_PROXY_API_KEY || '',
  GEMINI_PROXY_MODEL: process.env.GEMINI_PROXY_MODEL || 'gemini-3.8-flash',
  SENSENOVA_REASONING_EFFORT: resolveReasoningEffort(),
  // 单次请求超时（毫秒）。SDK 默认 10 分钟，对交互式生成过长，这里收紧到 60s。
  SENSENOVA_TIMEOUT_MS: parseInt(process.env.SENSENOVA_TIMEOUT_MS || '60000', 10),
  // 流式生成空闲超时（毫秒）。SDK 的 timeout 只管连接/首响应；若上游在流中途挂住
  // （不发 chunk 也不关连接），for await 循环会永久挂起、把并发闸门的槽永久占死，
  // 后续所有 AI 请求排队到熔断 —— 单实例下拖垮全部 AI 能力。这里按「相邻 chunk
  // 最大间隔」设空闲中断，正在正常产出的慢生成不受影响（只要还在吐字就复位）。
  AI_STREAM_IDLE_TIMEOUT_MS: parseInt(process.env.AI_STREAM_IDLE_TIMEOUT_MS || '60000', 10),
  DEFAULT_ADMIN_USER: process.env.DEFAULT_ADMIN_USER || 'admin',
  DEFAULT_ADMIN_PASS,
  CORS_ORIGINS: process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:3000',
  UPLOAD_DIR: path.resolve(DATA_DIR, 'uploads'),
  DATA_DIR,
  // Tesseract OCR 语言数据目录（CI 中需下载 chi_sim.traineddata、eng.traineddata）
  TESSDATA_PREFIX: process.env.TESSDATA_PREFIX || path.resolve(DATA_DIR, 'tessdata'),
  // /metrics 访问口令。留空时仅开发/测试环境开放；生产环境（NODE_ENV=production）
  // 端点直接 404 —— 防止反代把整个域名暴露出去时泄露运行指标。生产要开监控
  // 就显式设置该变量（openssl rand -hex 16 即可）。
  METRICS_TOKEN: (process.env.METRICS_TOKEN || '').trim(),
  // AI 指标保留天数。ai_metrics 只写不删会无限增长（拖慢 /metrics 抓取与占盘），
  // 超过保留期的运营遥测行定期删除。默认 90 天。
  AI_METRICS_RETAIN_DAYS: parseInt(process.env.AI_METRICS_RETAIN_DAYS || '90', 10),
};
