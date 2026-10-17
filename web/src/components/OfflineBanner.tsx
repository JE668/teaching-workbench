import React, { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { getOnline, listenOnlineState } from '../lib/network';

/**
 * 离线提示条。
 *
 * 手机信号差时，如果界面一言不发，用户只会以为"数据坏了"。
 * 这里把状态说清楚：哪些还能看，哪些必须联网。
 */
export function OfflineBanner() {
  const [online, setOnline] = useState(getOnline);

  useEffect(() => listenOnlineState(setOnline), []);

  if (online) return null;

  return (
    <div
      role="status"
      className="mb-4 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm leading-snug text-amber-800"
    >
      <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
      <span>
        网络不可用：已打开的页面还能查看，但登录、保存、上传图片、AI 生成等操作需要联网
      </span>
    </div>
  );
}
