// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach, afterAll, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { messageFor } from '@tamgiao/api-client';
import { TEST_API_URL, problem } from '@tamgiao/api-client/mocks';
import { SAFETY_RESPONSE_SLA_MINUTES } from '@tamgiao/contracts/constants';
import {
  REPORT_STATUS_NAMES,
  type FlaggedMessageDetailResponse,
  type FlaggedMessageQueueResponse,
  type ReportDetailResponse,
  type ReportQueueResponse,
} from '@tamgiao/contracts/safety';
import { server, meHandler } from '../../test-utils/msw-server';
import { adminMe } from '../../test-utils/fixtures';
import { renderApp } from '../../test-utils/render-app';
import { FORBIDDEN_COPY } from '../../layout/copy';
import { MODERATION_COPY } from '../../features/moderation/copy';

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

const REPORT_ID_1 = '01890a5d-ac96-774b-bcce-b302099a8001';
const REPORT_ID_2 = '01890a5d-ac96-774b-bcce-b302099a8002';
const REPORTER_ID = '01890a5d-ac96-774b-bcce-b302099a8003';
const REPORTED_USER_ID = '01890a5d-ac96-774b-bcce-b302099a8004';
const MATCH_ID = '01890a5d-ac96-774b-bcce-b302099a8005';
const MESSAGE_ID_1 = '01890a5d-ac96-774b-bcce-b302099a8006';
const CONVERSATION_ID = '01890a5d-ac96-774b-bcce-b302099a8007';
const RECIPIENT_ID = '01890a5d-ac96-774b-bcce-b302099a8008';

function makeReportItem(
  overrides?: Partial<ReportQueueResponse['items'][number]>,
): ReportQueueResponse['items'][number] {
  return {
    reportId: REPORT_ID_1,
    reporterId: REPORTER_ID,
    reportedUserId: REPORTED_USER_ID,
    matchId: MATCH_ID,
    category: 'FINANCIAL_SCAM',
    severity: 'HIGH',
    status: 'OPEN',
    urgent: false,
    dueAt: null,
    overdue: false,
    handledBy: null,
    createdAt: '2026-11-24T10:00:00.000Z',
    ...overrides,
  };
}

function makeReportDetail(overrides?: Partial<ReportDetailResponse>): ReportDetailResponse {
  return {
    reportId: REPORT_ID_1,
    reporterId: REPORTER_ID,
    reportedUserId: REPORTED_USER_ID,
    matchId: MATCH_ID,
    category: 'FINANCIAL_SCAM',
    severity: 'HIGH',
    status: 'OPEN',
    urgent: false,
    dueAt: null,
    overdue: false,
    handledBy: null,
    createdAt: '2026-11-24T10:00:00.000Z',
    updatedAt: '2026-11-24T10:00:00.000Z',
    description: 'Người này yêu cầu chuyển tiền vào số tài khoản lạ.',
    evidence: [],
    conclusion: null,
    closedAt: null,
    version: 1,
    ...overrides,
  };
}

function makeFlaggedItem(
  overrides?: Partial<FlaggedMessageQueueResponse['items'][number]>,
): FlaggedMessageQueueResponse['items'][number] {
  return {
    messageId: MESSAGE_ID_1,
    conversationId: CONVERSATION_ID,
    matchId: MATCH_ID,
    senderId: REPORTED_USER_ID,
    recipientId: RECIPIENT_ID,
    reasons: ['MONEY_TRANSFER', 'BANK_ACCOUNT'],
    sentAt: '2026-11-24T10:00:00.000Z',
    ...overrides,
  };
}

function makeFlaggedDetail(overrides?: Partial<FlaggedMessageDetailResponse>): FlaggedMessageDetailResponse {
  return {
    messageId: MESSAGE_ID_1,
    conversationId: CONVERSATION_ID,
    matchId: MATCH_ID,
    senderId: REPORTED_USER_ID,
    recipientId: RECIPIENT_ID,
    reasons: ['MONEY_TRANSFER', 'BANK_ACCOUNT'],
    sentAt: '2026-11-24T10:00:00.000Z',
    body: 'Vui lòng chuyển 500k vào số tài khoản 123456789',
    maskedBody: 'Vui lòng chuyển 500k vào số tài khoản [ĐÃ CHE]',
    ...overrides,
  };
}

