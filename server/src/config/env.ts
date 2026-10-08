import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const DATA_DIR = path.resolve(__dirname, '../../data');
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
  PORT: parseInt(process.env.PORT || '3000', 10),
  HOST: process.env.HOST || '0.0.0.0',
  JWT_SECRET: resolveJwtSecret(),
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  SENSENOVA_API_KEY: process.env.SENSENOVA_API_KEY || '',
  SENSENOVA_BASE_URL: process.env.SENSENOVA_BASE_URL || 'https://token.sensenova.cn/v1',
  SENSENOVA_MODEL: process.env.SENSENOVA_MODEL || 'sensenova-6.8-flash-lite',
  SENSENOVA_REASONING_EFFORT: resolveReasoningEffort(),
  // 单次请求超时（毫秒）。SDK 默认 10 分钟，对交互式生成过长，这里收紧到 60s。
  SENSENOVA_TIMEOUT_MS: parseInt(process.env.SENSENOVA_TIMEOUT_MS || '60000', 10),
  DEFAULT_ADMIN_USER: process.env.DEFAULT_ADMIN_USER || 'admin',
  DEFAULT_ADMIN_PASS,
  CORS_ORIGINS: process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:3000',
  UPLOAD_DIR: path.resolve(DATA_DIR, 'uploads'),
  DATA_DIR,
};
