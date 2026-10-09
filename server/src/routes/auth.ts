import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from '../config/database.js';
import { env } from '../config/env.js';
import { authMiddleware } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { setMediaCookie, clearMediaCookie } from '../middleware/mediaAuth.js';
import { mapUser } from '../utils/mappers.js';

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
router.post('/register', authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码为必填项' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: '密码长度至少6位' });
    }

    // 检查用户名是否已存在
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) {
      return res.status(409).json({ error: '用户名已被注册' });
    }

    // 创建用户
    const hashedPassword = bcrypt.hashSync(password, 10);
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
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码为必填项' });
    }

    // 查找用户
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as any;
    if (!user) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    // 验证密码
    if (!bcrypt.compareSync(password, user.password)) {
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
router.put('/password', authMiddleware, (req: any, res) => {
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

    const user = db.prepare('SELECT id, password FROM users WHERE id = ?').get(req.userId) as any;
    if (!user) return res.status(404).json({ error: '用户不存在' });

    if (!bcrypt.compareSync(String(currentPassword), user.password)) {
      return res.status(401).json({ error: '当前密码不正确' });
    }

    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(
      bcrypt.hashSync(String(newPassword), 10),
      user.id
    );

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: '修改密码失败', message: error.message });
  }
});

/** 可同步的用户偏好（手机与电脑保持一致） */
const DEFAULT_PREFERENCES = {
  /** 快捷短语模式：mixed = 历史 + 内置通用词；history_only = 只用我的历史 */
  phraseMode: 'mixed' as 'mixed' | 'history_only',
  /** 工作台「待回访」的默认天数 */
  pendingDays: 7,
};

function readPreferences(userId: number): typeof DEFAULT_PREFERENCES {
  const row = db.prepare('SELECT preferences FROM users WHERE id = ?').get(userId) as any;
  let saved: any = {};
  try {
    saved = row?.preferences ? JSON.parse(row.preferences) : {};
  } catch {
    saved = {}; // 脏数据按默认处理
  }

  return {
    phraseMode: saved.phraseMode === 'history_only' ? 'history_only' : 'mixed',
    pendingDays: Math.min(365, Math.max(1, parseInt(saved.pendingDays, 10) || 7)),
  };
}

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
    const current = readPreferences(userId);
    const incoming = req.body || {};

    // 只接受已知字段，避免把任意内容写进去
    const next = {
      phraseMode:
        incoming.phraseMode === 'history_only'
          ? 'history_only'
          : incoming.phraseMode === 'mixed'
          ? 'mixed'
          : current.phraseMode,
      // 非正数/非数字一律视为非法，回落到默认 7（规则简单可预期）
      pendingDays: (() => {
        if (incoming.pendingDays === undefined) return current.pendingDays;
        const parsed = parseInt(incoming.pendingDays, 10);
        if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_PREFERENCES.pendingDays;
        return Math.min(365, parsed);
      })(),
    };

    db.prepare('UPDATE users SET preferences = ? WHERE id = ?').run(JSON.stringify(next), userId);
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
