import { createApiClient, createMemoryTokenStore } from '@tamgiao/api-client';
import { REFUND_SLA_HOURS, VOUCHER_TTL_DAYS } from '@tamgiao/contracts/constants';
import type { KycProgressResponse } from '@tamgiao/contracts/verification';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import {
  createFakeFetch,
  createProblemBody,
  createTestQueryClient,
  renderWithProviders,
} from '../../test-utils/render-with-providers.js';
import { formatVnd } from '../payment/index.js';
import { KYC_COPY } from './copy.js';
import { VERIFICATION_STATUS_COPY } from './status-copy.js';
import { formatLocalDate, formatLocalDateTime } from './status-model.js';
import { VerificationStatusScreen } from './verification-status-screen.js';

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

const mockReceivedListeners: Array<(n: unknown) => void> = [];
jest.mock('expo-notifications', () => ({
  addNotificationReceivedListener: (cb: (n: unknown) => void) => {
    mockReceivedListeners.push(cb);
    return {
      remove: () => {
        const i = mockReceivedListeners.indexOf(cb);
        if (i >= 0) mockReceivedListeners.splice(i, 1);
      },
    };
  },
}));

function buildKyc(overrides: Partial<KycProgressResponse> = {}): KycProgressResponse {
  return {
    status: 'SUBMITTED',
    submittedAt: '2026-11-22T08:00:00.000Z',
    decidedAt: null,
    steps: [
      { step: 'CCCD_CHIP', status: 'PASSED', decidedAt: '2026-11-22T08:05:00.000Z' },
      { step: 'MARITAL_STATUS', status: 'PENDING', decidedAt: null },
      { step: 'MANUAL_REVIEW', status: 'PENDING', decidedAt: null },
      { step: 'INTERVIEW', status: 'PENDING', decidedAt: null },
    ],
    moreInfo: null,
    rejectionReason: null,
    ...overrides,
  };
}

