import { useCallback, useEffect, useRef, useState } from 'react';
import { isApiError } from '@tamgiao/api-client';
import { useApiClient } from '@tamgiao/api-client/react';
import {
  IDEMPOTENCY_KEY_HEADER,
  paymentHistoryResponseSchema,
  verificationCheckoutResponseSchema,
  webhookAckResponseSchema,
  type DevFakePaymentBody,
  type PaymentHistoryItem,
  type PaymentHistoryResponse,
  type VerificationCheckoutResponse,
  type VerificationPaymentStatus,
  type WebhookAckResponse,
} from '@tamgiao/contracts/billing';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { PAYMENT_POLL_INTERVAL_MS, PAYMENT_POLL_TIMEOUT_MS } from './constants.js';
import { createIdempotencyKey } from './idempotency-key.js';

export const PAYMENTS_QUERY_KEY = ['payments'] as const;
export const PAID_STATUSES = [
  'SUCCEEDED',
  'REFUND_PENDING',
  'REFUNDED',
] as const satisfies readonly VerificationPaymentStatus[];

function isPaidStatus(status: VerificationPaymentStatus): boolean {
  return PAID_STATUSES.some((paid) => paid === status);
}

export type PaymentPhase = 'idle' | 'polling' | 'succeeded' | 'failed' | 'timeout';

export interface PaymentStatusOptions {
  intervalMs?: number;
  timeoutMs?: number;
}

export interface PaymentStatusResult {
  query: UseQueryResult<PaymentHistoryResponse, Error>;
  latest: PaymentHistoryItem | null;
  phase: PaymentPhase;
  /** Bắt đầu lại chu kỳ poll (reset timeout) + refetch ngay. */
  restartPolling: () => void;
}

/**
 * Hook theo dõi trạng thái thanh toán và tự động poll định kỳ khi còn PENDING.
 */
export function usePaymentStatus(options?: PaymentStatusOptions): PaymentStatusResult {
  const intervalMs = options?.intervalMs ?? PAYMENT_POLL_INTERVAL_MS;
  const timeoutMs = options?.timeoutMs ?? PAYMENT_POLL_TIMEOUT_MS;

  const client = useApiClient();
  const queryClient = useQueryClient();

  const [pollRound, setPollRound] = useState(0);
  const [timedOut, setTimedOut] = useState(false);

  const query = useQuery({
    queryKey: PAYMENTS_QUERY_KEY,
    queryFn: () =>
      client.get<typeof paymentHistoryResponseSchema>('/me/payments', {
        schema: paymentHistoryResponseSchema,
      }),
    refetchInterval: (q) => {
      const items = q.state.data?.items;
      const latestItem = items?.[0];
      if (latestItem?.status === 'PENDING' && !timedOut) {
        return intervalMs;
      }
      return false;
    },
    refetchIntervalInBackground: false,
  });

  const latest = query.data?.items[0] ?? null;

  useEffect(() => {
    if (latest?.status !== 'PENDING') {
      if (timedOut) {
        setTimedOut(false);
      }
      return;
    }

    if (timedOut) {
      return;
    }

    const timer = setTimeout(() => {
      setTimedOut(true);
    }, timeoutMs);

    return () => {
      clearTimeout(timer);
    };
  }, [latest?.status, pollRound, timeoutMs, timedOut]);

  let phase: PaymentPhase = 'idle';
  if (!latest) {
    phase = 'idle';
  } else if (isPaidStatus(latest.status)) {
    phase = 'succeeded';
  } else if (latest.status === 'FAILED') {
    phase = 'failed';
  } else if (latest.status === 'PENDING') {
    phase = timedOut ? 'timeout' : 'polling';
  }

  const prevPhaseRef = useRef<PaymentPhase>(phase);
  useEffect(() => {
    if (prevPhaseRef.current === 'polling' && phase === 'succeeded') {
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    }
    prevPhaseRef.current = phase;
  }, [phase, queryClient]);

  const { refetch } = query;
  const restartPolling = useCallback(() => {
    setTimedOut(false);
    setPollRound((r) => r + 1);
    void refetch();
  }, [refetch]);

  return {
    query,
    latest,
    phase,
    restartPolling,
  };
}

/**
 * Hook tạo đơn thanh toán phí xác thực qua `POST /me/payments/verification`.
 * Tự sinh và giữ nguyên idempotency key khi thử lại sau lỗi mạng / 503.
 */
export function useCreateVerificationCheckout(): UseMutationResult<
  VerificationCheckoutResponse,
  Error,
  void
> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const idempotencyKeyRef = useRef<string | null>(null);

  const getOrCreateKey = () => {
    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = createIdempotencyKey();
    }
    return idempotencyKeyRef.current;
  };

  return useMutation<VerificationCheckoutResponse, Error, void>({
    mutationFn: async () => {
      const key = getOrCreateKey();
      return client.post<typeof verificationCheckoutResponseSchema>('/me/payments/verification', {
        headers: {
          [IDEMPOTENCY_KEY_HEADER]: key,
        },
        schema: verificationCheckoutResponseSchema,
      });
    },
    onSuccess: async () => {
      idempotencyKeyRef.current = null;
      await queryClient.invalidateQueries({ queryKey: PAYMENTS_QUERY_KEY });
    },
    onError: async (err) => {
      if (isApiError(err) && err.code === 'PAYMENT_ALREADY_EXISTS') {
        idempotencyKeyRef.current = null;
        await queryClient.invalidateQueries({ queryKey: PAYMENTS_QUERY_KEY });
      }
    },
  });
}

/**
 * Hook giả lập kết quả thanh toán cho môi trường dev qua `POST /dev/payments/fake/:orderId`.
 */
export function useDevFakePayment(): UseMutationResult<
  WebhookAckResponse,
  Error,
  { orderId: string; outcome: DevFakePaymentBody['outcome'] }
> {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<WebhookAckResponse, Error, { orderId: string; outcome: DevFakePaymentBody['outcome'] }>({
    mutationFn: async ({ orderId, outcome }) => {
      return client.post<typeof webhookAckResponseSchema>(
        `/dev/payments/fake/${encodeURIComponent(orderId)}`,
        {
          body: { outcome },
          schema: webhookAckResponseSchema,
        },
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: PAYMENTS_QUERY_KEY });
    },
  });
}