describe('ModerationPage', () => {
  it('a. MATCHMAKER không thấy menu, vào /moderation → FORBIDDEN_COPY.title', async () => {
    server.use(meHandler(adminMe('MATCHMAKER')));

    await renderApp('/moderation', { token: 'valid-token' });

    expect(await screen.findByText(FORBIDDEN_COPY.title)).toBeTruthy();
  });

  it('b. hàng chờ: báo cáo urgent lên đầu dù BE trả sau; request status=OPEN,IN_REVIEW', async () => {
    let capturedUrl: URL | null = null;
    server.use(
      http.get(`${TEST_API_URL}/admin/reports`, ({ request }) => {
        capturedUrl = new URL(request.url);
        return HttpResponse.json<ReportQueueResponse>({
          items: [
            makeReportItem({ reportId: REPORT_ID_1, urgent: false, category: 'HARASSMENT' }),
            makeReportItem({ reportId: REPORT_ID_2, urgent: true, category: 'FINANCIAL_SCAM' }),
          ],
          total: 2,
        });
      }),
    );

    await renderApp('/moderation', { token: 'valid-token' });

    expect(await screen.findByText(MODERATION_COPY.categories.FINANCIAL_SCAM)).toBeTruthy();
    expect(screen.getByText(MODERATION_COPY.categories.HARASSMENT)).toBeTruthy();

    // Kiểm tra query param
    expect(capturedUrl).not.toBeNull();
    expect(capturedUrl!.searchParams.get('status')).toBe('OPEN,IN_REVIEW');

    // Kiểm tra thứ tự sắp xếp: urgent lên trước
    const hrefs = screen
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'))
      .filter((href) => href?.startsWith('/moderation/reports/'));
    expect(hrefs).toEqual([`/moderation/reports/${REPORT_ID_2}`, `/moderation/reports/${REPORT_ID_1}`]);
  });

  it('b2. lọc "Tất cả trạng thái" gửi đủ mọi trạng thái (BE mặc định chỉ OPEN,IN_REVIEW)', async () => {
    const statuses: (string | null)[] = [];
    server.use(
      http.get(`${TEST_API_URL}/admin/reports`, ({ request }) => {
        statuses.push(new URL(request.url).searchParams.get('status'));
        return HttpResponse.json<ReportQueueResponse>({ items: [], total: 0 });
      }),
    );
    await renderApp('/moderation', { token: 'valid-token' });
    fireEvent.change(await screen.findByLabelText(MODERATION_COPY.queue.filterLabel), {
      target: { value: 'all' },
    });
    await waitFor(() => expect(statuses).toContain(REPORT_STATUS_NAMES.join(',')));
  });

  it('c. AC1: báo cáo urgent với dueAt quá khứ (overdue true) → sla-overdue có text slaOverdue(SAFETY_RESPONSE_SLA_MINUTES); báo cáo urgent dueAt tương lai → không có sla-overdue; RESOLVED quá hạn → không', async () => {
    const futureDue = new Date(Date.now() + 600_000).toISOString();
    const pastDue = new Date(Date.now() - 600_000).toISOString();

    server.use(
      http.get(`${TEST_API_URL}/admin/reports`, () => {
        return HttpResponse.json<ReportQueueResponse>({
          items: [
            makeReportItem({
              reportId: REPORT_ID_1,
              urgent: true,
              dueAt: pastDue,
              overdue: true,
              status: 'OPEN',
              category: 'FINANCIAL_SCAM',
            }),
            makeReportItem({
              reportId: REPORT_ID_2,
              urgent: true,
              dueAt: futureDue,
              overdue: false,
              status: 'OPEN',
              category: 'HARASSMENT',
            }),
            makeReportItem({
              reportId: '01890a5d-ac96-774b-bcce-b302099a8009',
              urgent: true,
              dueAt: pastDue,
              overdue: true,
              status: 'RESOLVED',
              category: 'MARITAL_FRAUD',
            }),
          ],
          total: 3,
        });
      }),
    );

    await renderApp('/moderation', { token: 'valid-token' });

    // AC1: sla-overdue có text slaOverdue(SAFETY_RESPONSE_SLA_MINUTES)
    const alertBadges = await screen.findAllByTestId('sla-overdue');
    expect(alertBadges.length).toBe(1);
    expect(alertBadges[0]!.textContent).toBe(MODERATION_COPY.slaOverdue(SAFETY_RESPONSE_SLA_MINUTES));
  });

  it('d. phân trang offset: total 2, trang 1 1 phần tử → "Tải thêm" → request offset=1', async () => {
    const requestedOffsets: string[] = [];
    server.use(
      http.get(`${TEST_API_URL}/admin/reports`, ({ request }) => {
        const url = new URL(request.url);
        requestedOffsets.push(url.searchParams.get('offset') ?? '0');
        const offset = Number(url.searchParams.get('offset') ?? '0');
        if (offset === 0) {
          return HttpResponse.json<ReportQueueResponse>({
            items: [makeReportItem({ reportId: REPORT_ID_1, category: 'FINANCIAL_SCAM' })],
            total: 2,
          });
        }
        return HttpResponse.json<ReportQueueResponse>({
          items: [makeReportItem({ reportId: REPORT_ID_2, category: 'HARASSMENT' })],
          total: 2,
        });
      }),
    );

    await renderApp('/moderation', { token: 'valid-token' });

    expect(await screen.findByText(MODERATION_COPY.categories.FINANCIAL_SCAM)).toBeTruthy();
    const loadMoreButton = screen.getByRole('button', { name: MODERATION_COPY.queue.loadMore });
    fireEvent.click(loadMoreButton);

    expect(await screen.findByText(MODERATION_COPY.categories.HARASSMENT)).toBeTruthy();
    expect(requestedOffsets).toContain('1');
  });

  it('e. mở chi tiết, start-review → POST, rồi trạng thái IN_REVIEW → resolve RESOLVED: kết luận rỗng → lỗi, không gửi; có kết luận → body {outcome: RESOLVED, conclusion}', async () => {
    let startReviewCalled = false;
    let resolveBody: unknown = null;

    server.use(
      http.get(`${TEST_API_URL}/admin/reports`, () => {
        return HttpResponse.json<ReportQueueResponse>({
          items: [
            makeReportItem({ reportId: REPORT_ID_1, status: startReviewCalled ? 'IN_REVIEW' : 'OPEN' }),
          ],
          total: 1,
        });
      }),
      http.get(`${TEST_API_URL}/admin/reports/${REPORT_ID_1}`, () => {
        return HttpResponse.json<ReportDetailResponse>(
          makeReportDetail({
            reportId: REPORT_ID_1,
            status: startReviewCalled ? 'IN_REVIEW' : 'OPEN',
          }),
        );
      }),
      http.post(`${TEST_API_URL}/admin/reports/${REPORT_ID_1}/start-review`, () => {
        startReviewCalled = true;
        return HttpResponse.json({
          reportId: REPORT_ID_1,
          status: 'IN_REVIEW',
          handledBy: '01890a5d-ac96-774b-bcce-b302099a8088',
          closedAt: null,
          updatedAt: '2026-11-24T10:05:00.000Z',
        });
      }),
      http.post(`${TEST_API_URL}/admin/reports/${REPORT_ID_1}/resolve`, async ({ request }) => {
        resolveBody = await request.json();
        return HttpResponse.json({
          reportId: REPORT_ID_1,
          status: 'RESOLVED',
          handledBy: '01890a5d-ac96-774b-bcce-b302099a8088',
          closedAt: '2026-11-24T10:10:00.000Z',
          updatedAt: '2026-11-24T10:10:00.000Z',
        });
      }),
    );

    await renderApp(`/moderation/reports/${REPORT_ID_1}`, { token: 'valid-token' });

    // Bấm "Nhận xử lý"
    const startReviewBtn = await screen.findByRole('button', {
      name: MODERATION_COPY.detail.actions.startReview,
    });
    fireEvent.click(startReviewBtn);

    await waitFor(() => {
      expect(startReviewCalled).toBe(true);
    });

    // Sau khi IN_REVIEW, nút "Xác nhận vi phạm" xuất hiện
    const resolveBtn = await screen.findByRole('button', { name: MODERATION_COPY.detail.actions.resolve });
    fireEvent.click(resolveBtn);

    // Mở dialog xác nhận vi phạm
    const submitBtn = within(screen.getByRole('dialog')).getByRole('button', {
      name: MODERATION_COPY.resolveDialog.submitResolve,
    });
    // Bấm khi chưa nhập kết luận → hiện lỗi
    fireEvent.click(submitBtn);
    expect(await screen.findByText(MODERATION_COPY.resolveDialog.conclusionRequired)).toBeTruthy();
    expect(resolveBody).toBeNull();

    // Nhập kết luận hợp lệ
    const textarea = screen.getByPlaceholderText(MODERATION_COPY.resolveDialog.conclusionPlaceholder);
    fireEvent.change(textarea, { target: { value: 'Xác nhận người dùng có hành vi lừa đảo chuyển tiền.' } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(resolveBody).toEqual({
        outcome: 'RESOLVED',
        conclusion: 'Xác nhận người dùng có hành vi lừa đảo chuyển tiền.',
      });
    });
  });

  it('f. resolve lỗi 409 REPORT_INVALID_TRANSITION → role alert messageFor title và GET chi tiết gọi lại', async () => {
    let detailFetchCount = 0;
    server.use(
      http.get(`${TEST_API_URL}/admin/reports`, () => {
        return HttpResponse.json<ReportQueueResponse>({
          items: [makeReportItem({ reportId: REPORT_ID_1, status: 'IN_REVIEW' })],
          total: 1,
        });
      }),
      http.get(`${TEST_API_URL}/admin/reports/${REPORT_ID_1}`, () => {
        detailFetchCount++;
        return HttpResponse.json<ReportDetailResponse>(
          makeReportDetail({ reportId: REPORT_ID_1, status: 'IN_REVIEW' }),
        );
      }),
      http.post(`${TEST_API_URL}/admin/reports/${REPORT_ID_1}/resolve`, () => {
        return problem(409, 'REPORT_INVALID_TRANSITION');
      }),
    );

    await renderApp(`/moderation/reports/${REPORT_ID_1}`, { token: 'valid-token' });

    const resolveBtn = await screen.findByRole('button', { name: MODERATION_COPY.detail.actions.resolve });
    fireEvent.click(resolveBtn);

    const textarea = screen.getByPlaceholderText(MODERATION_COPY.resolveDialog.conclusionPlaceholder);
    fireEvent.change(textarea, { target: { value: 'Đủ căn cứ xác nhận.' } });

    const initialFetchCount = detailFetchCount;
    const submitBtn = within(screen.getByRole('dialog')).getByRole('button', {
      name: MODERATION_COPY.resolveDialog.submitResolve,
    });
    fireEvent.click(submitBtn);

    // Lỗi 409 REPORT_INVALID_TRANSITION hiển thị trong role="alert"
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(messageFor({ code: 'REPORT_INVALID_TRANSITION' }).title);

    // Chi tiết được gọi lại do onSettled invalidate
    await waitFor(() => {
      expect(detailFetchCount).toBeGreaterThan(initialFetchCount);
    });
    // Mỗi lần gọi chi tiết BE ghi audit → chỉ gọi lại đúng một lần; dialog giữ kết luận đã nhập.
    expect(detailFetchCount).toBe(initialFetchCount + 1);
    expect(screen.getByDisplayValue('Đủ căn cứ xác nhận.')).toBeTruthy();
  });

  it('g. ban 2 bước: nút khoá vĩnh viễn disabled tới khi tick; body {reason, reportId}; USER_ALREADY_BANNED → alert', async () => {
    let banBody: unknown = null;
    let banUserId: string | null = null;
    let returnAlreadyBanned = false;

    server.use(
      http.get(`${TEST_API_URL}/admin/reports`, () => {
        return HttpResponse.json<ReportQueueResponse>({
          items: [makeReportItem({ reportId: REPORT_ID_1 })],
          total: 1,
        });
      }),
      http.get(`${TEST_API_URL}/admin/reports/${REPORT_ID_1}`, () => {
        return HttpResponse.json<ReportDetailResponse>(makeReportDetail({ reportId: REPORT_ID_1 }));
      }),
      http.post(`${TEST_API_URL}/admin/users/:id/ban`, async ({ request, params }) => {
        banUserId = params.id as string;
        banBody = await request.json();
        if (returnAlreadyBanned) {
          return problem(409, 'USER_ALREADY_BANNED');
        }
        return HttpResponse.json(
          {
            banId: '01890a5d-ac96-774b-bcce-b302099a8099',
            userId: banUserId,
            reportId: REPORT_ID_1,
            bannedBy: '01890a5d-ac96-774b-bcce-b302099a8088',
            bannedAt: '2026-11-24T10:15:00.000Z',
          },
          { status: 201 },
        );
      }),
    );

    await renderApp(`/moderation/reports/${REPORT_ID_1}`, { token: 'valid-token' });

    const banUserBtn = await screen.findByRole('button', { name: MODERATION_COPY.detail.actions.banUser });
    fireEvent.click(banUserBtn);

    // Bước 1: nhập lý do
    const reasonInput = screen.getByPlaceholderText(MODERATION_COPY.banDialog.reasonPlaceholder);
    fireEvent.change(reasonInput, { target: { value: 'Vi phạm nghiêm trọng chính sách tài chính.' } });
    const nextBtn = screen.getByRole('button', { name: MODERATION_COPY.banDialog.next });
    fireEvent.click(nextBtn);

    // Bước 2: nút khoá vĩnh viễn disabled tới khi tick
    const submitBanBtn = screen.getByRole('button', { name: MODERATION_COPY.banDialog.submit });
    expect(submitBanBtn.hasAttribute('disabled')).toBe(true);

    const checkbox = screen.getByLabelText(MODERATION_COPY.banDialog.confirmCheckbox);
    fireEvent.click(checkbox);
    expect(submitBanBtn.hasAttribute('disabled')).toBe(false);

    // Bấm khoá thành công
    fireEvent.click(submitBanBtn);

    await waitFor(() => {
      expect(banUserId).toBe(REPORTED_USER_ID);
      expect(banBody).toEqual({
        reason: 'Vi phạm nghiêm trọng chính sách tài chính.',
        reportId: REPORT_ID_1,
      });
    });

    expect(await screen.findByText(MODERATION_COPY.detail.toasts.banSuccess)).toBeTruthy();

    // Thử lại với USER_ALREADY_BANNED → role="alert"
    returnAlreadyBanned = true;
    fireEvent.click(banUserBtn);
    const reasonInput2 = screen.getByPlaceholderText(MODERATION_COPY.banDialog.reasonPlaceholder);
    fireEvent.change(reasonInput2, { target: { value: 'Lý do lần hai.' } });
    fireEvent.click(screen.getByRole('button', { name: MODERATION_COPY.banDialog.next }));
    fireEvent.click(screen.getByLabelText(MODERATION_COPY.banDialog.confirmCheckbox));
    fireEvent.click(screen.getByRole('button', { name: MODERATION_COPY.banDialog.submit }));

    expect(await screen.findByText(messageFor({ code: 'USER_ALREADY_BANNED' }).title)).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('h. tin gắn cờ: danh sách không gọi API chi tiết; bấm vào → gọi chi tiết đúng 1 lần, hiện body; khoá người gửi gửi body không có reportId và đúng userId = senderId', async () => {
    let detailCallCount = 0;
    let banBody: unknown = null;
    let banUserId: string | null = null;

    server.use(
      http.get(`${TEST_API_URL}/admin/flagged-messages`, () => {
        return HttpResponse.json<FlaggedMessageQueueResponse>({
          items: [makeFlaggedItem({ messageId: MESSAGE_ID_1 })],
          nextCursor: null,
        });
      }),
      http.get(`${TEST_API_URL}/admin/flagged-messages/${MESSAGE_ID_1}`, () => {
        detailCallCount++;
        return HttpResponse.json<FlaggedMessageDetailResponse>(
          makeFlaggedDetail({ messageId: MESSAGE_ID_1 }),
        );
      }),
      http.post(`${TEST_API_URL}/admin/users/:id/ban`, async ({ request, params }) => {
        banUserId = params.id as string;
        banBody = await request.json();
        return HttpResponse.json(
          {
            banId: '01890a5d-ac96-774b-bcce-b302099a8099',
            userId: banUserId,
            reportId: null,
            bannedBy: '01890a5d-ac96-774b-bcce-b302099a8088',
            bannedAt: '2026-11-24T10:15:00.000Z',
          },
          { status: 201 },
        );
      }),
    );

    // Vào tab flagged
    await renderApp('/moderation/flagged', { token: 'valid-token' });

    // Danh sách không gọi API chi tiết
    expect(await screen.findByText(MODERATION_COPY.flagReasons.MONEY_TRANSFER)).toBeTruthy();
    expect(detailCallCount).toBe(0);

    // Bấm vào tin nhắn
    const itemLink = screen.getByRole('link', {
      name: new RegExp(MODERATION_COPY.flagReasons.MONEY_TRANSFER),
    });
    fireEvent.click(itemLink);

    // Hiện nội dung body và gọi API chi tiết đúng 1 lần
    expect(await screen.findByText('Vui lòng chuyển 500k vào số tài khoản 123456789')).toBeTruthy();
    expect(detailCallCount).toBe(1);

    // Nút khoá người gửi → BanDialog không reportId
    const banSenderBtn = screen.getByRole('button', { name: MODERATION_COPY.flagged.banSender });
    fireEvent.click(banSenderBtn);

    const reasonInput = screen.getByPlaceholderText(MODERATION_COPY.banDialog.reasonPlaceholder);
    fireEvent.change(reasonInput, { target: { value: 'Spam tin nhắn tài chính.' } });
    fireEvent.click(screen.getByRole('button', { name: MODERATION_COPY.banDialog.next }));
    fireEvent.click(screen.getByLabelText(MODERATION_COPY.banDialog.confirmCheckbox));
    fireEvent.click(screen.getByRole('button', { name: MODERATION_COPY.banDialog.submit }));

    await waitFor(() => {
      expect(banUserId).toBe(REPORTED_USER_ID);
      expect(banBody).toEqual({
        reason: 'Spam tin nhắn tài chính.',
      });
    });
    // Khoá xong không gọi lại chi tiết tin (tránh audit thừa).
    expect(await screen.findByText(MODERATION_COPY.detail.toasts.banSuccess)).toBeTruthy();
    expect(detailCallCount).toBe(1);
  });

  it('i. evidence: img có src presigned và referrerpolicy="no-referrer"', async () => {
    const evidenceUrl = 'https://s3.example.com/evidence1.jpg?token=abc';
    server.use(
      http.get(`${TEST_API_URL}/admin/reports`, () => {
        return HttpResponse.json<ReportQueueResponse>({
          items: [makeReportItem({ reportId: REPORT_ID_1 })],
          total: 1,
        });
      }),
      http.get(`${TEST_API_URL}/admin/reports/${REPORT_ID_1}`, () => {
        return HttpResponse.json<ReportDetailResponse>(
          makeReportDetail({
            reportId: REPORT_ID_1,
            evidence: [
              {
                key: 'evidence/01.jpg',
                url: evidenceUrl,
                expiresAt: new Date(Date.now() + 600_000).toISOString(),
              },
            ],
          }),
        );
      }),
    );

    await renderApp(`/moderation/reports/${REPORT_ID_1}`, { token: 'valid-token' });

    const img = (await screen.findByRole('img', { name: 'Bằng chứng 1' })) as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.src).toBe(evidenceUrl);
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');
  });
});
