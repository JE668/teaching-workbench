import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from '../config/database.js';
import { env } from '../config/env.js';
import { authMiddleware } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { setMediaCookie, clearMediaCookie } from '../middleware/mediaAuth.js';
import { mapUser } from '../utils/mappers.js';
import { validateBody } from '../utils/validation.js';
import { registerSchema, loginSchema, changePasswordSchema } from '../utils/schemas.js';
import { readPreferences, normalizePreferences, savePreferences } from '../services/preferences.js';

/** users 表完整行结构 */
interface UserRow {
  id: number;
  username: string;
  password: string;
  preferences: string | null;
  created_at: string;
}

const router = Router();

// 登录/注册限流：15 分钟内同一 IP 最多 20 次【失败】尝试，防止暴力破解。
// 只统计失败：正常用户反复登录（如网络抖动重试）不会被误锁。
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: '登录尝试过于频繁，请 15 分钟后再试',
  countOnlyFailures: true,
});

// 注册
router.post('/register', authLimiter, validateBody(registerSchema), async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码为必填项' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: '密码长度至少6位' });
    }

    // 用户名会作为图片归档的目录名，必须保证可安全用作路径片段。
    // 允许：中文/字母/数字/下划线/连字符/点；禁止其它符号与过长名字。
    if (String(username).length < 2 || String(username).length > 32) {
      return res.status(400).json({ error: '用户名长度需在 2-32 位之间' });
    }
    if (!/^[\w\u4e00-\u9fa5.-]+$/.test(String(username))) {
      return res.status(400).json({
        error: '用户名只能包含中文、字母、数字、下划线、连字符和点',
      });
    }

    // 检查用户名是否已存在
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) {
      return res.status(409).json({ error: '用户名已被注册' });
    }

    // 创建用户
    // bcrypt 是刻意设计成慢的（cost=10 约几十毫秒）。用 *Sync 会把这几十毫秒
    // 完全钉在事件循环上：注册、登录、改密期间，其它用户的请求全部排队。
    // 一律走异步版本，把 CPU 让回 libuv 线程池。
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run(username, hashedPassword);

    const userId = result.lastInsertRowid;
    const user = mapUser(db.prepare('SELECT id, username, created_at FROM users WHERE id = ?').get(userId));

    const token = jwt.sign({ userId }, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN } as jwt.SignOptions);

    // 图片走 <img src>，无法带 Authorization 头，因此额外下发签名 cookie
    setMediaCookie(req, res, Number(userId));

    res.json({ token, user });
  } catch (error: any) {
    res.status(500).json({ error: '注册失败', message: error.message });
  }
});

// 登录
router.post('/login', authLimiter, validateBody(loginSchema), async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码为必填项' });
    }

    // 查找用户
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined;
    if (!user) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    // 验证密码（异步，理由同上）
    if (!(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    const publicUser = mapUser(user);

    const token = jwt.sign({ userId: user.id }, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN } as jwt.SignOptions);

    // 图片走 <img src>，无法带 Authorization 头，因此额外下发签名 cookie
    setMediaCookie(req, res, Number(user.id));

    res.json({ token, user: publicUser });
  } catch (error: any) {
    res.status(500).json({ error: '登录失败', message: error.message });
  }
});

/**
 * 修改密码。
 * 必须校验当前密码 —— 否则 token 泄露后可直接改密码夺取账号。
 */
router.put('/password', authMiddleware, validateBody(changePasswordSchema), async (req: any, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: '请填写当前密码与新密码' });
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({ error: '新密码长度至少 6 位' });
    }
    if (currentPassword === newPassword) {
      return res.status(400).json({ error: '新密码不能与当前密码相同' });
    }

    const user = db.prepare('SELECT id, password FROM users WHERE id = ?').get(req.userId) as { id: number; password: string } | undefined;
    if (!user) return res.status(404).json({ error: '用户不存在' });

    if (!(await bcrypt.compare(String(currentPassword), user.password))) {
      return res.status(401).json({ error: '当前密码不正确' });
    }

    const hashedPassword = await bcrypt.hash(String(newPassword), 10);
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashedPassword, user.id);

    // 改密即吊销：记录改密时刻（秒），authMiddleware 会拒签发时间早于它的令牌。
    // 当前请求自带的令牌也是旧的 —— 前端收到 401 后统一走重新登录。
    db.prepare('UPDATE users SET token_valid_after = ? WHERE id = ?').run(
      Math.floor(Date.now() / 1000),
      user.id
    );

    clearMediaCookie(res);

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: '修改密码失败', message: error.message });
  }
});


router.get('/preferences', authMiddleware, (req: any, res) => {
  try {
    res.json({ preferences: readPreferences(req.userId) });
  } catch (error: any) {
    res.status(500).json({ error: '读取偏好失败', message: error.message });
  }
});

router.put('/preferences', authMiddleware, (req: any, res) => {
  try {
    const userId = req.userId;
    const next = normalizePreferences(req.body, readPreferences(userId));
    savePreferences(userId, next);
    res.json({ preferences: next });
  } catch (error: any) {
    res.status(500).json({ error: '保存偏好失败', message: error.message });
  }
});

// 登出（清除图片访问 cookie）
// 注意：JWT 存在 localStorage，由前端清除；此接口只负责收回图片访问凭证，
// 否则共用设备上登出后仍能直接打开图片 URL。
router.post('/logout', (req, res) => {
  clearMediaCookie(res);
  res.json({ success: true });
});

// 获取当前用户信息（需要登录）
router.get('/me', authMiddleware, (req: any, res) => {
  try {
    const userId = req.userId;
    const user = mapUser(db.prepare('SELECT id, username, created_at FROM users WHERE id = ?').get(userId));
    res.json({ user });
  } catch (error: any) {
    res.status(500).json({ error: '获取用户信息失败', message: error.message });
  }
});

export default router;
