// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach, afterAll, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { messageFor } from '@tamgiao/api-client';
import { TEST_API_URL, problem } from '@tamgiao/api-client/mocks';
import type { AdminFeedbackDetailResponse, AppearanceFlagQueueResponse } from '@tamgiao/contracts/dating';
import type { AdminRefundResponse, ReconciliationReportListResponse } from '@tamgiao/contracts/billing';
import { server, meHandler } from '../../test-utils/msw-server';
import { adminMe } from '../../test-utils/fixtures';
import { renderApp } from '../../test-utils/render-app';
import { FORBIDDEN_COPY, NAV_COPY, SHELL_COPY } from '../../layout/copy';
import { APPEARANCE_FLAGS_COPY, REFUNDS_COPY, RECONCILIATION_COPY } from '../../features/operations/copy';

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

beforeEach(() => {
  server.use(meHandler(adminMe('SUPERVISOR')));
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});

const FEEDBACK_ID_1 = '01890a5d-ac96-774b-bcce-b302099a8011';
const FEEDBACK_ID_2 = '01890a5d-ac96-774b-bcce-b302099a8012';
const MATCH_ID = '01890a5d-ac96-774b-bcce-b302099a8013';
const DATE_PLAN_ID = '01890a5d-ac96-774b-bcce-b302099a8014';
const AUTHOR_ID = '01890a5d-ac96-774b-bcce-b302099a8015';
const SUBJECT_ID = '01890a5d-ac96-774b-bcce-b302099a8016';
const PAYMENT_ID = '01890a5d-ac96-774b-bcce-b302099a8017';
const REPORT_ID = '01890a5d-ac96-774b-bcce-b302099a8018';

function makeFeedbackItem(
  overrides?: Partial<AppearanceFlagQueueResponse['items'][number]>,
): AppearanceFlagQueueResponse['items'][number] {
  return {
    feedbackId: FEEDBACK_ID_1,
    matchId: MATCH_ID,
    datePlanId: DATE_PLAN_ID,
    authorId: AUTHOR_ID,
    subjectId: SUBJECT_ID,
    submittedAt: '2026-11-24T10:00:00.000Z',
    ...overrides,
  };
}

function makeFeedbackDetail(overrides?: Partial<AdminFeedbackDetailResponse>): AdminFeedbackDetailResponse {
  return {
    id: FEEDBACK_ID_1,
    matchId: MATCH_ID,
    datePlanId: DATE_PLAN_ID,
    authorId: AUTHOR_ID,
    subjectId: SUBJECT_ID,
    rating: 4,
    profileMatch: 'DIFFERENT',
    feeling: 'DEEP_INTEREST',
    decision: 'B_STOP',
    stopReasons: ['NO_SPARK'],
    stopNote: 'Cần người phù hợp hơn về lối sống.',
    submittedAt: '2026-11-24T10:00:00.000Z',
    ...overrides,
  };
}

