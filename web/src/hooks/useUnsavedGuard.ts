import { useEffect } from 'react';

/**
 * 未保存改动离开守卫（beforeunload）。
 *
 * 为什么需要：ReportEdit / ObservationEdit / FollowUp 三个编辑页都没有任何
 * 离开提示。虽然它们有草稿落盘/失焦自动保存兜底，但「正在流式生成」或
 * 「刚粘贴一大段还没触发保存」的窗口里，刷新/关标签就是真丢内容。
 *
 * 用法：useUnsavedGuard(hasUnsavedChanges)。
 * 浏览器限制：beforeunload 只能弹原生确认框（不能自定义文案），
 * 且需要用户与本页有过交互；这是可接受的最小代价。
 */
export function useUnsavedGuard(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // 现代浏览器忽略返回值，但必须设置 returnValue 才会弹出确认框
      e.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);
}
