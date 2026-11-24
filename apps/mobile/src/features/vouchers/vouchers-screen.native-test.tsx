import { createApiClient, createMemoryTokenStore, messageFor } from '@tamgiao/api-client';
import type {
  MyVoucher,
  MyVouchersResponse,
  PartnerListResponse,
  VoucherQrResponse,
} from '@tamgiao/contracts/billing';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import {
  createFakeFetch,
  createProblemBody,
  createTestQueryClient,
  renderWithProviders,
} from '../../test-utils/render-with-providers.js';
import { formatLocalDate } from '../kyc/status-model.js';
import { VOUCHERS_COPY, VOUCHER_STATUS_LABELS } from './copy.js';
import { VouchersScreen } from './vouchers-screen.js';

const mockBack = jest.fn();
const mockCanGoBack = jest.fn(() => true);
const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({
    back: mockBack,
    canGoBack: mockCanGoBack,
    replace: mockReplace,
  }),
}));

const mockPreventScreenCapture = jest.fn();
// Trong jest không có view native của SVG: dựng view thường giữ nguyên props để kiểm tra.
jest.mock('react-native-svg', () => {
  const { View } = jest.requireActual('react-native');
  return { __esModule: true, default: View, Path: View };
});
jest.mock('expo-screen-capture', () => ({
  usePreventScreenCapture: (...args: unknown[]) => mockPreventScreenCapture(...args),
}));

const mockGetBrightnessAsync = jest.fn(async () => 0.5);
const mockSetBrightnessAsync = jest.fn(async (_value: unknown) => undefined);
jest.mock('expo-brightness', () => ({
  getBrightnessAsync: () => mockGetBrightnessAsync(),
  setBrightnessAsync: (value: unknown) => mockSetBrightnessAsync(value),
}));

const PARTNER_ID = '01890a5d-ac96-774b-bcce-b302099a8050';
const SAMPLE_PARTNERS: PartnerListResponse = {
  items: [
    {
      id: PARTNER_ID,
      name: 'The Running Bean',
      address: '33 Mạc Thị Bưởi, Q.1',
      photoUrl: null,
      tags: ['Yên tĩnh'],
    },
  ],
};

const VOUCHER_RESERVED: MyVoucher = {
  id: '01890a5d-ac96-774b-bcce-b302099a8011',
  status: 'RESERVED',
  valueVnd: 300_000,
  expiresAt: null,
  partnerId: null,
  issuedAt: '2026-11-01T00:00:00.000Z',
  activatedAt: null,
  redeemedAt: null,
};

const VOUCHER_ACTIVE: MyVoucher = {
  id: '01890a5d-ac96-774b-bcce-b302099a8012',
  status: 'ACTIVE',
  valueVnd: 300_000,
  expiresAt: '2026-12-31T00:00:00.000Z',
  partnerId: PARTNER_ID,
  issuedAt: '2026-11-01T00:00:00.000Z',
  activatedAt: '2026-11-02T00:00:00.000Z',
  redeemedAt: null,
};

const VOUCHER_REDEEMED: MyVoucher = {
  id: '01890a5d-ac96-774b-bcce-b302099a8013',
  status: 'REDEEMED',
  valueVnd: 300_000,
  expiresAt: '2026-12-31T00:00:00.000Z',
  partnerId: null,
  issuedAt: '2026-11-01T00:00:00.000Z',
  activatedAt: '2026-11-02T00:00:00.000Z',
  redeemedAt: '2026-11-20T10:00:00.000Z',
};

const VOUCHER_VOID: MyVoucher = {
  id: '01890a5d-ac96-774b-bcce-b302099a8014',
  status: 'VOID',
  valueVnd: 300_000,
  expiresAt: '2026-12-31T00:00:00.000Z',
  partnerId: null,
  issuedAt: '2026-11-01T00:00:00.000Z',
  activatedAt: '2026-11-02T00:00:00.000Z',
  redeemedAt: null,
};

