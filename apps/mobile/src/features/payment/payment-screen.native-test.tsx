import { createApiClient, createMemoryTokenStore, messageFor } from '@tamgiao/api-client';
import { DEPOSIT_VND, REFUND_SLA_HOURS, VOUCHER_VND } from '@tamgiao/contracts/constants';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import {
  createFakeFetch,
  createProblemBody,
  createTestQueryClient,
  renderWithProviders,
} from '../../test-utils/render-with-providers.js';
import { PAYMENT_COPY } from './copy.js';
import { formatVnd } from './format.js';
import { PaymentScreen } from './payment-screen.js';

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockCanGoBack = jest.fn(() => true);

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    back: mockBack,
    canGoBack: mockCanGoBack,
  }),
  useLocalSearchParams: () => ({}),
}));

const mockOpenAuthSession = jest.fn(async (..._args: unknown[]) => ({ type: 'cancel' }));
jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: (...args: unknown[]) => mockOpenAuthSession(...args),
}));

jest.mock('expo-linking', () => ({
  createURL: (path: string) => `tamgiao://${path}`,
}));

describe('PaymentScreen (FE-S3-01)', () => {
  const originalDev = (globalThis as { __DEV__?: boolean }).__DEV__;

  beforeEach(() => {
    jest.clearAllMocks();
    (globalThis as { __DEV__?: boolean }).__DEV__ = true;
  });

  afterEach(() => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = originalDev;
  });

  it('1. Render idle: hiển thị đúng số tiền, voucher, SLA hoàn tiền; không chứa từ ngữ pháp lý cấm', async () => {
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

    const screen = await renderWithProviders(<PaymentScreen />, { client, queryClient });

    await waitFor(() => {
      expect(screen.getByText(formatVnd(DEPOSIT_VND))).toBeTruthy();
      expect(screen.getByText(PAYMENT_COPY.voucher.title(formatVnd(VOUCHER_VND)))).toBeTruthy();
      expect(screen.getByText(new RegExp(`${REFUND_SLA_HOURS} giờ`))).toBeTruthy();
    });

    // Tuyệt đối không chứa các từ ngữ nhạy cảm pháp lý
    expect(screen.queryByText(/ký quỹ|bảo chứng|VNeID/i)).toBeNull();

    await screen.unmount();
  });

  it('2. AC1: bấm CTA → mở checkout browser, người dùng đóng giữa chừng (cancel) → poll lần sau thành công → hiện succeeded và ẩn CTA', async () => {
    // Trạng thái phía server: chưa có khoản → PENDING sau khi tạo checkout → SUCCEEDED (webhook tới) chỉ sau khi
    // người dùng đã đóng trình duyệt giữa chừng (`cancel`, không quay lại bằng deep link).
    let checkoutCreated = false;
    let browserClosed = false;
    mockOpenAuthSession.mockImplementationOnce(async () => {
      browserClosed = true;
      return { type: 'cancel' };
    });

    const fakeFetch = createFakeFetch((url, init) => {
      if (url === 'http://api.test/me/payments') {
        if (!checkoutCreated) {
          return { status: 200, body: { items: [] } };
        }
        const status = browserClosed ? 'SUCCEEDED' : 'PENDING';
        return {
          status: 200,
          body: {
            items: [
              {
                paymentId: '01952e46-953b-789a-b283-a9d701897d26',
                orderId: 'ORD-AC1',
                status,
                amountVnd: 299000,
                checkoutUrl: 'https://pay.test/checkout/ac1',
                qrData: 'qr-ac1',
                createdAt: '2026-11-22T00:00:00.000Z',
                succeededAt: status === 'SUCCEEDED' ? '2026-11-22T00:01:00.000Z' : null,
                failedAt: null,
                refundedAt: null,
              },
            ],
          },
        };
      }

      if (url === 'http://api.test/me/payments/verification' && init?.method === 'POST') {
        checkoutCreated = true;
        return {
          status: 201,
          body: {
            paymentId: '01952e46-953b-789a-b283-a9d701897d26',
            orderId: 'ORD-AC1',
            status: 'PENDING',
            amountVnd: 299000,
            checkoutUrl: 'https://pay.test/checkout/ac1',
            qrData: 'qr-ac1',
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

    const screen = await renderWithProviders(<PaymentScreen />, { client, queryClient });

    await waitFor(() => {
      expect(screen.getByTestId('payment-cta')).toBeTruthy();
    });

    // Bấm CTA
    const ctaBtn = screen.getByTestId('payment-cta');
    await act(async () => {
      await fireEvent.press(ctaBtn);
    });

    // Trình duyệt được mở với URL và return path
    expect(mockOpenAuthSession).toHaveBeenCalledWith(
      'https://pay.test/checkout/ac1',
      'tamgiao://payments/return',
    );

    // Sau khi đóng trình duyệt và poll lại, màn hình cập nhật SUCCEEDED
    await waitFor(() => {
      expect(screen.getByText(PAYMENT_COPY.status.succeeded)).toBeTruthy();
      expect(screen.queryByTestId('payment-cta')).toBeNull();
    });

    await screen.unmount();
  });

  it('3. AC2: khi __DEV__ = false → không có panel dev; khi __DEV__ = true và PENDING → có nút dev và bấm gọi POST fake payment', async () => {
    let fakePaymentCalled = false;
    let fakeOutcome: unknown = null;

    const fakeFetch = createFakeFetch((url, init) => {
      if (url === 'http://api.test/me/payments') {
        return {
          status: 200,
          body: {
            items: [
              {
                paymentId: '01952e46-953b-789a-b283-a9d701897d26',
                orderId: 'ORD-DEV-1',
                status: 'PENDING',
                amountVnd: 299000,
                checkoutUrl: 'https://pay.test/checkout/dev1',
                qrData: 'qr-dev1',
                createdAt: '2026-11-22T00:00:00.000Z',
                succeededAt: null,
                failedAt: null,
                refundedAt: null,
              },
            ],
          },
        };
      }

      if (url === 'http://api.test/dev/payments/fake/ORD-DEV-1' && init?.method === 'POST') {
        fakePaymentCalled = true;
        fakeOutcome = init.body ? JSON.parse(init.body as string) : null;
        return {
          status: 200,
          body: {
            received: true,
            outcome: 'SUCCEEDED',
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

    // Kịch bản A: __DEV__ = false
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
    const queryClientProd = createTestQueryClient();
    const screenProd = await renderWithProviders(<PaymentScreen />, {
      client,
      queryClient: queryClientProd,
    });

    await waitFor(() => {
      expect(screenProd.queryByTestId('dev-fake-pay-succeeded')).toBeNull();
      expect(screenProd.queryByTestId('dev-fake-pay-failed')).toBeNull();
    });
    await screenProd.unmount();

    // Kịch bản B: __DEV__ = true
    (globalThis as { __DEV__?: boolean }).__DEV__ = true;
    const queryClientDev = createTestQueryClient();
    const screenDev = await renderWithProviders(<PaymentScreen />, {
      client,
      queryClient: queryClientDev,
    });

    await waitFor(() => {
      expect(screenDev.getByTestId('dev-fake-pay-succeeded')).toBeTruthy();
      expect(screenDev.getByTestId('dev-fake-pay-failed')).toBeTruthy();
    });

    // Bấm nút thanh toán giả: thành công
    const succeedBtn = screenDev.getByTestId('dev-fake-pay-succeeded');
    await act(async () => {
      await fireEvent.press(succeedBtn);
    });

    await waitFor(() => {
      expect(fakePaymentCalled).toBe(true);
      expect(fakeOutcome).toEqual({ outcome: 'SUCCEEDED' });
    });

    await screenDev.unmount();
  });

  it('4. Lỗi PAYMENT_GATEWAY_UNAVAILABLE khi POST → hiển thị thông báo lỗi từ messageFor', async () => {
    const fakeFetch = createFakeFetch((url, init) => {
      if (url === 'http://api.test/me/payments') {
        return {
          status: 200,
          body: { items: [] },
        };
      }

      if (url === 'http://api.test/me/payments/verification' && init?.method === 'POST') {
        return {
          status: 503,
          body: createProblemBody({
            code: 'PAYMENT_GATEWAY_UNAVAILABLE',
            status: 503,
            title: 'Cổng thanh toán đang tạm thời gián đoạn.',
          }),
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

    const screen = await renderWithProviders(<PaymentScreen />, { client, queryClient });

    await waitFor(() => {
      expect(screen.getByTestId('payment-cta')).toBeTruthy();
    });

    const ctaBtn = screen.getByTestId('payment-cta');
    await act(async () => {
      await fireEvent.press(ctaBtn);
    });

    const expectedTitle = messageFor({ code: 'PAYMENT_GATEWAY_UNAVAILABLE' }).title;
    await waitFor(() => {
      expect(screen.getByText(expectedTitle)).toBeTruthy();
    });

    await screen.unmount();
  });

  it('5. FAILED: khoản thanh toán thất bại → CTA đổi chữ thành PAYMENT_COPY.cta.retry', async () => {
    const fakeFetch = createFakeFetch((url) => {
      if (url === 'http://api.test/me/payments') {
        return {
          status: 200,
          body: {
            items: [
              {
                paymentId: '01952e46-953b-789a-b283-a9d701897d26',
                orderId: 'ORD-FAIL-1',
                status: 'FAILED',
                amountVnd: 299000,
                checkoutUrl: null,
                qrData: null,
                createdAt: '2026-11-22T00:00:00.000Z',
                succeededAt: null,
                failedAt: '2026-11-22T00:01:00.000Z',
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

    const screen = await renderWithProviders(<PaymentScreen />, { client, queryClient });

    await waitFor(() => {
      expect(screen.getByText(PAYMENT_COPY.status.failed)).toBeTruthy();
      expect(screen.getByText(PAYMENT_COPY.cta.retry)).toBeTruthy();
    });

    await screen.unmount();
  });

  it('6. GET /me/payments trả SUCCEEDED → bấm payment-continue-kyc → mockPush được gọi với /(verification)/kyc', async () => {
    const fakeFetch = createFakeFetch((url) => {
      if (url === 'http://api.test/me/payments') {
        return {
          status: 200,
          body: {
            items: [
              {
                paymentId: '01952e46-953b-789a-b283-a9d701897d26',
                orderId: 'ORD-SUCC-1',
                status: 'SUCCEEDED',
                amountVnd: 299000,
                checkoutUrl: null,
                qrData: null,
                createdAt: '2026-11-22T00:00:00.000Z',
                succeededAt: '2026-11-22T00:01:00.000Z',
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

    const screen = await renderWithProviders(<PaymentScreen />, { client, queryClient });

    await waitFor(() => {
      expect(screen.getByTestId('payment-continue-kyc')).toBeTruthy();
    });

    const continueBtn = screen.getByTestId('payment-continue-kyc');
    await act(async () => {
      await fireEvent.press(continueBtn);
    });

    expect(mockPush).toHaveBeenCalledWith('/(verification)/kyc');

    await screen.unmount();
  });

  it('7. PAYMENT_COPY không còn khoá dev (đã tách sang module chỉ dùng ở dev)', () => {
    expect('dev' in PAYMENT_COPY).toBe(false);
  });
});
