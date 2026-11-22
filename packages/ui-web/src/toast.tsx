import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import type { BadgeTone } from './badge.js';

export type ToastTone = BadgeTone;

export interface ToastItem {
  id: string;
  message: string;
  tone?: ToastTone;
}

interface ToastContextValue {
  showToast: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const toneClasses: Record<ToastTone, string> = {
  neutral: 'bg-inverse-surface text-inverse-on-surface',
  success: 'bg-secondary text-on-secondary',
  warning: 'bg-tertiary text-on-tertiary',
  danger: 'bg-error text-on-error',
  primary: 'bg-primary text-on-primary',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showToast = useCallback((message: string, tone: ToastTone = 'neutral') => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev, { id, message, tone }]);

    setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id));
    }, 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div
        aria-live="polite"
        role="status"
        className="fixed bottom-space-lg right-space-lg z-50 flex flex-col gap-space-xs pointer-events-none max-w-sm w-full px-space-md"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`px-space-md py-space-sm rounded-lg shadow-lg text-body-md font-medium pointer-events-auto transition-all animate-bounce ${
              toneClasses[toast.tone ?? 'neutral']
            }`}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast phải được dùng bên trong ToastProvider');
  }
  return ctx;
}
