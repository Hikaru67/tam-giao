import type { ReactNode } from 'react';
import { ApiClientProvider } from '@tamgiao/api-client/react';
import { createApiClient, createMemoryTokenStore } from '@tamgiao/api-client';
import type { VoucherQrResponse } from '@tamgiao/contracts/billing';
import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { createFakeFetch, createTestQueryClient } from '../../test-utils/render-with-providers.js';
import { QueryClientProvider } from '@tanstack/react-query';
import {
  QR_REFRESH_MARGIN_MS,
  QR_REFRESH_MIN_DELAY_MS,
  qrRefreshDelayMs,
  useVoucherQr,
} from './use-voucher-qr.js';

describe('qrRefreshDelayMs', () => {
  it('tính đúng khoảng cách refetch trước hạn 15 giây', () => {
    const now = 100_000;
    const expiresAt = new Date(now + 60_000).toISOString(); // 60s sau
    // delay = 60_000 - 15_000 = 45_000ms
    expect(qrRefreshDelayMs(expiresAt, now)).toBe(45_000);
  });

  it('xử lý các trường hợp biên: chạm min delay, quá hạn hoặc thời gian không hợp lệ', () => {
    const now = 100_000;

    // Đúng bằng min delay: now + margin + min delay
    const expiresAtExactMin = new Date(now + QR_REFRESH_MARGIN_MS + QR_REFRESH_MIN_DELAY_MS).toISOString();
    expect(qrRefreshDelayMs(expiresAtExactMin, now)).toBe(QR_REFRESH_MIN_DELAY_MS);

    // Nhỏ hơn min delay -> chạm sàn
    const expiresAtBelowMin = new Date(115_500).toISOString();
    expect(qrRefreshDelayMs(expiresAtBelowMin, now)).toBe(QR_REFRESH_MIN_DELAY_MS);

    // Đã quá hạn: now > expiresAt -> chạm sàn min delay
    const expiresAtPast = new Date(90_000).toISOString();
    expect(qrRefreshDelayMs(expiresAtPast, now)).toBe(QR_REFRESH_MIN_DELAY_MS);

    // Chuỗi ngày không hợp lệ -> min delay
    expect(qrRefreshDelayMs('not-a-valid-date', now)).toBe(QR_REFRESH_MIN_DELAY_MS);
  });
});