const VOUCHER_EXPIRED: MyVoucher = {
  id: '01890a5d-ac96-774b-bcce-b302099a8015',
  status: 'EXPIRED',
  valueVnd: 300_000,
  expiresAt: '2026-11-10T00:00:00.000Z',
  partnerId: null,
  issuedAt: '2026-11-01T00:00:00.000Z',
  activatedAt: '2026-11-02T00:00:00.000Z',
  redeemedAt: null,
};

describe('VouchersScreen', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('bảng 5 trạng thái: chỉ ACTIVE có nút Hiện mã QR và gọi /qr (AC1)', async () => {
    let qrRequested = false;

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: createMemoryTokenStore(),
      fetch: createFakeFetch((url) => {
        if (url.includes('/me/vouchers') && !url.includes('/qr')) {
          const response: MyVouchersResponse = {
            items: [VOUCHER_RESERVED, VOUCHER_ACTIVE, VOUCHER_REDEEMED, VOUCHER_VOID, VOUCHER_EXPIRED],
          };
          return { status: 200, body: response };
        }
        if (url.includes('/partners')) {
          return { status: 200, body: SAMPLE_PARTNERS };
        }
        if (url.includes('/qr')) {
          qrRequested = true;
          const qrResponse: VoucherQrResponse = {
            token: 'secret-token-active',
            expiresAt: new Date(Date.now() + 90_000).toISOString(),
          };
          return { status: 200, body: qrResponse };
        }
        return { status: 404, body: {} };
      }),
    });

    const screen = await renderWithProviders(<VouchersScreen />, {
      client,
      queryClient: createTestQueryClient(),
    });

    // 1. Kiểm tra 5 badge trạng thái
    expect(await screen.findByText(VOUCHER_STATUS_LABELS.RESERVED)).toBeTruthy();
    expect(screen.getByText(VOUCHER_STATUS_LABELS.ACTIVE)).toBeTruthy();
    expect(screen.getByText(VOUCHER_STATUS_LABELS.REDEEMED)).toBeTruthy();
    expect(screen.getByText(VOUCHER_STATUS_LABELS.VOID)).toBeTruthy();
    expect(screen.getByText(VOUCHER_STATUS_LABELS.EXPIRED)).toBeTruthy();

    // 2. Kiểm tra thông tin hiển thị của từng voucher
    // RESERVED: có gợi ý
    expect(screen.getByText(VOUCHERS_COPY.reservedHint)).toBeTruthy();
    expect(screen.queryByTestId(`voucher-show-${VOUCHER_RESERVED.id}`)).toBeNull();

    // REDEEMED: có banner redeemed và ngày redeemed
    expect(screen.getByTestId('voucher-redeemed')).toBeTruthy();
    expect(
      screen.getByText(VOUCHERS_COPY.expiry.redeemedAt(formatLocalDate('2026-11-20T10:00:00.000Z'))),
    ).toBeTruthy();
    expect(screen.queryByTestId(`voucher-show-${VOUCHER_REDEEMED.id}`)).toBeNull();

    // VOID và EXPIRED: không có nút show
    expect(screen.queryByTestId(`voucher-show-${VOUCHER_VOID.id}`)).toBeNull();
    expect(screen.queryByTestId(`voucher-show-${VOUCHER_EXPIRED.id}`)).toBeNull();

    // ACTIVE: CÓ nút show QR
    const activeShowButton = screen.getByTestId(`voucher-show-${VOUCHER_ACTIVE.id}`);
    expect(activeShowButton).toBeTruthy();
    expect(screen.getByText(VOUCHERS_COPY.actions.showQr)).toBeTruthy();

    // Quán gắn được hiển thị từ đối tác
    expect(screen.getByText('The Running Bean')).toBeTruthy();
    expect(screen.getAllByText(VOUCHERS_COPY.partner.any).length).toBeGreaterThan(0);

    // Trước khi bấm nút, chưa gọi /qr (AC1)
    expect(qrRequested).toBe(false);

    await screen.unmount();
  });

  it('bấm Hiện mã QR: hiển thị QR, bật bảo vệ màn hình, và token không xuất hiện trong text', async () => {
    const SECRET_TOKEN = 'secret-token-xyz-123456';

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: createMemoryTokenStore(),
      fetch: createFakeFetch((url) => {
        if (url.includes(`/me/vouchers/${VOUCHER_ACTIVE.id}/qr`)) {
          const qrResponse: VoucherQrResponse = {
            token: SECRET_TOKEN,
            expiresAt: new Date(Date.now() + 90_000).toISOString(),
          };
          return { status: 200, body: qrResponse };
        }
        if (url.includes('/me/vouchers')) {
          const response: MyVouchersResponse = { items: [VOUCHER_ACTIVE] };
          return { status: 200, body: response };
        }
        if (url.includes('/partners')) {
          return { status: 200, body: SAMPLE_PARTNERS };
        }
        return { status: 404, body: {} };
      }),
    });

    const screen = await renderWithProviders(<VouchersScreen />, {
      client,
      queryClient: createTestQueryClient(),
    });

    const showButton = await screen.findByTestId(`voucher-show-${VOUCHER_ACTIVE.id}`);
    await waitFor(() => {
      expect(showButton.props.accessibilityState?.disabled ?? false).toBe(false);
    });

    await fireEvent.press(showButton);

    // Hiển thị mã QR và hướng dẫn
    const qrElement = await screen.findByTestId('voucher-qr');
    expect(qrElement).toBeTruthy();
    expect(screen.getByText(VOUCHERS_COPY.qrInstructions)).toBeTruthy();

    // usePreventScreenCapture được gọi với 'voucher'
    expect(mockPreventScreenCapture).toHaveBeenCalledWith('voucher');

    // Token không xuất hiện trong text
    expect(screen.queryByText(SECRET_TOKEN)).toBeNull();

    // Bấm lại nút để ẩn QR
    const hideButton = screen.getByTestId(`voucher-show-${VOUCHER_ACTIVE.id}`);
    expect(screen.getByText(VOUCHERS_COPY.actions.hideQr)).toBeTruthy();
    await fireEvent.press(hideButton);

    await waitFor(() => {
      expect(screen.queryByTestId('voucher-qr')).toBeNull();
    });

    await screen.unmount();
  });

  it('REDEEMED sau poll 5_000ms → ẩn QR và hiện khối voucher-redeemed', async () => {
    jest.useFakeTimers();

    let isRedeemed = false;
    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: createMemoryTokenStore(),
      fetch: createFakeFetch((url) => {
        if (url.includes(`/me/vouchers/${VOUCHER_ACTIVE.id}/qr`)) {
          const qrResponse: VoucherQrResponse = {
            token: 'token-poll-test',
            expiresAt: new Date(Date.now() + 90_000).toISOString(),
          };
          return { status: 200, body: qrResponse };
        }
        if (url.includes('/me/vouchers')) {
          const currentVoucher: MyVoucher = isRedeemed
            ? {
                ...VOUCHER_ACTIVE,
                status: 'REDEEMED',
                redeemedAt: '2026-11-24T12:00:00.000Z',
              }
            : VOUCHER_ACTIVE;
          const response: MyVouchersResponse = { items: [currentVoucher] };
          return { status: 200, body: response };
        }
        if (url.includes('/partners')) {
          return { status: 200, body: SAMPLE_PARTNERS };
        }
        return { status: 404, body: {} };
      }),
    });

    const screen = await renderWithProviders(<VouchersScreen />, {
      client,
      queryClient: createTestQueryClient(),
    });

    const showButton = await screen.findByTestId(`voucher-show-${VOUCHER_ACTIVE.id}`);
    await fireEvent.press(showButton);

    // QR hiện lên
    expect(await screen.findByTestId('voucher-qr')).toBeTruthy();

    // Giả lập quán đã quét voucher trên hệ thống
    isRedeemed = true;

    // Tiến hành poll sau 5_000ms
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5_100);
    });

    // Sau khi poll, voucher chuyển sang REDEEMED: QR ẩn đi, xuất hiện khối voucher-redeemed
    await waitFor(() => {
      expect(screen.queryByTestId('voucher-qr')).toBeNull();
      expect(screen.getByTestId('voucher-redeemed')).toBeTruthy();
      expect(screen.getByText(VOUCHERS_COPY.redeemedBanner)).toBeTruthy();
    });

    jest.useRealTimers();
    await screen.unmount();
  });

  it('làm mới mã lỗi mạng khi mã hiện tại còn hạn → vẫn hiện QR', async () => {
    let qrCalls = 0;
    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: createMemoryTokenStore(),
      fetch: createFakeFetch((url) => {
        if (url.includes('/qr')) {
          qrCalls += 1;
          if (qrCalls > 1) {
            return { status: 503, body: createProblemBody({ code: 'INTERNAL_ERROR', status: 503 }) };
          }
          const body: VoucherQrResponse = {
            token: 'token-still-valid',
            expiresAt: new Date(Date.now() + 90_000).toISOString(),
          };
          return { status: 200, body };
        }
        if (url.includes('/me/vouchers')) {
          return { status: 200, body: { items: [VOUCHER_ACTIVE] } satisfies MyVouchersResponse };
        }
        return { status: 200, body: SAMPLE_PARTNERS };
      }),
    });
    const queryClient = createTestQueryClient();
    const screen = await renderWithProviders(<VouchersScreen />, { client, queryClient });

    await fireEvent.press(await screen.findByTestId(`voucher-show-${VOUCHER_ACTIVE.id}`));
    expect(await screen.findByTestId('voucher-qr')).toBeTruthy();
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['vouchers-qr'] });
    });
    expect(qrCalls).toBeGreaterThan(1);
    expect(screen.getByTestId('voucher-qr')).toBeTruthy();

    await screen.unmount();
  });

  it('lỗi /qr VOUCHER_NOT_ACTIVE hiển thị thông báo lỗi thân thiện qua messageFor', async () => {
    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: createMemoryTokenStore(),
      fetch: createFakeFetch((url) => {
        if (url.includes('/qr')) {
          return {
            status: 409,
            body: createProblemBody({
              code: 'VOUCHER_NOT_ACTIVE',
              status: 409,
            }),
          };
        }
        if (url.includes('/me/vouchers')) {
          const response: MyVouchersResponse = { items: [VOUCHER_ACTIVE] };
          return { status: 200, body: response };
        }
        if (url.includes('/partners')) {
          return { status: 200, body: SAMPLE_PARTNERS };
        }
        return { status: 404, body: {} };
      }),
    });

    const screen = await renderWithProviders(<VouchersScreen />, {
      client,
      queryClient: createTestQueryClient(),
    });

    const showButton = await screen.findByTestId(`voucher-show-${VOUCHER_ACTIVE.id}`);
    await fireEvent.press(showButton);

    // Hiển thị tiêu đề lỗi của VOUCHER_NOT_ACTIVE từ messageFor
    expect(await screen.findByText(messageFor({ code: 'VOUCHER_NOT_ACTIVE' }).title)).toBeTruthy();

    await screen.unmount();
  });

  it('nút back điều hướng quay lại', async () => {
    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: createMemoryTokenStore(),
      fetch: createFakeFetch(() => ({ status: 200, body: { items: [] } })),
    });

    const screen = await renderWithProviders(<VouchersScreen />, {
      client,
      queryClient: createTestQueryClient(),
    });

    const backButton = await screen.findByLabelText(VOUCHERS_COPY.header.back);
    await fireEvent.press(backButton);
    expect(mockBack).toHaveBeenCalled();

    await screen.unmount();
  });
});
