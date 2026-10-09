import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';

/**
 * 用户偏好（服务端保存）。
 *
 * 存服务端而非 localStorage：手机与电脑需要一致，
 * 而这两个设备是不同步 localStorage 的。
 */

export interface Preferences {
  /** 快捷短语模式：mixed = 历史 + 内置通用词；history_only = 只用我的历史 */
  phraseMode: 'mixed' | 'history_only';
  /** 工作台「待回访」的默认天数 */
  pendingDays: number;
}

const DEFAULTS: Preferences = {
  phraseMode: 'mixed',
  // 一周一次课的节奏：7 天刚到期就提醒
  pendingDays: 7,
};

export function usePreferences() {
  const [preferences, setPreferences] = useState<Preferences>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .get('/auth/preferences')
      .then((r) => {
        if (alive && r?.preferences) setPreferences({ ...DEFAULTS, ...r.preferences });
      })
      .catch(() => {
        /* 读取失败就用默认值，不打扰用户 */
      })
      .finally(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  /** 乐观更新：先改界面，再落库；失败则回滚 */
  const update = useCallback(
    async (partial: Partial<Preferences>) => {
      const previous = preferences;
      const next = { ...preferences, ...partial };
      setPreferences(next);

      try {
        const r = await api.put('/auth/preferences', next);
        if (r?.preferences) setPreferences({ ...DEFAULTS, ...r.preferences });
      } catch {
        setPreferences(previous);
      }
    },
    [preferences]
  );

  return { preferences, loaded, update };
}
