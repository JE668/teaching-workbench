import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from '../config/database.js';
import { env } from '../config/env.js';
import { UserPublic } from '../types/index.js';

const router = Router();

// 注册
router.post('/register', async (req, res) => {
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
    const user = db.prepare('SELECT id, username, created_at FROM users WHERE id = ?').get(userId) as UserPublic;

    const token = jwt.sign({ userId }, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN } as jwt.SignOptions);

    res.json({ token, user });
  } catch (error: any) {
    res.status(500).json({ error: '注册失败', message: error.message });
  }
});

// 登录
router.post('/login', async (req, res) => {
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

    const publicUser: UserPublic = {
      id: user.id,
      username: user.username,
      createdAt: user.created_at,
    };

    const token = jwt.sign({ userId: user.id }, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN } as jwt.SignOptions);

    res.json({ token, user: publicUser });
  } catch (error: any) {
    res.status(500).json({ error: '登录失败', message: error.message });
  }
});

// 获取当前用户信息
router.get('/me', (req: any, res) => {
  try {
    const userId = req.userId;
    const user = db.prepare('SELECT id, username, created_at FROM users WHERE id = ?').get(userId) as UserPublic;
    res.json({ user });
  } catch (error: any) {
    res.status(500).json({ error: '获取用户信息失败', message: error.message });
  }
});

export default router;
