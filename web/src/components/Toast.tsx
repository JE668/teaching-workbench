import React, { useState, useEffect, useCallback } from 'react';

/**
 * 通知 Toast 组件
 * 支持多种类型、自动消失、手动关闭、堆叠显示
 */
export interface Toast {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info' | 'refresh';
  title: string;
  message?: string;
  duration?: number; // 0 = 不自动关闭
  action?: { label: string; onClick: () => void };
  persistent?: boolean;
}

interface ToastContainerProps {
  toasts: Toast[];
  onClose: (id: string) => void;
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'top-center' | 'bottom-center';
  maxToasts?: number;
}

const positionClasses = {
  'top-right': 'top-4 right-4',
  'top-left': 'top-4 left-4',
  'bottom-right': 'bottom-4 right-4',
  'bottom-left': 'bottom-4 left-4',
  'top-center': 'top-4 left-1/2 -translate-x-1/2',
  'bottom-center': 'bottom-4 left-1/2 -translate-x-1/2',
};

const typeStyles = {
  success: 'bg-green-50 border-green-200 text-green-800 dark:bg-green-900/30 dark:border-green-800 dark:text-green-200',
  error: 'bg-red-50 border-red-200 text-red-800 dark:bg-red-900/30 dark:border-red-800 dark:text-red-200',
  warning: 'bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-900/30 dark:border-amber-800 dark:text-amber-200',
  info: 'bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-900/30 dark:border-blue-800 dark:text-blue-200',
  refresh: 'bg-indigo-50 border-indigo-200 text-indigo-800 dark:bg-indigo-900/30 dark:border-indigo-800 dark:text-indigo-200',
};

const typeIcons = {
  success: (
    <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
    </svg>
  ),
  error: (
    <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10 7.293 11.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
    </svg>
  ),
  warning: (
    <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
    </svg>
  ),
  info: (
    <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
    </svg>
  ),
  refresh: (
    <svg className="w-5 h-5 flex-shrink-0 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  ),
};

export function ToastContainer({
  toasts,
  onClose,
  position = 'top-right',
  maxToasts = 5,
}: ToastContainerProps) {
  const visibleToasts = toasts.slice(-maxToasts);

  return (
    <div
      className={`fixed z-50 flex flex-col gap-2 pointer-events-none ${positionClasses[position]}`}
      role="region"
      aria-label="通知"
      aria-live="polite"
    >
      {visibleToasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onClose={onClose} />
      ))}
    </div>
  );
}

interface ToastItemProps {
  toast: Toast;
  onClose: (id: string) => void;
}

function ToastItem({ toast, onClose }: ToastItemProps) {
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    if (toast.duration !== 0 && !toast.persistent) {
      const timer = setTimeout(() => {
        setIsExiting(true);
        setTimeout(() => onClose(toast.id), 200);
      }, toast.duration ?? 5000);
      return () => clearTimeout(timer);
    }
  }, [toast, onClose]);

  const handleClose = useCallback(() => {
    setIsExiting(true);
    setTimeout(() => onClose(toast.id), 200);
  }, [toast.id, onClose]);

  const handleActionClick = useCallback(() => {
    toast.action?.onClick();
    onClose(toast.id);
  }, [toast.action, onClose]);

  return (
    <div
      className={`
        pointer-events-auto flex items-start gap-3 p-4 rounded-xl border shadow-lg
        min-w-[300px] max-w-md transform transition-all duration-200
        ${isExiting ? 'opacity-0 translate-x-4 scale-95' : 'opacity-100 translate-x-0 scale-100'}
        ${typeStyles[toast.type]}
      `}
      role="alert"
      aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
    >
      <div className="flex-shrink-0 mt-0.5">{typeIcons[toast.type]}</div>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm">{toast.title}</p>
        {toast.message && (
          <p className="text-sm opacity-80 mt-1">{toast.message}</p>
        )}
      </div>
      {toast.action && (
        <button
          onClick={handleActionClick}
          className="flex-shrink-0 px-3 py-1 text-xs font-medium rounded-lg border border-current/20 hover:bg-current/10 transition-colors"
        >
          {toast.action.label}
        </button>
      )}
      <button
        onClick={handleClose}
        className="flex-shrink-0 p-1 rounded-lg hover:bg-current/10 transition-colors opacity-60 hover:opacity-100"
        aria-label="关闭"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

/**
 * Toast 管理器 Hook
 */
export interface ToastManager {
  toasts: Toast[];
  show: (toast: Omit<Toast, 'id'>) => string;
  hide: (id: string) => void;
  clear: () => void;
  success: (title: string, message?: string, options?: Partial<Toast>) => string;
  error: (title: string, message?: string, options?: Partial<Toast>) => string;
  warning: (title: string, message?: string, options?: Partial<Toast>) => string;
  info: (title: string, message?: string, options?: Partial<Toast>) => string;
  refresh: (title: string, message?: string, options?: Partial<Toast>) => string;
}

export function useToastManager(): ToastManager {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const generateId = useCallback(() => Math.random().toString(36).slice(2, 10), []);

  const show = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = generateId();
    const newToast = { ...toast, id } as Toast;
    setToasts((prev) => [...prev, newToast]);
    return id;
  }, [generateId]);

  const hide = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const clear = useCallback(() => {
    setToasts([]);
  }, []);

  const createToast = useCallback(
    (type: Toast['type'], title: string, message?: string, options?: Partial<Toast>) => {
      return show({ type, title, message, duration: 5000, ...options });
    },
    [show]
  );

  return {
    toasts,
    show,
    hide,
    clear,
    success: (title, message, options) => createToast('success', title, message, options),
    error: (title, message, options) => createToast('error', title, message, { duration: 8000, ...options }),
    warning: (title, message, options) => createToast('warning', title, message, options),
    info: (title, message, options) => createToast('info', title, message, options),
    refresh: (title, message, options) => createToast('refresh', title, message, { duration: 3000, ...options }),
  };
}

/**
 * Toast Provider 组件 - 在应用根部使用
 */
interface ToastProviderProps {
  children: React.ReactNode;
  position?: ToastContainerProps['position'];
  maxToasts?: number;
}

export function ToastProvider({ children, position = 'top-right', maxToasts = 5 }: ToastProviderProps) {
  const manager = useToastManager();

  return (
    <>
      {children}
      <ToastContainer
        toasts={manager.toasts}
        onClose={manager.hide}
        position={position}
        maxToasts={maxToasts}
      />
    </>
  );
}

export default ToastContainer;
