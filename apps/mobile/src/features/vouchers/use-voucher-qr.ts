import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { isApiError } from '@tamgiao/api-client';
import { useApiClient } from '@tamgiao/api-client/react';
import { voucherQrResponseSchema } from '@tamgiao/contracts/billing';
import { useQuery } from '@tanstack/react-query';

export const QR_REFRESH_MARGIN_MS = 15_000;
/** Đồng hồ máy lệch hoặc làm mới lỗi: không gọi dồn. */
export const QR_REFRESH_MIN_DELAY_MS = 5_000;

/**
 * Tính thời gian chờ (ms) trước khi refetch token QR mới.
 * refetchDelay = max(expiresAt - margin - now, min delay)
 */
export function qrRefreshDelayMs(expiresAt: string, now: number): number {
  const expiresAtMs = new Date(expiresAt).getTime();
  if (Number.isNaN(expiresAtMs)) {
    return QR_REFRESH_MIN_DELAY_MS;
  }
  return Math.max(expiresAtMs - QR_REFRESH_MARGIN_MS - now, QR_REFRESH_MIN_DELAY_MS);
}

export interface UseVoucherQrResult {
  readonly token: string | null;
  readonly isExpired: boolean;
  readonly isLoading: boolean;
  readonly error: Error | null;
  readonly refetch: () => Promise<unknown>;
}

export function useVoucherQr(voucherId: string, enabled: boolean): UseVoucherQrResult {
  const client = useApiClient();

  const query = useQuery({
    queryKey: ['vouchers-qr', voucherId] as const,
    queryFn: () => client.get(`/me/vouchers/${voucherId}/qr`, { schema: voucherQrResponseSchema }),
    enabled: enabled && voucherId.length > 0,
    gcTime: 0,
    staleTime: 0,
    retry: (count, error) => count < 1 && !(isApiError(error) && error.status >= 400 && error.status < 500),
    refetchInterval: (q) => {
      const data = q.state.data;
      if (!data?.expiresAt) {
        return false;
      }
      return qrRefreshDelayMs(data.expiresAt, Date.now());
    },
    refetchIntervalInBackground: false,
  });

  const { refetch } = query;

  // Lắng nghe AppState: khi trở lại 'active' → refetch
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void refetch();
      }
    });
    return () => {
      subscription.remove();
    };
  }, [enabled, refetch]);

  // Quản lý trạng thái quá hạn token: timer đếm ngược tới expiresAt
  const [isExpired, setIsExpired] = useState(false);

  useEffect(() => {
    if (!enabled || !query.data?.token || !query.data?.expiresAt) {
      setIsExpired(false);
      return;
    }

    const expiresAtMs = new Date(query.data.expiresAt).getTime();
    const now = Date.now();
    const delayUntilExpire = expiresAtMs - now;

    if (delayUntilExpire <= 0) {
      setIsExpired(true);
      return;
    }

    setIsExpired(false);
    const timer = setTimeout(() => {
      setIsExpired(true);
    }, delayUntilExpire);

    return () => {
      clearTimeout(timer);
    };
  }, [enabled, query.data?.token, query.data?.expiresAt]);

  const token = isExpired || !query.data ? null : query.data.token;

  return {
    token,
    isExpired,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
