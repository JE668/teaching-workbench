import { useEffect, useRef } from 'react';
import { subscribeAppCommand, type AppCommand } from '../lib/appEvents';

/**
 * 让当前页面响应命令面板 / 全局快捷键派发的命令。
 *
 * handler 每次渲染都会刷新到 ref 里：命令触发的往往是"保存/生成当前表单"，
 * 闭包里必须是最新的表单状态，不能只在挂载时记一次旧闭包。
 */
export function useAppCommand(cmd: AppCommand, handler: () => void, enabled = true): void {
  const ref = useRef(handler);
  ref.current = handler;

  useEffect(() => {
    if (!enabled) return;
    return subscribeAppCommand(cmd, () => ref.current());
  }, [cmd, enabled]);
}
