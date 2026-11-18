/**
 * 浏览器网络状态。
 *
 * 手机上信号经常不好：掉线时如果页面还是安安静静等报错，
 * 用户会以为是数据坏了。这里把状态暴露出来，供离线提示条用。
 *
 * W13: navigator.onLine 只反映网络接口状态（Wi-Fi 连着但服务器宕机时仍返回 true）。
 * 这里叠加 /api/health 心跳：连续 2 次失败判定为离线，恢复任一次即判定为在线。
 * 心跳只在 document.visible 时才跑，避免后台标签页浪费流量。
 */

const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 3_000;
const FAIL_THRESHOLD = 2;

export function getOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine;
}

let heartbeatFailures = 0;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
const heartbeatListeners = new Set<(online: boolean) => void>();

async function ping(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEARTBEAT_TIMEOUT_MS);
    const res = await fetch('/api/health', { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

function emitOnline(online: boolean) {
  heartbeatListeners.forEach((fn) => fn(online));
}

async function heartbeat() {
  if (document.visibilityState !== 'visible') return;
  const ok = await ping();
  if (ok) {
    if (heartbeatFailures >= FAIL_THRESHOLD) emitOnline(true);
    heartbeatFailures = 0;
  } else {
    heartbeatFailures++;
    if (heartbeatFailures >= FAIL_THRESHOLD) emitOnline(false);
  }
}

/**
 * 订阅网络状态变化，返回取消订阅函数。
 * 调用时立刻回调一次当前状态，方便首帧就渲染对。
 */
export function listenOnlineState(onChange: (online: boolean) => void): () => void {
  const emit = () => onChange(getOnline());
  emit();
  window.addEventListener('online', emit);
  window.addEventListener('offline', emit);
  heartbeatListeners.add(onChange);

  // 启动心跳（首次使用时启动，最后一个订阅者取消时停止）
  if (!heartbeatTimer) {
    heartbeatTimer = setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);
  }

  return () => {
    window.removeEventListener('online', emit);
    window.removeEventListener('offline', emit);
    heartbeatListeners.delete(onChange);
    if (heartbeatListeners.size === 0 && heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
      heartbeatFailures = 0;
    }
  };
}
