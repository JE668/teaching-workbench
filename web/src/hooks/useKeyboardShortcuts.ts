import { useEffect, useRef, useCallback } from 'react';

interface KeyboardShortcut {
  /** 快捷键字符串，如 'mod+k'、'g s'、'shift+enter' */
  key: string;
  /** 回调函数 */
  onTrigger: () => void;
  /** 描述，用于命令面板显示 */
  description: string;
  /** 分组，用于命令面板分类 */
  group?: string;
  /** 是否在输入框/文本域中禁用 */
  disableInInput?: boolean;
}

/** 解析快捷键字符串为标准化格式 */
function parseShortcut(key: string): { keys: string[]; sequence?: string[] } {
  // 支持序列键：'g s' 表示先按 g 再按 s
  if (key.includes(' ')) {
    return { keys: [], sequence: key.split(' ').map(k => k.trim().toLowerCase()) };
  }
  return { keys: key.toLowerCase().split('+'), sequence: undefined };
}

/** 检查当前按键是否匹配快捷键 */
function matchesShortcut(event: KeyboardEvent, shortcut: { keys: string[]; sequence?: string[] }): boolean {
  if (shortcut.sequence) {
    // 序列键暂不在此处处理，由外层状态机管理
    return false;
  }
  const pressed = new Set<string>();
  if (event.ctrlKey || event.metaKey) pressed.add('mod');
  if (event.shiftKey) pressed.add('shift');
  if (event.altKey) pressed.add('alt');
  if (event.key !== 'Control' && event.key !== 'Shift' && event.key !== 'Alt' && event.key !== 'Meta') {
    pressed.add(event.key.toLowerCase());
  }
  return shortcut.keys.length === pressed.size && shortcut.keys.every(k => pressed.has(k));
}

/** 全局快捷键注册 Hook
 *  - 自动处理 mod (Ctrl/Meta)、shift、alt 修饰键
 *  - 支持序列键（如 'g s' 先按 g 再按 s）
 *  - 可选在输入框中禁用
 *  - 返回注册的快捷键列表供命令面板使用
 */
export function useKeyboardShortcuts(shortcuts: KeyboardShortcut[]) {
  const shortcutsRef = useRef(shortcuts);
  shortcutsRef.current = shortcuts;

  // 序列键状态机
  const sequenceStateRef = useRef<{ buffer: string[]; timeout: ReturnType<typeof setTimeout> | null }>({
    buffer: [],
    timeout: null,
  });

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    const activeElement = document.activeElement;
    const isInput = activeElement instanceof HTMLInputElement ||
                    activeElement instanceof HTMLTextAreaElement ||
                    activeElement?.getAttribute('contenteditable') === 'true';

    for (const shortcut of shortcutsRef.current) {
      // 检查是否在输入框中禁用
      if (shortcut.disableInInput && isInput) continue;

      const parsed = parseShortcut(shortcut.key);

      // 字母序列键特别容易和正常打字冲突（例如输入 "g f"），任何输入场景都不启用。
      if (parsed.sequence && isInput) continue;

      if (parsed.sequence) {
        // 序列键处理：'g s' -> 先按 g，再按 s
        const expectedKey = parsed.sequence[sequenceStateRef.current.buffer.length];
        const actualKey = event.key.toLowerCase();

        if (actualKey === expectedKey) {
          sequenceStateRef.current.buffer.push(actualKey);

          // 清除之前的超时
          if (sequenceStateRef.current.timeout) {
            clearTimeout(sequenceStateRef.current.timeout);
          }

          // 如果序列完成
          if (sequenceStateRef.current.buffer.length === parsed.sequence.length) {
            shortcut.onTrigger();
            sequenceStateRef.current.buffer = [];
          } else {
            // 设置超时，2 秒内未完成则重置
            sequenceStateRef.current.timeout = setTimeout(() => {
              sequenceStateRef.current.buffer = [];
            }, 2000);
          }
          event.preventDefault();
          return;
        } else if (actualKey !== 'control' && actualKey !== 'shift' && actualKey !== 'alt' && actualKey !== 'meta') {
          // 按错键，重置缓冲区
          sequenceStateRef.current.buffer = [];
        }
      } else {
        // 普通组合键
        if (matchesShortcut(event, parsed)) {
          event.preventDefault();
          shortcut.onTrigger();
          return;
        }
      }
    }
  }, []);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (sequenceStateRef.current.timeout) {
        clearTimeout(sequenceStateRef.current.timeout);
      }
    };
  }, [handleKeyDown]);

  // 返回所有快捷键信息，供命令面板显示
  return shortcuts;
}

/** 常用快捷键预设 */
export const COMMON_SHORTCUTS = {
  COMMAND_PALETTE: 'mod+k',
  SAVE: 'mod+s',
  GENERATE: 'mod+enter',
  SEARCH: 'mod+f',
  NEW_RECORD: 'mod+n',
} as const;