describe('VerificationStatusScreen (FE-S3-04)', () => {
  let kycBody: unknown = null;
  let kycStatus = 200;
  let paymentsBody: unknown = { items: [] };
  let paymentsStatus = 200;
  let vouchersBody: unknown = { items: [] };
  let vouchersStatus = 200;
  let partnersBody: unknown = { items: [] };
  let partnersStatus = 200;
  let kycCallCount = 0;
  let interviewCallCount = 0;

  const fakeFetch = createFakeFetch((url) => {
    if (url === 'http://api.test/me/kyc') {
      kycCallCount++;
      return { status: kycStatus, body: kycBody };
    }
    if (url === 'http://api.test/me/payments') {
      return { status: paymentsStatus, body: paymentsBody };
    }
    if (url === 'http://api.test/me/vouchers') {
      return { status: vouchersStatus, body: vouchersBody };
    }
    if (url === 'http://api.test/partners') {
      return { status: partnersStatus, body: partnersBody };
    }
    if (url === 'http://api.test/me/kyc/interview') {
      interviewCallCount++;
      return { status: 200, body: { booking: null } };
    }
    return { status: 404 };
  });

  const setupScreen = async () => {
    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: createMemoryTokenStore(),
      fetch: fakeFetch,
    });
    const queryClient = createTestQueryClient();
    return renderWithProviders(<VerificationStatusScreen />, { client, queryClient });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockReceivedListeners.length = 0;
    kycCallCount = 0;
    interviewCallCount = 0;
    kycStatus = 200;
    paymentsStatus = 200;
    vouchersStatus = 200;
    partnersStatus = 200;
    kycBody = buildKyc();
    paymentsBody = { items: [] };
    vouchersBody = { items: [] };
    partnersBody = { items: [] };
  });

  it('a. SUBMITTED + payment SUCCEEDED + voucher RESERVED (expiresAt null, partnerId null) + partners 2 quán: hiển thị đầy đủ thông tin, không chứa từ ngữ cấm', async () => {
    kycBody = buildKyc({
      status: 'SUBMITTED',
      steps: [
        { step: 'CCCD_CHIP', status: 'PASSED', decidedAt: '2026-11-22T08:05:00.000Z' },
        { step: 'MARITAL_STATUS', status: 'PENDING', decidedAt: null },
        { step: 'MANUAL_REVIEW', status: 'PENDING', decidedAt: null },
        { step: 'INTERVIEW', status: 'PENDING', decidedAt: null },
      ],
    });

    paymentsBody = {
      items: [
        {
          paymentId: '01890a5d-ac96-774b-bcce-b302099a8057',
          orderId: 'ORD-1',
          status: 'SUCCEEDED',
          amountVnd: 299000,
          checkoutUrl: null,
          qrData: null,
          createdAt: '2026-11-22T08:00:00.000Z',
          succeededAt: '2026-11-22T08:05:00.000Z',
          failedAt: null,
          refundedAt: null,
        },
      ],
    };

    vouchersBody = {
      items: [
        {
          id: '01890a5d-ac96-774b-bcce-b302099a8058',
          status: 'RESERVED',
          valueVnd: 300000,
          expiresAt: null,
          partnerId: null,
          issuedAt: '2026-11-22T08:05:00.000Z',
          activatedAt: null,
          redeemedAt: null,
        },
      ],
    };

    partnersBody = {
      items: [
        {
          id: '01890a5d-ac96-774b-bcce-b302099a8059',
          name: 'Quán A',
          address: '123 Đường 1',
          photoUrl: null,
          tags: ['cafe'],
        },
        {
          id: '01890a5d-ac96-774b-bcce-b302099a805a',
          name: 'Quán B',
          address: '456 Đường 2',
          photoUrl: null,
          tags: ['tea'],
        },
      ],
    };

    const screen = await setupScreen();

    await waitFor(() => {
      expect(screen.getByText(VERIFICATION_STATUS_COPY.status.SUBMITTED.badge)).toBeTruthy();
      expect(screen.getByText(VERIFICATION_STATUS_COPY.status.SUBMITTED.title)).toBeTruthy();
      expect(screen.getByText(VERIFICATION_STATUS_COPY.payment.recorded(formatVnd(299000)))).toBeTruthy();
      expect(screen.getByText(VERIFICATION_STATUS_COPY.voucher.title(formatVnd(300000)))).toBeTruthy();
      expect(screen.getByText(VERIFICATION_STATUS_COPY.voucher.status.RESERVED)).toBeTruthy();
      expect(screen.getByText(VERIFICATION_STATUS_COPY.voucher.ttlPending(VOUCHER_TTL_DAYS))).toBeTruthy();
      expect(screen.getByText(VERIFICATION_STATUS_COPY.voucher.usableAt('Quán A, Quán B'))).toBeTruthy();
      expect(screen.getByTestId('status-step-state-CCCD_CHIP')).toHaveTextContent(
        VERIFICATION_STATUS_COPY.steps.states.passed,
      );
      expect(screen.getByTestId('status-step-state-MARITAL_STATUS')).toHaveTextContent(
        VERIFICATION_STATUS_COPY.steps.states.current,
      );
      expect(screen.getByText(VERIFICATION_STATUS_COPY.steps.progress(1, 4))).toBeTruthy();
    });

    // Không có từ ngữ nhạy cảm cấm
    expect(screen.queryByText(/ký quỹ|bảo chứng|VNeID|UBND|Bộ Công An|cố vấn/i)).toBeNull();

    await screen.unmount();
  });

  it('b. UNDER_REVIEW + voucher có partnerId khớp 1 quán: usableAt chỉ tên quán đó', async () => {
    kycBody = buildKyc({
      status: 'UNDER_REVIEW',
    });

    vouchersBody = {
      items: [
        {
          id: '01890a5d-ac96-774b-bcce-b302099a8058',
          status: 'RESERVED',
          valueVnd: 300000,
          expiresAt: null,
          partnerId: '01890a5d-ac96-774b-bcce-b302099a805a',
          issuedAt: '2026-11-22T08:05:00.000Z',
          activatedAt: null,
          redeemedAt: null,
        },
      ],
    };

    partnersBody = {
      items: [
        {
          id: '01890a5d-ac96-774b-bcce-b302099a8059',
          name: 'Quán A',
          address: '123 Đường 1',
          photoUrl: null,
          tags: ['cafe'],
        },
        {
          id: '01890a5d-ac96-774b-bcce-b302099a805a',
          name: 'Quán B',
          address: '456 Đường 2',
          photoUrl: null,
          tags: ['tea'],
        },
      ],
    };

    const screen = await setupScreen();

    await waitFor(() => {
      expect(screen.getByText(VERIFICATION_STATUS_COPY.voucher.usableAt('Quán B'))).toBeTruthy();
      expect(screen.queryByText(/Quán A/)).toBeNull();
    });

    await screen.unmount();
  });

  it('c. NEEDS_MORE_INFO (moreInfo items [SELFIE], note Ảnh mờ): hiện nhãn + note, bấm CTA điều hướng sang /(verification)/kyc', async () => {
    kycBody = buildKyc({
      status: 'NEEDS_MORE_INFO',
      moreInfo: {
        items: ['SELFIE'],
        note: 'Ảnh mờ',
      },
    });

    const screen = await setupScreen();

    await waitFor(() => {
      expect(screen.getByText(new RegExp(KYC_COPY.moreInfo.items.SELFIE))).toBeTruthy();
      expect(screen.getByText('Ảnh mờ')).toBeTruthy();
      expect(screen.getByTestId('status-more-info-cta')).toBeTruthy();
    });

    const cta = screen.getByTestId('status-more-info-cta');
    await act(async () => {
      await fireEvent.press(cta);
    });

    expect(mockPush).toHaveBeenCalledWith('/(verification)/kyc');

    await screen.unmount();
  });

  it('d. APPROVED + voucher ACTIVE expiresAt: hiện hạn dùng đến ngày, bấm CTA điều hướng replace /', async () => {
    kycBody = buildKyc({
      status: 'APPROVED',
      decidedAt: '2026-11-23T10:00:00.000Z',
      steps: [
        { step: 'CCCD_CHIP', status: 'PASSED', decidedAt: '2026-11-23T08:00:00.000Z' },
        { step: 'MARITAL_STATUS', status: 'PASSED', decidedAt: '2026-11-23T08:30:00.000Z' },
        { step: 'MANUAL_REVIEW', status: 'PASSED', decidedAt: '2026-11-23T09:00:00.000Z' },
        { step: 'INTERVIEW', status: 'PASSED', decidedAt: '2026-11-23T10:00:00.000Z' },
      ],
    });

    const expiresAt = '2027-02-23T10:00:00.000Z';
    vouchersBody = {
      items: [
        {
          id: '01890a5d-ac96-774b-bcce-b302099a8058',
          status: 'ACTIVE',
          valueVnd: 300000,
          expiresAt,
          partnerId: null,
          issuedAt: '2026-11-22T08:00:00.000Z',
          activatedAt: '2026-11-23T10:00:00.000Z',
          redeemedAt: null,
        },
      ],
    };

    const screen = await setupScreen();

    await waitFor(() => {
      expect(
        screen.getByText(VERIFICATION_STATUS_COPY.voucher.expiresAt(formatLocalDate(expiresAt))),
      ).toBeTruthy();
      expect(screen.getByTestId('status-approved-cta')).toBeTruthy();
    });

    const cta = screen.getByTestId('status-approved-cta');
    await act(async () => {
      await fireEvent.press(cta);
    });

    expect(mockReplace).toHaveBeenCalledWith('/');

    await screen.unmount();
  });

  it('e. REJECTED + rejectionReason FACE_MISMATCH + payment SUCCEEDED: hiện lý do, cam kết hoàn tiền notStarted và deadline', async () => {
    const decidedAt = '2026-11-23T10:00:00.000Z';
    kycBody = buildKyc({
      status: 'REJECTED',
      decidedAt,
      rejectionReason: 'FACE_MISMATCH',
    });

    paymentsBody = {
      items: [
        {
          paymentId: '01890a5d-ac96-774b-bcce-b302099a8057',
          orderId: 'ORD-1',
          status: 'SUCCEEDED',
          amountVnd: 299000,
          checkoutUrl: null,
          qrData: null,
          createdAt: '2026-11-22T08:00:00.000Z',
          succeededAt: '2026-11-22T08:05:00.000Z',
          failedAt: null,
          refundedAt: null,
        },
      ],
    };

    const screen = await setupScreen();

    const expectedDeadline = new Date(new Date(decidedAt).getTime() + REFUND_SLA_HOURS * 3_600_000);

    await waitFor(() => {
      expect(screen.getByTestId('status-rejection-reason')).toBeTruthy();
      expect(screen.getByText(VERIFICATION_STATUS_COPY.rejection.reasons.FACE_MISMATCH)).toBeTruthy();
      expect(screen.getByText(VERIFICATION_STATUS_COPY.refund.notStarted(REFUND_SLA_HOURS))).toBeTruthy();
      expect(
        screen.getByText(VERIFICATION_STATUS_COPY.refund.deadline(formatLocalDateTime(expectedDeadline))),
      ).toBeTruthy();
    });

    await screen.unmount();
  });

  it('f. REJECTED + payment REFUND_PENDING: hiện trạng thái Đang xử lý hoàn tiền', async () => {
    const decidedAt = '2026-11-23T10:00:00.000Z';
    kycBody = buildKyc({
      status: 'REJECTED',
      decidedAt,
      rejectionReason: 'OTHER',
    });

    paymentsBody = {
      items: [
        {
          paymentId: '01890a5d-ac96-774b-bcce-b302099a8057',
          orderId: 'ORD-1',
          status: 'REFUND_PENDING',
          amountVnd: 299000,
          checkoutUrl: null,
          qrData: null,
          createdAt: '2026-11-22T08:00:00.000Z',
          succeededAt: '2026-11-22T08:05:00.000Z',
          failedAt: null,
          refundedAt: null,
        },
      ],
    };

    const screen = await setupScreen();

    await waitFor(() => {
      expect(screen.getByText(VERIFICATION_STATUS_COPY.refund.pending)).toBeTruthy();
    });

    await screen.unmount();
  });

  it('g. REJECTED + payment REFUNDED: hiện số tiền đã hoàn và thời gian hoàn', async () => {
    const decidedAt = '2026-11-23T10:00:00.000Z';
    const refundedAt = '2026-11-24T12:00:00.000Z';
    kycBody = buildKyc({
      status: 'REJECTED',
      decidedAt,
      rejectionReason: 'OTHER',
    });

    paymentsBody = {
      items: [
        {
          paymentId: '01890a5d-ac96-774b-bcce-b302099a8057',
          orderId: 'ORD-1',
          status: 'REFUNDED',
          amountVnd: 299000,
          checkoutUrl: null,
          qrData: null,
          createdAt: '2026-11-22T08:00:00.000Z',
          succeededAt: '2026-11-22T08:05:00.000Z',
          failedAt: null,
          refundedAt,
        },
      ],
    };

    const screen = await setupScreen();

    await waitFor(() => {
      expect(screen.getByText(VERIFICATION_STATUS_COPY.refund.refunded(formatVnd(299000)))).toBeTruthy();
      expect(
        screen.getByText(VERIFICATION_STATUS_COPY.refund.refundedAt(formatLocalDateTime(refundedAt))),
      ).toBeTruthy();
    });

    await screen.unmount();
  });

  it('h. Lỗi GET /me/kyc 500 -> ErrorState; vouchers lỗi 500 -> màn vẫn render, không có status-voucher', async () => {
    // Trường hợp 1: kyc lỗi 500
    kycStatus = 500;
    kycBody = createProblemBody({
      code: 'INTERNAL_ERROR',
      status: 500,
      title: 'Lỗi máy chủ nội bộ',
    });

    const screenKycError = await setupScreen();
    await waitFor(() => {
      expect(screenKycError.getByLabelText('Thử lại')).toBeTruthy();
      expect(screenKycError.queryByText('Lỗi máy chủ nội bộ')).toBeNull();
    });
    await screenKycError.unmount();

    // Trường hợp 2: kyc 200, vouchers 500
    kycStatus = 200;
    kycBody = buildKyc();
    vouchersStatus = 500;
    vouchersBody = createProblemBody({
      code: 'VOUCHER_ERROR',
      status: 500,
    });

    const screenVoucherError = await setupScreen();
    await waitFor(() => {
      expect(screenVoucherError.getByTestId('status-card')).toBeTruthy();
      expect(screenVoucherError.queryByTestId('status-voucher')).toBeNull();
    });
    await screenVoucherError.unmount();
  });

  it('i. AC1: Push KYC_APPROVED tự làm mới query (thấy APPROVED và ACTIVE); push MESSAGE_RECEIVED không làm tăng số lần gọi /me/kyc', async () => {
    kycBody = buildKyc({
      status: 'UNDER_REVIEW',
    });
    vouchersBody = {
      items: [
        {
          id: '01890a5d-ac96-774b-bcce-b302099a8058',
          status: 'RESERVED',
          valueVnd: 300000,
          expiresAt: null,
          partnerId: null,
          issuedAt: '2026-11-22T08:05:00.000Z',
          activatedAt: null,
          redeemedAt: null,
        },
      ],
    };

    const screen = await setupScreen();

    await waitFor(() => {
      expect(screen.getByText(VERIFICATION_STATUS_COPY.status.UNDER_REVIEW.title)).toBeTruthy();
      expect(screen.getByText(VERIFICATION_STATUS_COPY.voucher.status.RESERVED)).toBeTruthy();
    });

    // Cập nhật server body
    kycBody = buildKyc({
      status: 'APPROVED',
      decidedAt: '2026-11-23T10:00:00.000Z',
      steps: [
        { step: 'CCCD_CHIP', status: 'PASSED', decidedAt: '2026-11-23T08:00:00.000Z' },
        { step: 'MARITAL_STATUS', status: 'PASSED', decidedAt: '2026-11-23T08:30:00.000Z' },
        { step: 'MANUAL_REVIEW', status: 'PASSED', decidedAt: '2026-11-23T09:00:00.000Z' },
        { step: 'INTERVIEW', status: 'PASSED', decidedAt: '2026-11-23T10:00:00.000Z' },
      ],
    });
    vouchersBody = {
      items: [
        {
          id: '01890a5d-ac96-774b-bcce-b302099a8058',
          status: 'ACTIVE',
          valueVnd: 300000,
          expiresAt: '2027-02-23T10:00:00.000Z',
          partnerId: null,
          issuedAt: '2026-11-22T08:05:00.000Z',
          activatedAt: '2026-11-23T10:00:00.000Z',
          redeemedAt: null,
        },
      ],
    };

    // Bắn push notification KYC_APPROVED
    await act(async () => {
      mockReceivedListeners.forEach((l) =>
        l({
          request: {
            content: {
              data: {
                kind: 'KYC_APPROVED',
                deliveryId: '01890a5d-ac96-774b-bcce-b302099a8057',
                submissionId: '01890a5d-ac96-774b-bcce-b302099a8058',
              },
            },
          },
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByText(VERIFICATION_STATUS_COPY.status.APPROVED.title)).toBeTruthy();
      expect(screen.getByText(VERIFICATION_STATUS_COPY.voucher.status.ACTIVE)).toBeTruthy();
    });

    // Thử gửi push notification MESSAGE_RECEIVED (không thuộc VERIFICATION_STATUS_PUSH_KINDS)
    const callCountBefore = kycCallCount;
    await act(async () => {
      mockReceivedListeners.forEach((l) =>
        l({
          request: {
            content: {
              data: {
                kind: 'MESSAGE_RECEIVED',
                deliveryId: '01890a5d-ac96-774b-bcce-b302099a8059',
                conversationId: '01890a5d-ac96-774b-bcce-b302099a805a',
              },
            },
          },
        }),
      );
    });

    expect(kycCallCount).toBe(callCountBefore);

    await screen.unmount();
  });

  it('j. Kéo để làm mới: gọi onRefresh cập nhật trạng thái mới nhất', async () => {
    kycBody = buildKyc({
      status: 'SUBMITTED',
    });

    const screen = await setupScreen();

    await waitFor(() => {
      expect(screen.getByText(VERIFICATION_STATUS_COPY.status.SUBMITTED.title)).toBeTruthy();
    });

    // Thay đổi dữ liệu phía server
    kycBody = buildKyc({
      status: 'UNDER_REVIEW',
    });

    // Kéo để làm mới
    await act(async () => {
      await screen.getByTestId('verification-status-scroll').props.refreshControl.props.onRefresh();
    });

    await waitFor(() => {
      expect(screen.getByText(VERIFICATION_STATUS_COPY.status.UNDER_REVIEW.title)).toBeTruthy();
    });

    await screen.unmount();
  });

  it('k. NOT_SUBMITTED / DRAFT: hiện nút tiếp tục xác thực, bấm chuyển sang /(verification)/start', async () => {
    kycBody = buildKyc({
      status: 'NOT_SUBMITTED',
      steps: [
        { step: 'CCCD_CHIP', status: 'PENDING', decidedAt: null },
        { step: 'MARITAL_STATUS', status: 'PENDING', decidedAt: null },
        { step: 'MANUAL_REVIEW', status: 'PENDING', decidedAt: null },
        { step: 'INTERVIEW', status: 'PENDING', decidedAt: null },
      ],
    });

    const screen = await setupScreen();

    await waitFor(() => {
      expect(screen.getByTestId('status-continue-cta')).toBeTruthy();
    });

    const cta = screen.getByTestId('status-continue-cta');
    await act(async () => {
      await fireEvent.press(cta);
    });

    expect(mockReplace).toHaveBeenCalledWith('/(verification)/start');

    await screen.unmount();
  });

  it('l. Nút back trên header: bấm gọi router.back() khi canGoBack', async () => {
    const screen = await setupScreen();

    await waitFor(() => {
      expect(screen.getByLabelText(VERIFICATION_STATUS_COPY.header.back)).toBeTruthy();
    });

    const backBtn = screen.getByLabelText(VERIFICATION_STATUS_COPY.header.back);
    await act(async () => {
      await fireEvent.press(backBtn);
    });

    expect(mockBack).toHaveBeenCalled();

    await screen.unmount();
  });
  it('m. hồ sơ đã nộp, chưa quyết định → hiện lối vào đặt lịch phỏng vấn; đã duyệt → không hiện, không gọi API phỏng vấn', async () => {
    kycBody = buildKyc({ status: 'UNDER_REVIEW' });
    const first = await setupScreen();
    expect(await first.findByTestId('interview-entry-card')).toBeTruthy();
    await first.unmount();

    interviewCallCount = 0;
    kycBody = buildKyc({ status: 'APPROVED' });
    const second = await setupScreen();
    await waitFor(() => {
      expect(second.getByText(VERIFICATION_STATUS_COPY.status.APPROVED.title)).toBeTruthy();
    });
    expect(second.queryByTestId('interview-entry-card')).toBeNull();
    expect(interviewCallCount).toBe(0);
  });
});
