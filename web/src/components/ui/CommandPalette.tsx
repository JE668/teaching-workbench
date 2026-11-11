import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Keyboard, X } from 'lucide-react';
import { cn } from '../../lib/utils';

interface CommandItem {
  id: string;
  label: string;
  description?: string;
  shortcut?: string;
  group?: string;
  icon?: React.ReactNode;
  onSelect: () => void;
  keywords?: string[]; // 用于模糊搜索
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  items: CommandItem[];
}

export function CommandPalette({ isOpen, onClose, items }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 过滤匹配项
  const filteredItems = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.toLowerCase().trim();
    return items.filter(item =>
      item.label.toLowerCase().includes(q) ||
      item.description?.toLowerCase().includes(q) ||
      item.keywords?.some(k => k.toLowerCase().includes(q)) ||
      item.shortcut?.toLowerCase().includes(q)
    );
  }, [items, query]);

  // 重置选择索引
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // 打开时聚焦输入框
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [isOpen]);

  // 键盘导航
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(i => Math.min(i + 1, filteredItems.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(i => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const item = filteredItems[selectedIndex];
        if (item) {
          item.onSelect();
          onClose();
        }
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, filteredItems, selectedIndex, onClose]);

  // 滚动到选中项
  useEffect(() => {
    const selectedElement = listRef.current?.querySelector(`[data-index="${selectedIndex}"]`);
    selectedElement?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4">
      {/* 背景遮罩 */}
      <div
        className="fixed inset-0 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* 面板 */}
      <div className="relative w-full max-w-2xl bg-white rounded-2xl shadow-xl ring-1 ring-slate-200 overflow-hidden animate-slide-down">
        {/* 搜索输入框 */}
        <div className="relative p-4 border-b border-slate-100">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="输入命令或搜索… (⌘K 打开，Esc 关闭)"
              className="w-full pl-10 pr-10 py-3 text-sm bg-slate-50 border-0 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500 focus:bg-white transition"
              autoComplete="off"
              spellCheck={false}
            />
            <kbd className="absolute right-3 top-1/2 -translate-y-1/2 px-2 py-0.5 text-[10px] font-mono text-slate-400 bg-slate-100 rounded">
              <Keyboard className="h-3 w-3 inline-block align-middle mr-0.5" />
              K
            </kbd>
          </div>
        </div>

        {/* 结果列表 */}
        <div
          ref={listRef}
          className="max-h-[60vh] overflow-auto p-2"
          role="listbox"
          aria-label="命令面板"
        >
          {filteredItems.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-slate-400">
              <p>没有匹配的命令</p>
              <p className="mt-1 text-xs">尝试调整关键词或按 <kbd className="px-1.5 py-0.5 text-[10px] bg-slate-100 rounded">Esc</kbd> 关闭</p>
            </div>
          ) : (
            <>
              {(() => {
                // 按分组渲染
                const groups = new Map<string, CommandItem[]>();
                for (const item of filteredItems) {
                  const group = item.group || '通用';
                  if (!groups.has(group)) groups.set(group, []);
                  groups.get(group)!.push(item);
                }
                return Array.from(groups.entries()).map(([groupName, groupItems]) => (
                  <div key={groupName} className="mb-2">
                    <div className="px-3 py-1.5 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                      {groupName}
                    </div>
                    {groupItems.map((item) => (
                      <button
                        key={item.id}
                        data-index={filteredItems.indexOf(item)}
                        onClick={() => {
                          item.onSelect();
                          onClose();
                        }}
                        onMouseEnter={() => setSelectedIndex(filteredItems.indexOf(item))}
                        className={cn(
                          'w-full px-3 py-2.5 rounded-xl text-left transition-colors',
                          filteredItems.indexOf(item) === selectedIndex
                            ? 'bg-brand-50 text-slate-900 ring-1 ring-brand-200'
                            : 'text-slate-700 hover:bg-slate-50'
                        )}
                        role="option"
                        aria-selected={filteredItems.indexOf(item) === selectedIndex}
                      >
                        <div className="flex items-center gap-3">
                          {item.icon && (
                            <span className="flex-shrink-0 h-5 w-5 text-slate-400">
                              {item.icon}
                            </span>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="font-medium truncate">{item.label}</div>
                            {item.description && (
                              <div className="text-xs text-slate-400 truncate">{item.description}</div>
                            )}
                          </div>
                          {item.shortcut && (
                            <kbd className="flex-shrink-0 px-2 py-0.5 text-[10px] font-mono text-slate-400 bg-slate-100 rounded">
                              {formatShortcut(item.shortcut)}
                            </kbd>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                ));
              })()}
            </>
          )}
        </div>

        {/* 底部提示 */}
        <div className="px-4 py-3 border-t border-slate-100 bg-slate-50/50">
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span>↑↓ 选择  ·  Enter 执行  ·  Esc 关闭</span>
            <span className="flex items-center gap-1">
              <X className="h-3 w-3" />
              <span>⌘K</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 格式化快捷键显示：mod+k → ⌘K */
function formatShortcut(shortcut: string): string {
  return shortcut
    .replace(/mod\+/gi, '⌘')
    .replace(/ctrl\+/gi, 'Ctrl+')
    .replace(/shift\+/gi, '⇧')
    .replace(/alt\+/gi, '⌥')
    .replace(/meta\+/gi, '⌘')
    .replace(/\+/g, '')
    .toUpperCase()
    .replace(/KEYX/gi, '');
}