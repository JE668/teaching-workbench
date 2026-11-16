import { db } from '../config/database.js';

/**
 * 用户偏好：读写逻辑的唯一实现。
 *
 * 抽成 service 的原因有两个：
 *  1. 这里是 auth 路由与 observations 路由的公共依赖 —— 之前 observations.ts 反过来
 *     import routes/auth.js（路由层之间的反向依赖），改一处路由就可能连环影响另一处；
 *  2. 偏好字段的「白名单 + 夹取」规则集中在一处，新增字段不用在读写两端各改一遍。
 */

/** 可同步的用户偏好（手机与电脑保持一致） */
export const DEFAULT_PREFERENCES = {
  /** 快捷短语模式：mixed = 历史 + 内置通用词；history_only = 只用我的历史 */
  phraseMode: 'mixed' as 'mixed' | 'history_only',
  /** 工作台「待回访」的默认天数 */
  pendingDays: 7,
  /** 听评课 Word 里的评课人签名（未填时回落到登录用户名） */
  signature: '' as string,
  /** 导航序列键（g f 等）。默认关闭：老师常在输入框打字，字母序列容易误跳页 */
  navShortcutsEnabled: false as boolean,
};

export type UserPreferences = typeof DEFAULT_PREFERENCES;

/** 签名最多 20 字：这是要落进正式报送表的，长文本没有意义 */
export const SIGNATURE_MAX = 20;

/** 读取偏好：库里是 JSON 文本，任何解析失败/字段类型不符都回落到默认值 */
export function readPreferences(userId: number): UserPreferences {
  const row = db.prepare('SELECT preferences FROM users WHERE id = ?').get(userId) as { preferences: string | null } | undefined;
  let saved: any = {};
  try {
    saved = row?.preferences ? JSON.parse(row.preferences) : {};
  } catch {
    saved = {}; // 脏数据按默认处理
  }

  return {
    phraseMode: saved.phraseMode === 'history_only' ? 'history_only' : 'mixed',
    pendingDays: Math.min(365, Math.max(1, parseInt(saved.pendingDays, 10) || 7)),
    signature: typeof saved.signature === 'string' ? saved.signature.slice(0, SIGNATURE_MAX) : '',
    navShortcutsEnabled: saved.navShortcutsEnabled === true,
  };
}

/** 合并客户端提交的字段：只接受已知字段，非法值按「保持原值 / 回落默认」处理 */
export function normalizePreferences(incoming: any, current: UserPreferences): UserPreferences {
  const body = incoming || {};
  return {
    phraseMode:
      body.phraseMode === 'history_only' ? 'history_only' : body.phraseMode === 'mixed' ? 'mixed' : current.phraseMode,
    // 非正数/非数字一律视为非法，回落到默认 7（规则简单可预期）
    pendingDays: (() => {
      if (body.pendingDays === undefined) return current.pendingDays;
      const parsed = parseInt(body.pendingDays, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_PREFERENCES.pendingDays;
      return Math.min(365, parsed);
    })(),
    // 空字符串合法（表示"先不填，用登录名"）
    signature:
      typeof body.signature === 'string' ? body.signature.trim().slice(0, SIGNATURE_MAX) : current.signature,
    navShortcutsEnabled:
      body.navShortcutsEnabled === undefined ? current.navShortcutsEnabled : body.navShortcutsEnabled === true,
  };
}

export function savePreferences(userId: number, next: UserPreferences): void {
  db.prepare('UPDATE users SET preferences = ? WHERE id = ?').run(JSON.stringify(next), userId);
}
