/**
 * 浏览器网络状态。
 *
 * 手机上信号经常不好：掉线时如果页面还是安安静静等报错，
 * 用户会以为是数据坏了。这里把状态暴露出来，供离线提示条用。
 */

export function getOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine;
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
  return () => {
    window.removeEventListener('online', emit);
    window.removeEventListener('offline', emit);
  };
}
