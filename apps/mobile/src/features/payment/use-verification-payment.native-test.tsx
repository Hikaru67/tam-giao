import type { ReactNode } from 'react';
import { createApiClient, createMemoryTokenStore, type ApiClient } from '@tamgiao/api-client';
import { ApiClientProvider } from '@tamgiao/api-client/react';
import { idempotencyKeySchema } from '@tamgiao/contracts/billing';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import {
  createFakeFetch,
  createProblemBody,
  createTestQueryClient,
} from '../../test-utils/render-with-providers.js';
import {
  useCreateVerificationCheckout,
  usePaymentStatus,
  type PaymentPhase,
} from './use-verification-payment.js';

function createHookWrapper(client: ApiClient, queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ApiClientProvider client={client}>{children}</ApiClientProvider>
      </QueryClientProvider>
    );
  };
}

describe('usePaymentStatus & useCreateVerificationCheckout (FE-S3-01)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('PENDING → SUCCEEDED: 2 lần GET đầu trả PENDING, sau đó SUCCEEDED → phase polling rồi succeeded và invalidate [me]', async () => {
    let getCount = 0;
    const fakeFetch = createFakeFetch((url) => {
      if (url === 'http://api.test/me/payments') {
        getCount++;
        const status = getCount <= 2 ? 'PENDING' : 'SUCCEEDED';
        return {
          status: 200,
          body: {
            items: [
              {
                paymentId: '01952e46-953b-789a-b283-a9d701897d26',
                orderId: 'ORD-101',
                status,
                amountVnd: 299000,
                checkoutUrl: 'https://pay.test/checkout/101',
                qrData: 'qr-data-101',
                createdAt: '2026-11-22T00:00:00.000Z',
                succeededAt: status === 'SUCCEEDED' ? '2026-11-22T00:01:00.000Z' : null,
                failedAt: null,
                refundedAt: null,
              },
            ],
          },
        };
      }
      return { status: 404 };
    });

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: createMemoryTokenStore(),
      fetch: fakeFetch,
    });
    const queryClient = createTestQueryClient();
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

    const phases: PaymentPhase[] = [];
    const { result, unmount } = await renderHook(
      () => {
        const status = usePaymentStatus({ intervalMs: 20, timeoutMs: 500 });
        phases.push(status.phase);
        return status;
      },
      { wrapper: createHookWrapper(client, queryClient) },
    );

    // Sau các lần poll tiếp theo -> chuyển 'succeeded'
    await waitFor(
      () => {
        expect(result.current.phase).toBe('succeeded');
      },
      { timeout: 2000 },
    );

    // Đã đi qua 'polling' (các lần GET trả PENDING) trước khi 'succeeded'.
    expect(phases.indexOf('polling')).toBeGreaterThanOrEqual(0);
    expect(phases.indexOf('polling')).toBeLessThan(phases.indexOf('succeeded'));
    expect(getCount).toBeGreaterThanOrEqual(3);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['me'] });

    await unmount();
  });

  it('PENDING → FAILED: phase chuyển failed và ngừng poll', async () => {
    let getCount = 0;
    const fakeFetch = createFakeFetch((url) => {
      if (url === 'http://api.test/me/payments') {
        getCount++;
        const status = getCount <= 2 ? 'PENDING' : 'FAILED';
        return {
          status: 200,
          body: {
            items: [
              {
                paymentId: '01952e46-953b-789a-b283-a9d701897d26',
                orderId: 'ORD-102',
                status,
                amountVnd: 299000,
                checkoutUrl: null,
                qrData: null,
                createdAt: '2026-11-22T00:00:00.000Z',
                succeededAt: null,
                failedAt: status === 'FAILED' ? '2026-11-22T00:01:00.000Z' : null,
                refundedAt: null,
              },
            ],
          },
        };
      }
      return { status: 404 };
    });

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: createMemoryTokenStore(),
      fetch: fakeFetch,
    });
    const queryClient = createTestQueryClient();

    const { result, unmount } = await renderHook(() => usePaymentStatus({ intervalMs: 20, timeoutMs: 500 }), {
      wrapper: createHookWrapper(client, queryClient),
    });

    await waitFor(
      () => {
        expect(result.current.phase).toBe('failed');
      },
      { timeout: 2000 },
    );

    const countAtFailed = getCount;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 80);
    });
    // Không poll thêm sau khi đã failed
    expect(getCount).toBe(countAtFailed);

    await unmount();
  });

  it('Timeout: luôn PENDING, timeoutMs 150 → phase timeout và ngừng poll; restartPolling khôi phục polling', async () => {
    let getCount = 0;
    const fakeFetch = createFakeFetch((url) => {
      if (url === 'http://api.test/me/payments') {
        getCount++;
        return {
          status: 200,
          body: {
            items: [
              {
                paymentId: '01952e46-953b-789a-b283-a9d701897d26',
                orderId: 'ORD-103',
                status: 'PENDING',
                amountVnd: 299000,
                checkoutUrl: 'https://pay.test/checkout/103',
                qrData: 'qr-data-103',
                createdAt: '2026-11-22T00:00:00.000Z',
                succeededAt: null,
                failedAt: null,
                refundedAt: null,
              },
            ],
          },
        };
      }
      return { status: 404 };
    });

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: createMemoryTokenStore(),
      fetch: fakeFetch,
    });
    const queryClient = createTestQueryClient();

    const { result, unmount } = await renderHook(() => usePaymentStatus({ intervalMs: 20, timeoutMs: 150 }), {
      wrapper: createHookWrapper(client, queryClient),
    });

    // Chờ quá 150ms -> chuyển 'timeout' và ngừng poll
    await waitFor(
      () => {
        expect(result.current.phase).toBe('timeout');
      },
      { timeout: 2000 },
    );

    const countAtTimeout = getCount;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 80);
    });
    expect(getCount).toBe(countAtTimeout);

    // Gọi restartPolling
    await act(async () => {
      result.current.restartPolling();
    });

    await waitFor(() => {
      expect(result.current.phase).toBe('polling');
    });

    await unmount();
  });

  it('Không có khoản nào (items: []) → phase idle', async () => {
    const fakeFetch = createFakeFetch((url) => {
      if (url === 'http://api.test/me/payments') {
        return {
          status: 200,
          body: { items: [] },
        };
      }
      return { status: 404 };
    });

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: createMemoryTokenStore(),
      fetch: fakeFetch,
    });
    const queryClient = createTestQueryClient();

    const { result, unmount } = await renderHook(() => usePaymentStatus({ intervalMs: 20, timeoutMs: 150 }), {
      wrapper: createHookWrapper(client, queryClient),
    });

    await waitFor(() => {
      expect(result.current.query.isSuccess).toBe(true);
      expect(result.current.phase).toBe('idle');
      expect(result.current.latest).toBeNull();
    });

    await unmount();
  });

  it('useCreateVerificationCheckout gửi header idempotency-key hợp lệ; giữ nguyên khi thử lại sau lỗi 503, đổi mới sau khi thành công', async () => {
    const capturedKeys: string[] = [];
    let shouldFail503 = true;

    const fakeFetch = createFakeFetch((url, init) => {
      if (url === 'http://api.test/me/payments/verification') {
        const headers = init?.headers as Record<string, string> | undefined;
        const key = headers?.['idempotency-key'] ?? '';
        capturedKeys.push(key);

        if (shouldFail503) {
          shouldFail503 = false;
          return {
            status: 503,
            body: createProblemBody({
              code: 'PAYMENT_GATEWAY_UNAVAILABLE',
              status: 503,
              title: 'Cổng thanh toán đang tạm thời gián đoạn.',
            }),
          };
        }

        return {
          status: 201,
          body: {
            paymentId: '01952e46-953b-789a-b283-a9d701897d26',
            orderId: 'ORD-999',
            status: 'PENDING',
            amountVnd: 299000,
            checkoutUrl: 'https://pay.test/checkout/999',
            qrData: 'qr-data-999',
            createdAt: '2026-11-22T00:00:00.000Z',
          },
        };
      }
      return { status: 404 };
    });

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: createMemoryTokenStore(),
      fetch: fakeFetch,
    });
    const queryClient = createTestQueryClient();

    const { result, unmount } = await renderHook(() => useCreateVerificationCheckout(), {
      wrapper: createHookWrapper(client, queryClient),
    });

    // 1. Lần đầu -> gặp lỗi 503
    await act(async () => {
      try {
        await result.current.mutateAsync();
      } catch {
        // lỗi mong đợi
      }
    });

    expect(capturedKeys.length).toBe(1);
    const firstKey = capturedKeys[0]!;
    expect(idempotencyKeySchema.safeParse(firstKey).success).toBe(true);

    // 2. Thử lại sau lỗi 503 -> phải giữ nguyên idempotency key
    await act(async () => {
      await result.current.mutateAsync();
    });

    expect(capturedKeys.length).toBe(2);
    expect(capturedKeys[1]).toBe(firstKey);

    // 3. Gọi tiếp sau khi đã thành công -> sinh key mới
    await act(async () => {
      await result.current.mutateAsync();
    });

    expect(capturedKeys.length).toBe(3);
    const thirdKey = capturedKeys[2]!;
    expect(idempotencyKeySchema.safeParse(thirdKey).success).toBe(true);
    expect(thirdKey).not.toBe(firstKey);

    await unmount();
  });
});
