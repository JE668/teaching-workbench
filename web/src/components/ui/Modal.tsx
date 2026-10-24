import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const sizes = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

export default function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: ModalProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  /** 拖拽位置：组件级 ref，每个弹窗实例独立，互不干扰 */
  const dragState = useRef<{ pos: { x: number; y: number } | null }>({ pos: null });
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(dragState.current.pos);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ mx: number; my: number; ox: number; oy: number } | null>(null);

  // 弹窗关闭时重置
  useEffect(() => {
    if (!open) {
      dragState.current.pos = null;
      setOffset(null);
      setDragging(false);
    }
  }, [open]);

  // 拖拽跟随
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // 点击关闭按钮时不拖拽
      if ((e.target as HTMLElement).closest('[data-modal-close]')) return;
      e.preventDefault();
      const ox = offset?.x ?? 0;
      const oy = offset?.y ?? 0;
      dragStart.current = { mx: e.clientX, my: e.clientY, ox, oy };
      setDragging(true);
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    },
    [offset]
  );

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const s = dragStart.current;
      if (!s) return;
      const nx = s.ox + (e.clientX - s.mx);
      const ny = s.oy + (e.clientY - s.my);
      dragState.current.pos = { x: nx, y: ny };
      setOffset({ x: nx, y: ny });
    };
    const onUp = () => {
      setDragging(false);
      dragStart.current = null;
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
  }, [dragging]);

  // ESC 关闭 + 锁定滚动
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  const hasHeader = !!(title || description);
  const style = offset ? { transform: `translate(${offset.x}px, ${offset.y}px)` } : undefined;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />
      <div
        ref={boxRef}
        className={cn(
          'relative flex w-full flex-col overflow-hidden rounded-2xl bg-white shadow-2xl',
          sizes[size],
          'max-h-[calc(100vh-2rem)]',
          !dragging && 'animate-scale-in'
        )}
        style={style}
      >
        {hasHeader && (
          <div
            className={cn(
              'flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-4',
              'select-none',
              dragging ? 'cursor-grabbing' : 'cursor-grab'
            )}
            onPointerDown={onPointerDown}
          >
            <div>
              {title && <h2 className="text-lg font-semibold text-slate-800">{title}</h2>}
              {description && <p className="mt-0.5 text-sm text-slate-400">{description}</p>}
            </div>
            <button
              data-modal-close
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
              style={{ pointerEvents: 'auto' }}
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && (
          <div className="flex justify-end gap-3 border-t border-slate-100 bg-slate-50/60 px-6 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