describe('OperationsPages', () => {
  describe('1. Quyền truy cập & Menu theo vai trò (AC1)', () => {
    it('REVIEWER: menu chỉ thấy "Cờ khác biệt eKYC", không thấy "Hoàn tiền" và "Đối soát"', async () => {
      server.use(meHandler(adminMe('REVIEWER')));

      await renderApp('/', { token: 'valid-token' });

      const nav = await screen.findByRole('navigation', { name: SHELL_COPY.navLabel });
      expect(within(nav).getByRole('link', { name: NAV_COPY.appearanceFlags })).toBeTruthy();
      expect(within(nav).queryByRole('link', { name: NAV_COPY.refunds })).toBeNull();
      expect(within(nav).queryByRole('link', { name: NAV_COPY.reconciliation })).toBeNull();
    });

    it('MATCHMAKER: không thấy mục nào trong ba mục mới, vào URL trực tiếp → FORBIDDEN_COPY.title', async () => {
      server.use(meHandler(adminMe('MATCHMAKER')));

      const home = await renderApp('/', { token: 'valid-token' });
      const nav = await screen.findByRole('navigation', { name: SHELL_COPY.navLabel });
      for (const name of [NAV_COPY.appearanceFlags, NAV_COPY.refunds, NAV_COPY.reconciliation]) {
        expect(within(nav).queryByRole('link', { name })).toBeNull();
      }
      home.unmount();

      for (const path of [
        '/operations/appearance-flags',
        '/operations/refunds',
        '/operations/reconciliation',
      ]) {
        const view = await renderApp(path, { token: 'valid-token' });
        expect(await screen.findByText(FORBIDDEN_COPY.title)).toBeTruthy();
        view.unmount();
      }
    });
  });

  describe('2. Cờ khác biệt eKYC (danh sách + chi tiết)', () => {
    it('danh sách cờ: không gọi API chi tiết khi nạp, phân trang offset hoạt động, bấm cờ gọi chi tiết ĐÚNG 1 lần', async () => {
      let detailFetchCount = 0;
      const requestedOffsets: string[] = [];

      server.use(
        http.get(`${TEST_API_URL}/admin/dating/appearance-flags`, ({ request }) => {
          const url = new URL(request.url);
          const offset = url.searchParams.get('offset') ?? '0';
          requestedOffsets.push(offset);

          if (offset === '0') {
            return HttpResponse.json<AppearanceFlagQueueResponse>({
              items: [makeFeedbackItem({ feedbackId: FEEDBACK_ID_1 })],
              total: 2,
            });
          }
          return HttpResponse.json<AppearanceFlagQueueResponse>({
            items: [makeFeedbackItem({ feedbackId: FEEDBACK_ID_2 })],
            total: 2,
          });
        }),
        http.get(`${TEST_API_URL}/admin/dating/feedbacks/:id`, () => {
          detailFetchCount++;
          return HttpResponse.json<AdminFeedbackDetailResponse>(makeFeedbackDetail());
        }),
      );

      await renderApp('/operations/appearance-flags', { token: 'valid-token' });

      // Nạp danh sách lần đầu không được gọi API chi tiết (tránh audit thừa)
      expect(await screen.findByText(FEEDBACK_ID_1)).toBeTruthy();
      expect(detailFetchCount).toBe(0);

      // Phân trang offset: total = 2, trang 1 có 1 phần tử → nút "Tải thêm cờ"
      const loadMoreBtn = screen.getByRole('button', { name: APPEARANCE_FLAGS_COPY.loadMore });
      fireEvent.click(loadMoreBtn);

      expect(await screen.findByText(FEEDBACK_ID_2)).toBeTruthy();
      expect(requestedOffsets).toContain('1');
      expect(detailFetchCount).toBe(0);

      // Bấm vào cờ đầu tiên → gọi API chi tiết ĐÚNG 1 lần
      const itemLink = screen.getByRole('link', { name: new RegExp(FEEDBACK_ID_1) });
      fireEvent.click(itemLink);

      expect(await screen.findByText(APPEARANCE_FLAGS_COPY.profileMatches.DIFFERENT)).toBeTruthy();
      expect(detailFetchCount).toBe(1);
    });

    it('chi tiết cờ: hiển thị đúng các nhãn enum satisfies, rating, stopNote, và cảnh báo bảo mật', async () => {
      server.use(
        http.get(`${TEST_API_URL}/admin/dating/appearance-flags`, () => {
          return HttpResponse.json<AppearanceFlagQueueResponse>({
            items: [makeFeedbackItem({ feedbackId: FEEDBACK_ID_1 })],
            total: 1,
          });
        }),
        http.get(`${TEST_API_URL}/admin/dating/feedbacks/${FEEDBACK_ID_1}`, () => {
          return HttpResponse.json<AdminFeedbackDetailResponse>(
            makeFeedbackDetail({
              rating: 4,
              profileMatch: 'DIFFERENT',
              feeling: 'DEEP_INTEREST',
              decision: 'B_STOP',
              stopReasons: ['NO_SPARK'],
              stopNote: 'Cần người phù hợp hơn về lối sống.',
            }),
          );
        }),
      );

      await renderApp(`/operations/appearance-flags/${FEEDBACK_ID_1}`, { token: 'valid-token' });

      // Nhãn ngoại hình: 'Có khác biệt'
      expect(await screen.findByText(APPEARANCE_FLAGS_COPY.profileMatches.DIFFERENT)).toBeTruthy();
      // Cảm xúc: 'Rất muốn tìm hiểu sâu hơn'
      expect(screen.getByText(APPEARANCE_FLAGS_COPY.feelings.DEEP_INTEREST)).toBeTruthy();
      // Quyết định: 'Dừng tìm hiểu'
      expect(screen.getByText(APPEARANCE_FLAGS_COPY.decisions.B_STOP)).toBeTruthy();
      // Lý do dừng: 'Chưa có rung động'
      expect(screen.getByText(APPEARANCE_FLAGS_COPY.stopReasons.NO_SPARK)).toBeTruthy();
      // Ghi chú dừng
      expect(screen.getByText('Cần người phù hợp hơn về lối sống.')).toBeTruthy();
      // Rating: 4/5
      expect(screen.getByText('4/5')).toBeTruthy();
      // Cảnh báo kín bắt buộc
      expect(screen.getByText(APPEARANCE_FLAGS_COPY.confidentialWarning)).toBeTruthy();
    });

    it('chi tiết cờ: lỗi FEEDBACK_NOT_FOUND hiển thị thông báo lỗi', async () => {
      server.use(
        http.get(`${TEST_API_URL}/admin/dating/appearance-flags`, () => {
          return HttpResponse.json<AppearanceFlagQueueResponse>({ items: [], total: 0 });
        }),
        http.get(`${TEST_API_URL}/admin/dating/feedbacks/:id`, () => {
          return problem(404, 'FEEDBACK_NOT_FOUND');
        }),
      );

      await renderApp(`/operations/appearance-flags/${FEEDBACK_ID_1}`, { token: 'valid-token' });

      expect(await screen.findByText(messageFor({ code: 'FEEDBACK_NOT_FOUND' }).title)).toBeTruthy();
    });
  });

  describe('3. Hoàn tiền thủ công (Refund)', () => {
    it('UUID sai hoặc lý do trống → không gửi API; chưa tick xác nhận → nút hoàn tiền disabled', async () => {
      let postCalled = false;

      server.use(
        http.post(`${TEST_API_URL}/admin/payments/:id/refund`, () => {
          postCalled = true;
          return HttpResponse.json<AdminRefundResponse>(
            {
              paymentId: PAYMENT_ID,
              status: 'REFUND_PENDING',
              refundRequestedAt: '2026-11-24T10:00:00.000Z',
              voucherVoided: true,
            },
            { status: 202 },
          );
        }),
      );

      await renderApp('/operations/refunds', { token: 'valid-token' });

      const continueBtn = await screen.findByRole('button', { name: REFUNDS_COPY.continueBtn });

      // Bấm tiếp tục khi chưa nhập gì
      fireEvent.click(continueBtn);
      expect(await screen.findByText(REFUNDS_COPY.paymentIdRequired)).toBeTruthy();
      expect(screen.getByText(REFUNDS_COPY.reasonRequired)).toBeTruthy();
      expect(postCalled).toBe(false);

      // Nhập UUID sai định dạng
      const paymentInput = screen.getByPlaceholderText(REFUNDS_COPY.paymentIdPlaceholder);
      fireEvent.change(paymentInput, { target: { value: 'not-a-uuid' } });
      fireEvent.click(continueBtn);
      expect(await screen.findByText(REFUNDS_COPY.paymentIdInvalid)).toBeTruthy();
      expect(postCalled).toBe(false);

      // Nhập UUID đúng và lý do
      fireEvent.change(paymentInput, { target: { value: PAYMENT_ID } });
      const reasonInput = screen.getByPlaceholderText(REFUNDS_COPY.reasonPlaceholder);
      fireEvent.change(reasonInput, { target: { value: 'Hồ sơ người dùng không đạt tiêu chuẩn.' } });
      fireEvent.click(continueBtn);

      // Modal xác nhận mở ra, nút xác nhận hoàn tiền bị disabled cho tới khi tick
      const confirmSubmitBtn = await screen.findByRole('button', { name: REFUNDS_COPY.confirmBtn });
      expect(confirmSubmitBtn.hasAttribute('disabled')).toBe(true);

      const checkbox = screen.getByLabelText(REFUNDS_COPY.confirmCheckbox);
      fireEvent.click(checkbox);
      expect(confirmSubmitBtn.hasAttribute('disabled')).toBe(false);
    });

    it('gửi đúng body và URL; hoàn tiền thành công hiện thẻ kết quả + form trống', async () => {
      let capturedPaymentId: string | null = null;
      let capturedBody: unknown = null;

      server.use(
        http.post(`${TEST_API_URL}/admin/payments/:id/refund`, async ({ request, params }) => {
          capturedPaymentId = params.id as string;
          capturedBody = await request.json();
          return HttpResponse.json<AdminRefundResponse>(
            {
              paymentId: capturedPaymentId,
              status: 'REFUND_PENDING',
              refundRequestedAt: '2026-11-24T10:30:00.000Z',
              voucherVoided: true,
            },
            { status: 202 },
          );
        }),
      );

      await renderApp('/operations/refunds', { token: 'valid-token' });

      const paymentInput = await screen.findByPlaceholderText(REFUNDS_COPY.paymentIdPlaceholder);
      fireEvent.change(paymentInput, { target: { value: `  ${PAYMENT_ID.toUpperCase()}  ` } });

      const reasonInput = screen.getByPlaceholderText(REFUNDS_COPY.reasonPlaceholder);
      fireEvent.change(reasonInput, { target: { value: 'Lý do hoàn tiền hợp lệ.' } });

      fireEvent.click(screen.getByRole('button', { name: REFUNDS_COPY.continueBtn }));

      fireEvent.click(await screen.findByLabelText(REFUNDS_COPY.confirmCheckbox));
      fireEvent.click(screen.getByRole('button', { name: REFUNDS_COPY.confirmBtn }));

      await waitFor(() => {
        expect(capturedPaymentId).toBe(PAYMENT_ID);
        expect(capturedBody).toEqual({ reason: 'Lý do hoàn tiền hợp lệ.' });
      });

      // Hiển thị thẻ kết quả thành công
      expect(await screen.findByRole('heading', { name: REFUNDS_COPY.successTitle })).toBeTruthy();
      expect(screen.getByText(REFUNDS_COPY.voucherVoidedYes)).toBeTruthy();

      // Bấm tạo yêu cầu khác → form trống
      fireEvent.click(screen.getByRole('button', { name: REFUNDS_COPY.createAnotherBtn }));
      const newPaymentInput = screen.getByPlaceholderText(
        REFUNDS_COPY.paymentIdPlaceholder,
      ) as HTMLInputElement;
      expect(newPaymentInput.value).toBe('');
    });

    it('lỗi PAYMENT_ALREADY_REFUNDED → role alert hiển thị messageFor và giữ nguyên dữ liệu form', async () => {
      server.use(
        http.post(`${TEST_API_URL}/admin/payments/:id/refund`, () => {
          return problem(409, 'PAYMENT_ALREADY_REFUNDED');
        }),
      );

      await renderApp('/operations/refunds', { token: 'valid-token' });

      const paymentInput = (await screen.findByPlaceholderText(
        REFUNDS_COPY.paymentIdPlaceholder,
      )) as HTMLInputElement;
      fireEvent.change(paymentInput, { target: { value: PAYMENT_ID } });

      const reasonInput = screen.getByPlaceholderText(REFUNDS_COPY.reasonPlaceholder) as HTMLTextAreaElement;
      fireEvent.change(reasonInput, { target: { value: 'Lý do cần giữ lại.' } });

      fireEvent.click(screen.getByRole('button', { name: REFUNDS_COPY.continueBtn }));
      fireEvent.click(await screen.findByLabelText(REFUNDS_COPY.confirmCheckbox));
      fireEvent.click(screen.getByRole('button', { name: REFUNDS_COPY.confirmBtn }));

      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toBe(messageFor({ code: 'PAYMENT_ALREADY_REFUNDED' }).title);

      // Form vẫn giữ nguyên dữ liệu đã nhập
      expect(paymentInput.value).toBe(PAYMENT_ID);
      expect(reasonInput.value).toBe('Lý do cần giữ lại.');
    });
  });

  describe('4. Báo cáo đối soát (Reconciliation)', () => {
    it('lọc MISMATCH gửi status, "Tất cả" không gửi status, phân trang cursor, số tiền lớn và âm hiển thị đúng', async () => {
      let capturedStatus: string | null = null;
      let capturedCursor: string | null = null;

      const mockReport: ReconciliationReportListResponse['items'][number] = {
        id: REPORT_ID,
        reportDate: '2026-11-24',
        runAt: '2026-11-24T10:00:00.000Z',
        status: 'MISMATCH',
        totals: {
          ledgerChargeTotalVnd: '9007199254740993',
          ledgerRefundTotalVnd: '598000',
          heldPaymentTotalVnd: '299000',
          heldPaymentCount: 1,
          voucherIssueEntries: 5,
          voucherRedeemEntries: 2,
          voucherVoidEntries: 1,
          vouchersByStatus: {
            RESERVED: 1,
            ACTIVE: 2,
            REDEEMED: 2,
            VOID: 1,
            EXPIRED: 0,
          },
        },
        mismatches: [
          {
            check: 'MONEY_BALANCE',
            ledger: '9007199254740993',
            state: '9007199254240993',
            difference: '-500000',
          },
        ],
      };

      server.use(
        http.get(`${TEST_API_URL}/admin/billing/reconciliation-reports`, ({ request }) => {
          const url = new URL(request.url);
          capturedStatus = url.searchParams.get('status');
          capturedCursor = url.searchParams.get('cursor');

          return HttpResponse.json<ReconciliationReportListResponse>({
            items: [mockReport],
            nextCursor: capturedCursor ? null : 'next-page-cursor-123',
          });
        }),
      );

      await renderApp('/operations/reconciliation', { token: 'valid-token' });

      // "Tất cả" mặc định không gửi param status
      await waitFor(() => {
        expect(capturedStatus).toBeNull();
      });

      // Ngày báo cáo YYYY-MM-DD cắt chuỗi thành DD/MM/YYYY không qua Date
      expect(await screen.findByText('24/11/2026')).toBeTruthy();

      // Số tiền lớn 9007199254740993 không bị mất độ chính xác thành 9007199254740992
      expect(screen.getAllByText(/9\.007\.199\.254\.740\.993/).length).toBeGreaterThan(0);
      expect(screen.queryByText(/9\.007\.199\.254\.740\.992/)).toBeNull();

      // Chênh lệch âm hiển thị đúng
      expect(screen.getByText(/-500\.000/)).toBeTruthy();

      // Bấm lọc "Lệch" → gửi status=MISMATCH
      const mismatchFilterBtn = screen.getByRole('button', { name: RECONCILIATION_COPY.filterMismatch });
      fireEvent.click(mismatchFilterBtn);

      await waitFor(() => {
        expect(capturedStatus).toBe('MISMATCH');
      });

      // Phân trang cursor
      const loadMoreBtn = await screen.findByRole('button', { name: RECONCILIATION_COPY.loadMore });
      fireEvent.click(loadMoreBtn);

      await waitFor(() => {
        expect(capturedCursor).toBe('next-page-cursor-123');
      });
    });
  });
});
