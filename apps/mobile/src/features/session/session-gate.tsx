import { useEffect, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { sessionEvents } from '../../session/api.js';

export interface SessionGateProps {
  children: ReactNode;
}

/**
 * Gate giám sát sự kiện phiên làm việc:
 * Lắng nghe sự kiện sessionEvents.onSignedOut (do 401 hoặc hết hạn phiên)
 * để xóa query cache và điều hướng người dùng về màn hình đăng nhập.
 * Dữ liệu đang nhập dở chỉ tồn tại trong bộ nhớ màn hình (F4), không bị giữ lại sau khi đăng xuất.
 */
export function SessionGate({ children }: SessionGateProps) {
  const queryClient = useQueryClient();
  const router = useRouter();

  useEffect(() => {
    const unsubscribe = sessionEvents.onSignedOut(() => {
      queryClient.clear();
      router.replace('/(auth)/phone');
    });

    return () => {
      unsubscribe();
    };
  }, [queryClient, router]);

  return <>{children}</>;
}
