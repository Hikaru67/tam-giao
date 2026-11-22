import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import type { BadgeTone } from './badge.js';
import { Text } from './text.js';

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

const toneContainerClasses: Record<ToastTone, string> = {
  neutral: 'bg-inverse-surface',
  success: 'bg-secondary',
  warning: 'bg-tertiary',
  danger: 'bg-error',
  primary: 'bg-primary',
};

const toneTextClasses: Record<ToastTone, string> = {
  neutral: 'text-inverse-on-surface',
  success: 'text-on-secondary',
  warning: 'text-on-tertiary',
  danger: 'text-on-error',
  primary: 'text-on-primary',
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
      {toasts.length > 0 ? (
        <View
          accessibilityLiveRegion="polite"
          className="absolute bottom-space-xl left-space-md right-space-md gap-space-xs z-50 pointer-events-none"
        >
          {toasts.map((toast) => (
            <View
              key={toast.id}
              className={`px-space-md py-space-sm rounded-lg shadow-lg ${
                toneContainerClasses[toast.tone ?? 'neutral']
              }`}
            >
              <Text variant="body-md" className={`font-medium ${toneTextClasses[toast.tone ?? 'neutral']}`}>
                {toast.message}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
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