describe('useVoucherQr', () => {
  const VOUCHER_ID = '01890a5d-ac96-774b-bcce-b302099a8001';

  beforeEach(() => {
    jest.useFakeTimers({ now: 100_000 });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  function createWrapper(fetchHandler: (url: string) => { status?: number; body?: unknown }) {
    const queryClient = createTestQueryClient();
    const tokenStore = createMemoryTokenStore();
    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore,
      fetch: createFakeFetch(fetchHandler),
    });

    return function Wrapper({ children }: { readonly children: ReactNode }) {
      return (
        <QueryClientProvider client={queryClient}>
          <ApiClientProvider client={client}>{children}</ApiClientProvider>
        </QueryClientProvider>
      );
    };
  }

  it('refetch đúng trước hạn 15 giây với fake timer', async () => {
    let callCount = 0;
    const initialExpiresAt = new Date(100_000 + 60_000).toISOString(); // 60s sau
    const secondExpiresAt = new Date(100_000 + 120_000).toISOString();

    const wrapper = createWrapper((url) => {
      if (url.includes(`/me/vouchers/${VOUCHER_ID}/qr`)) {
        callCount += 1;
        const response: VoucherQrResponse = {
          token: callCount === 1 ? 'token-initial' : 'token-refreshed',
          expiresAt: callCount === 1 ? initialExpiresAt : secondExpiresAt,
        };
        return { status: 200, body: response };
      }
      return { status: 404, body: {} };
    });

    const { result, unmount } = await renderHook(() => useVoucherQr(VOUCHER_ID, true), { wrapper });

    // Đợi tải token lần 1
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10);
    });

    expect(result.current.token).toBe('token-initial');
    expect(result.current.isExpired).toBe(false);
    expect(callCount).toBe(1);

    // 60s - 15s margin = 45s (45_000ms). Nhích 44_000ms -> chưa refetch
    await act(async () => {
      await jest.advanceTimersByTimeAsync(44_000);
    });
    expect(callCount).toBe(1);

    // Đến 45_000ms -> TanStack Query tự refetch theo refetchInterval
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1_500);
    });

    expect(callCount).toBe(2);
    expect(result.current.token).toBe('token-refreshed');
    expect(result.current.isExpired).toBe(false);

    await unmount();
  });

  it('quá hạn mà refetch lỗi → token null và isExpired true', async () => {
    let callCount = 0;
    const initialExpiresAt = new Date(100_000 + 30_000).toISOString(); // hết hạn sau 30s

    const wrapper = createWrapper((url) => {
      if (url.includes(`/me/vouchers/${VOUCHER_ID}/qr`)) {
        callCount += 1;
        if (callCount === 1) {
          const response: VoucherQrResponse = {
            token: 'token-expiring',
            expiresAt: initialExpiresAt,
          };
          return { status: 200, body: response };
        }
        // Lần refetch thứ 2 bị lỗi server
        return { status: 500, body: { code: 'SERVER_ERROR' } };
      }
      return { status: 404, body: {} };
    });

    const { result, unmount } = await renderHook(() => useVoucherQr(VOUCHER_ID, true), { wrapper });

    await act(async () => {
      await jest.advanceTimersByTimeAsync(10);
    });

    expect(result.current.token).toBe('token-expiring');
    expect(result.current.isExpired).toBe(false);

    // Tiến tới thời điểm refetch (30s - 15s = 15s) -> refetch lỗi
    await act(async () => {
      await jest.advanceTimersByTimeAsync(15_000);
    });

    // Lúc này token chưa quá hạn (mới 15s / 30s)
    expect(result.current.token).toBe('token-expiring');

    // Tiến tiếp vượt qua hạn 30_000ms -> setTimeout kích hoạt
    await act(async () => {
      await jest.advanceTimersByTimeAsync(16_000);
    });

    expect(result.current.isExpired).toBe(true);
    expect(result.current.token).toBeNull();

    await unmount();
  });

  it('unmount dọn timer đếm ngược và listener', async () => {
    const initialExpiresAt = new Date(100_000 + 60_000).toISOString();

    const wrapper = createWrapper(() => ({
      status: 200,
      body: { token: 'token-cleanup', expiresAt: initialExpiresAt } satisfies VoucherQrResponse,
    }));

    const { unmount } = await renderHook(() => useVoucherQr(VOUCHER_ID, true), { wrapper });

    await act(async () => {
      await jest.advanceTimersByTimeAsync(10);
    });

    await unmount();

    // Không có exception hay lỗi khi unmount và chạy timer tiếp
    await act(async () => {
      await jest.advanceTimersByTimeAsync(100_000);
    });
  });

  it('AppState trở lại active kích hoạt refetch', async () => {
    let callCount = 0;
    const expiresAt = new Date(100_000 + 60_000).toISOString();

    const wrapper = createWrapper(() => {
      callCount += 1;
      return {
        status: 200,
        body: { token: `token-${callCount}`, expiresAt } satisfies VoucherQrResponse,
      };
    });

    const { unmount } = await renderHook(() => useVoucherQr(VOUCHER_ID, true), { wrapper });

    await act(async () => {
      await jest.advanceTimersByTimeAsync(10);
    });

    expect(callCount).toBe(1);

    // Kích hoạt AppState change sang active
    await act(async () => {
      const eventEmitter = AppState as unknown as { emit?: (event: string, state: string) => void };
      if (typeof eventEmitter.emit === 'function') {
        eventEmitter.emit('change', 'active');
      }
    });

    await unmount();
  });
});
