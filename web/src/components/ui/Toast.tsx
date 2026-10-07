import React, { createContext, useCallback, useContext, useState } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { cn } from '../../lib/utils';

type ToastType = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue>({} as ToastContextValue);

const styles: Record<ToastType, { ring: string; icon: React.ReactNode }> = {
  success: {
    ring: 'ring-emerald-200 bg-white',
    icon: <CheckCircle2 className="h-5 w-5 text-emerald-500" />,
  },
  error: {
    ring: 'ring-red-200 bg-white',
    icon: <AlertCircle className="h-5 w-5 text-red-500" />,
  },
  info: {
    ring: 'ring-sky-200 bg-white',
    icon: <Info className="h-5 w-5 text-sky-500" />,
  },
};

let seq = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const remove = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, type: ToastType = 'info') => {
      const id = ++seq;
      setItems((prev) => [...prev, { id, type, message }]);
      setTimeout(() => remove(id), 3800);
    },
    [remove]
  );

  const value: ToastContextValue = {
    toast,
    success: (m) => toast(m, 'success'),
    error: (m) => toast(m, 'error'),
    info: (m) => toast(m, 'info'),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-5 top-5 z-[100] flex w-full max-w-sm flex-col gap-2.5">
        {items.map((t) => (
          <div
            key={t.id}
            className={cn(
              'pointer-events-auto flex items-start gap-3 rounded-xl px-4 py-3 shadow-lift ring-1 animate-fade-up',
              styles[t.type].ring
            )}
          >
            <div className="mt-0.5 shrink-0">{styles[t.type].icon}</div>
            <p className="flex-1 text-sm text-slate-700">{t.message}</p>
            <button
              onClick={() => remove(t.id)}
              className="shrink-0 rounded-md p-0.5 text-slate-300 transition-colors hover:text-slate-500"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
