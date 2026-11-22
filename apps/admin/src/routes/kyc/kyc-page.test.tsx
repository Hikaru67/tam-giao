// @vitest-environment jsdom
import { problem, TEST_API_URL } from '@tamgiao/api-client/mocks';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { KYC_COPY } from '../../features/kyc/copy';
import { KYC_QUERY_KEYS, KYC_QUEUE_PAGE_SIZE } from '../../features/kyc/kyc-api';
import {
  allStepsPassed,
  decisionFrom,
  emptyKycQueueHandler,
  kycDetail,
  kycQueueHandler,
  kycQueueItem,
  OTHER_ADMIN_ID,
  SUBMISSION_ID_1,
  SUBMISSION_ID_2,
  SUBMISSION_ID_3,
} from '../../features/kyc/kyc-test-fixtures';
import { ADMIN_ID, adminMe } from '../../test-utils/fixtures';
import { meHandler, server } from '../../test-utils/msw-server';
import { renderApp } from '../../test-utils/render-app';

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});

describe('KycPage', () => {
  it('hàng chờ: tải trang đầu với bộ lọc mặc định, phân trang cursor bằng nút tải thêm', async () => {
    const capturedUrls: URL[] = [];
    const page1 = {
      items: [
        kycQueueItem({ id: SUBMISSION_ID_1, fullName: 'Lan 1' }),
        kycQueueItem({ id: SUBMISSION_ID_2, fullName: 'Lan 2' }),
      ],
      nextCursor: 'c2',
    };
    const page2 = {
      items: [kycQueueItem({ id: SUBMISSION_ID_3, fullName: 'Lan 3' })],
      nextCursor: null,
    };

    server.use(
      meHandler(adminMe('REVIEWER')),
      kycQueueHandler({ first: page1, c2: page2 }, (url) => capturedUrls.push(url)),
    );

    await renderApp('/kyc', { token: 'valid-token' });

    await screen.findByText('Lan 1');
    expect(screen.getByText('Lan 2')).toBeTruthy();

    const firstUrl = capturedUrls[0];
    expect(firstUrl).toBeDefined();
    expect(firstUrl?.searchParams.get('status')).toBe('SUBMITTED,UNDER_REVIEW');
    expect(firstUrl?.searchParams.get('limit')).toBe(String(KYC_QUEUE_PAGE_SIZE));
    expect(firstUrl?.searchParams.get('cursor')).toBeNull();

    const loadMoreBtn = screen.getByRole('button', { name: KYC_COPY.queue.loadMore });
    fireEvent.click(loadMoreBtn);

    await screen.findByText('Lan 3');
    expect(screen.getByText('Lan 1')).toBeTruthy();

    const secondUrl = capturedUrls[1];
    expect(secondUrl).toBeDefined();
    expect(secondUrl?.searchParams.get('cursor')).toBe('c2');

    expect(screen.queryByRole('button', { name: KYC_COPY.queue.loadMore })).toBeNull();
  });

  it('lọc theo trạng thái, cảnh báo eKYC và từ khoá; hiện số cảnh báo', async () => {
    const capturedUrls: URL[] = [];
    const flaggedItem = kycQueueItem({
      id: SUBMISSION_ID_1,
      fullName: 'Lan có cờ',
      flags: ['OCR_REJECTED', 'LIVENESS_REJECTED'],
    });

    server.use(
      meHandler(adminMe('REVIEWER')),
      kycQueueHandler({ first: { items: [flaggedItem], nextCursor: null } }, (url) => capturedUrls.push(url)),
    );

    await renderApp('/kyc', { token: 'valid-token' });

    await screen.findByText('Lan có cờ');
    expect(screen.getByText(KYC_COPY.queue.flagCount(2))).toBeTruthy();

    const statusSelect = screen.getByLabelText(KYC_COPY.queue.statusFilterLabel);
    fireEvent.change(statusSelect, { target: { value: 'moreInfo' } });

    await waitFor(() => {
      expect(capturedUrls.some((u) => u.searchParams.get('status') === 'NEEDS_MORE_INFO')).toBe(true);
    });

    const flaggedCheckbox = screen.getByLabelText(KYC_COPY.queue.flaggedOnly);
    fireEvent.click(flaggedCheckbox);

    await waitFor(() => {
      expect(capturedUrls.some((u) => u.searchParams.get('flagged') === 'true')).toBe(true);
    });

    const searchInput = screen.getByLabelText(KYC_COPY.queue.searchLabel);
    fireEvent.change(searchInput, { target: { value: 'Lan' } });
    fireEvent.click(screen.getByRole('button', { name: KYC_COPY.queue.searchSubmit }));

    await waitFor(() => {
      expect(capturedUrls.some((u) => u.searchParams.get('q') === 'Lan')).toBe(true);
    });
  });

  it('chọn hồ sơ → chi tiết với ảnh presigned (no-referrer, không kéo-thả), ảnh đã xoá', async () => {
    const detail = kycDetail({
      id: SUBMISSION_ID_1,
      cccdNumber: '079095001234',
      documents: {
        cccdFront: {
          url: 'https://storage.test/kyc/cccdFront?sig=v1',
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
        },
        cccdBack: {
          url: 'https://storage.test/kyc/cccdBack?sig=v1',
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
        },
        selfie: {
          url: 'https://storage.test/kyc/selfie?sig=v1',
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
        },
        maritalStatusCertificate: null,
      },
    });

    server.use(
      meHandler(adminMe('REVIEWER')),
      kycQueueHandler({
        first: {
          items: [kycQueueItem({ id: SUBMISSION_ID_1, fullName: 'Nguyễn Thị Lan' })],
          nextCursor: null,
        },
      }),
      http.get(`${TEST_API_URL}/admin/kyc/submissions/${SUBMISSION_ID_1}`, () => {
        return HttpResponse.json(detail);
      }),
    );

    const { history } = await renderApp('/kyc', { token: 'valid-token' });

    const itemLink = await screen.findByRole('link', { name: /Nguyễn Thị Lan/ });
    fireEvent.click(itemLink);

    await waitFor(() => expect(history.location.pathname).toBe(`/kyc/${SUBMISSION_ID_1}`));
    await screen.findByRole('heading', { name: 'Nguyễn Thị Lan', level: 2 });
    expect(screen.getByText('079095001234')).toBeTruthy();

    const cccdFrontImg = screen.getByRole('img', { name: KYC_COPY.detail.documents.cccdFront });
    expect(cccdFrontImg.getAttribute('src')).toBe('https://storage.test/kyc/cccdFront?sig=v1');
    expect(cccdFrontImg.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(cccdFrontImg.getAttribute('draggable')).toBe('false');

    const cccdBackImg = screen.getByRole('img', { name: KYC_COPY.detail.documents.cccdBack });
    expect(cccdBackImg.getAttribute('src')).toBe('https://storage.test/kyc/cccdBack?sig=v1');
    expect(cccdBackImg.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(cccdBackImg.getAttribute('draggable')).toBe('false');

    const selfieImg = screen.getByRole('img', { name: KYC_COPY.detail.documents.selfie });
    expect(selfieImg.getAttribute('src')).toBe('https://storage.test/kyc/selfie?sig=v1');
    expect(selfieImg.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(selfieImg.getAttribute('draggable')).toBe('false');

    expect(screen.getByText(KYC_COPY.detail.documentRemoved)).toBeTruthy();
  });

  it('AC1: URL hết hạn → gỡ ảnh cũ, xin lại chi tiết và hiện URL mới', async () => {
    let detailCalls = 0;
    server.use(
      meHandler(adminMe('REVIEWER')),
      emptyKycQueueHandler(),
      http.get(`${TEST_API_URL}/admin/kyc/submissions/${SUBMISSION_ID_1}`, () => {
        detailCalls++;
        if (detailCalls === 1) {
          const expiresAt = new Date(Date.now() + 500).toISOString();
          return HttpResponse.json(
            kycDetail({
              documents: {
                cccdFront: { url: 'https://storage.test/kyc/cccdFront?sig=v1', expiresAt },
                cccdBack: { url: 'https://storage.test/kyc/cccdBack?sig=v1', expiresAt },
                selfie: { url: 'https://storage.test/kyc/selfie?sig=v1', expiresAt },
                maritalStatusCertificate: {
                  url: 'https://storage.test/kyc/maritalStatusCertificate?sig=v1',
                  expiresAt,
                },
              },
            }),
          );
        }
        const expiresAt = new Date(Date.now() + 300_000).toISOString();
        return HttpResponse.json(
          kycDetail({
            documents: {
              cccdFront: { url: 'https://storage.test/kyc/cccdFront?sig=v2', expiresAt },
              cccdBack: { url: 'https://storage.test/kyc/cccdBack?sig=v2', expiresAt },
              selfie: { url: 'https://storage.test/kyc/selfie?sig=v2', expiresAt },
              maritalStatusCertificate: {
                url: 'https://storage.test/kyc/maritalStatusCertificate?sig=v2',
                expiresAt,
              },
            },
          }),
        );
      }),
    );

    await renderApp(`/kyc/${SUBMISSION_ID_1}`, { token: 'valid-token' });
    await screen.findByRole('img', { name: KYC_COPY.detail.documents.cccdFront });

    await waitFor(
      () => {
        const images = screen.queryAllByRole('img');
        expect(images.every((img) => !img.getAttribute('src')?.includes('sig=v1'))).toBe(true);
        expect(screen.getAllByText(KYC_COPY.detail.documentExpired).length).toBeGreaterThan(0);
      },
      { timeout: 2000 },
    );

    const newImg = await screen.findByRole(
      'img',
      { name: KYC_COPY.detail.documents.cccdFront },
      { timeout: 4000 },
    );
    expect(newImg.getAttribute('src')).toContain('sig=v2');
    expect(detailCalls).toBe(2);
  });

  it('AC1: xin lại thất bại → ảnh hết hạn không còn hiển thị', async () => {
    let detailCalls = 0;
    server.use(
      meHandler(adminMe('REVIEWER')),
      emptyKycQueueHandler(),
      http.get(`${TEST_API_URL}/admin/kyc/submissions/${SUBMISSION_ID_1}`, () => {
        detailCalls++;
        if (detailCalls === 1) {
          const expiresAt = new Date(Date.now() + 500).toISOString();
          return HttpResponse.json(
            kycDetail({
              documents: {
                cccdFront: { url: 'https://storage.test/kyc/cccdFront?sig=v1', expiresAt },
                cccdBack: { url: 'https://storage.test/kyc/cccdBack?sig=v1', expiresAt },
                selfie: { url: 'https://storage.test/kyc/selfie?sig=v1', expiresAt },
                maritalStatusCertificate: {
                  url: 'https://storage.test/kyc/maritalStatusCertificate?sig=v1',
                  expiresAt,
                },
              },
            }),
          );
        }
        return problem(500, 'INTERNAL');
      }),
    );

    await renderApp(`/kyc/${SUBMISSION_ID_1}`, { token: 'valid-token' });
    await screen.findByRole('img', { name: KYC_COPY.detail.documents.cccdFront });

    await waitFor(
      () => {
        expect(detailCalls).toBeGreaterThanOrEqual(2);
        const images = screen.queryAllByRole('img');
        expect(images.every((img) => !img.getAttribute('src')?.includes('sig=v1'))).toBe(true);
        expect(screen.getAllByText(KYC_COPY.detail.documentExpired).length).toBeGreaterThan(0);
      },
      { timeout: 4000 },
    );
  });

  it('rời chi tiết → không giữ dữ liệu chi tiết trong cache', async () => {
    const detail = kycDetail({ id: SUBMISSION_ID_1 });
    server.use(
      meHandler(adminMe('REVIEWER')),
      emptyKycQueueHandler(),
      http.get(`${TEST_API_URL}/admin/kyc/submissions/${SUBMISSION_ID_1}`, () => {
        return HttpResponse.json(detail);
      }),
    );

    const { history, queryClient } = await renderApp(`/kyc/${SUBMISSION_ID_1}`, {
      token: 'valid-token',
    });
    await screen.findByRole('heading', { name: 'Nguyễn Thị Lan', level: 2 });

    history.push('/kyc');
    await waitFor(() => {
      expect(
        queryClient.getQueryCache().find({ queryKey: KYC_QUERY_KEYS.detail(SUBMISSION_ID_1) }),
      ).toBeUndefined();
    });
  });

  it('nhận hồ sơ', async () => {
    const detail = kycDetail({ id: SUBMISSION_ID_1, reviewerId: null });
    server.use(
      meHandler(adminMe('REVIEWER')),
      emptyKycQueueHandler(),
      http.get(`${TEST_API_URL}/admin/kyc/submissions/${SUBMISSION_ID_1}`, () => {
        return HttpResponse.json(detail);
      }),
      http.post(`${TEST_API_URL}/admin/kyc/submissions/${SUBMISSION_ID_1}/assign`, () => {
        return HttpResponse.json(decisionFrom(detail, { reviewerId: ADMIN_ID }));
      }),
    );

    await renderApp(`/kyc/${SUBMISSION_ID_1}`, { token: 'valid-token' });
    await screen.findByRole('heading', { name: 'Nguyễn Thị Lan', level: 2 });

    const assignBtn = screen.getByRole('button', { name: KYC_COPY.decisions.assign });
    fireEvent.click(assignBtn);

    await screen.findByText(KYC_COPY.decisions.success.assign);
    expect(screen.queryByRole('button', { name: KYC_COPY.decisions.assign })).toBeNull();
    expect(screen.getByText(KYC_COPY.detail.reviewerMe)).toBeTruthy();
  });

  it('xung đột assign → thông báo và tải lại chi tiết + hàng chờ', async () => {
    let detailCalls = 0;
    let queueCalls = 0;
    const detail1 = kycDetail({
      id: SUBMISSION_ID_1,
      reviewerId: OTHER_ADMIN_ID,
      status: 'UNDER_REVIEW',
    });

    server.use(
      meHandler(adminMe('REVIEWER')),
      http.get(`${TEST_API_URL}/admin/kyc/submissions`, () => {
        queueCalls++;
        return HttpResponse.json({ items: [], nextCursor: null });
      }),
      http.get(`${TEST_API_URL}/admin/kyc/submissions/${SUBMISSION_ID_1}`, () => {
        detailCalls++;
        if (detailCalls === 1) {
          return HttpResponse.json(detail1);
        }
        return HttpResponse.json(
          kycDetail({
            id: SUBMISSION_ID_1,
            reviewerId: OTHER_ADMIN_ID,
            status: 'APPROVED',
            decidedBy: OTHER_ADMIN_ID,
          }),
        );
      }),
      http.post(`${TEST_API_URL}/admin/kyc/submissions/${SUBMISSION_ID_1}/assign`, () => {
        return problem(409, 'KYC_ALREADY_DECIDED');
      }),
    );

    await renderApp(`/kyc/${SUBMISSION_ID_1}`, { token: 'valid-token' });
    await screen.findByText(KYC_COPY.detail.takenByOther);
    const reassignBtn = screen.getByRole('button', { name: KYC_COPY.decisions.reassign });

    const initialQueueCalls = queueCalls;
    fireEvent.click(reassignBtn);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(KYC_COPY.decisions.conflict);

    await waitFor(() => {
      expect(detailCalls).toBe(2);
      expect(queueCalls).toBeGreaterThan(initialQueueCalls);
      expect(screen.getByText(KYC_COPY.decisions.decided)).toBeTruthy();
      expect(screen.queryByRole('button', { name: KYC_COPY.decisions.reassign })).toBeNull();
    });
  });

  it('đánh dấu bước đạt', async () => {
    let capturedBody: unknown = null;
    const detail = kycDetail({ id: SUBMISSION_ID_1 });
    server.use(
      meHandler(adminMe('REVIEWER')),
      emptyKycQueueHandler(),
      http.get(`${TEST_API_URL}/admin/kyc/submissions/${SUBMISSION_ID_1}`, () => {
        return HttpResponse.json(detail);
      }),
      http.post(`${TEST_API_URL}/admin/kyc/submissions/${SUBMISSION_ID_1}/steps`, async ({ request }) => {
        capturedBody = await request.json();
        const updatedSteps = detail.steps.map((s) =>
          s.step === 'CCCD_CHIP'
            ? { ...s, status: 'PASSED' as const, decidedAt: '2026-11-20T02:05:00.000Z' }
            : s,
        );
        return HttpResponse.json(decisionFrom(detail, { steps: updatedSteps }));
      }),
    );

    await renderApp(`/kyc/${SUBMISSION_ID_1}`, { token: 'valid-token' });
    const passBtn = await screen.findByRole('button', {
      name: `${KYC_COPY.detail.stepPass}: ${KYC_COPY.steps.CCCD_CHIP}`,
    });
    fireEvent.click(passBtn);

    await screen.findByText(KYC_COPY.decisions.success.markStep);
    expect(capturedBody).toEqual({ step: 'CCCD_CHIP', outcome: 'PASSED' });
  });

  it('duyệt bị khoá khi chưa đủ 4 bước', async () => {
    const detail = kycDetail({ id: SUBMISSION_ID_1 });
    server.use(
      meHandler(adminMe('REVIEWER')),
      emptyKycQueueHandler(),
      http.get(`${TEST_API_URL}/admin/kyc/submissions/${SUBMISSION_ID_1}`, () => {
        return HttpResponse.json(detail);
      }),
    );

    await renderApp(`/kyc/${SUBMISSION_ID_1}`, { token: 'valid-token' });
    const approveBtn = await screen.findByRole('button', { name: KYC_COPY.decisions.approve });
    expect(approveBtn.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(KYC_COPY.decisions.approveHint)).toBeTruthy();
  });

  it('duyệt hồ sơ đủ 4 bước', async () => {
    let approveCalled = false;
    const detail = kycDetail({ id: SUBMISSION_ID_1, steps: allStepsPassed() });
    server.use(
      meHandler(adminMe('REVIEWER')),
      emptyKycQueueHandler(),
      http.get(`${TEST_API_URL}/admin/kyc/submissions/${SUBMISSION_ID_1}`, () => {
        return HttpResponse.json(detail);
      }),
      http.post(`${TEST_API_URL}/admin/kyc/submissions/${SUBMISSION_ID_1}/approve`, () => {
        approveCalled = true;
        return HttpResponse.json(
          decisionFrom(detail, { status: 'APPROVED', decidedAt: '2026-11-20T03:00:00.000Z' }),
        );
      }),
    );

    await renderApp(`/kyc/${SUBMISSION_ID_1}`, { token: 'valid-token' });
    const approveBtn = await screen.findByRole('button', { name: KYC_COPY.decisions.approve });
    expect(approveBtn.hasAttribute('disabled')).toBe(false);
    fireEvent.click(approveBtn);

    await screen.findByText(KYC_COPY.decisions.success.approve);
    expect(approveCalled).toBe(true);
    expect(screen.getByText(KYC_COPY.decisions.decided)).toBeTruthy();
  });

  it('AC2: từ chối bắt buộc chọn lý do (và ghi chú khi lý do khác)', async () => {
    let rejectCallCount = 0;
    let capturedRejectBody: unknown = null;
    const detail = kycDetail({ id: SUBMISSION_ID_1 });
    server.use(
      meHandler(adminMe('REVIEWER')),
      emptyKycQueueHandler(),
      http.get(`${TEST_API_URL}/admin/kyc/submissions/${SUBMISSION_ID_1}`, () => {
        return HttpResponse.json(detail);
      }),
      http.post(`${TEST_API_URL}/admin/kyc/submissions/${SUBMISSION_ID_1}/reject`, async ({ request }) => {
        rejectCallCount++;
        capturedRejectBody = await request.json();
        return HttpResponse.json(decisionFrom(detail, { status: 'REJECTED' }));
      }),
    );

    await renderApp(`/kyc/${SUBMISSION_ID_1}`, { token: 'valid-token' });
    const openRejectBtn = await screen.findByRole('button', { name: KYC_COPY.decisions.reject });
    fireEvent.click(openRejectBtn);

    await screen.findByRole('heading', { name: KYC_COPY.rejectDialog.title });
    const submitRejectBtn = screen.getByRole('button', { name: KYC_COPY.rejectDialog.submit });

    fireEvent.click(submitRejectBtn);
    expect(screen.getByText(KYC_COPY.rejectDialog.reasonRequired)).toBeTruthy();
    expect(rejectCallCount).toBe(0);

    const reasonSelect = screen.getByLabelText(KYC_COPY.rejectDialog.reasonLabel);
    fireEvent.change(reasonSelect, { target: { value: 'OTHER' } });
    fireEvent.click(submitRejectBtn);
    expect(screen.getByText(KYC_COPY.rejectDialog.noteRequired)).toBeTruthy();
    expect(rejectCallCount).toBe(0);

    fireEvent.change(reasonSelect, { target: { value: 'INFO_MISMATCH' } });
    fireEvent.click(submitRejectBtn);

    await screen.findByText(KYC_COPY.decisions.success.reject);
    expect(rejectCallCount).toBe(1);
    expect(capturedRejectBody).toEqual({ code: 'INFO_MISMATCH' });
    expect(screen.queryByRole('heading', { name: KYC_COPY.rejectDialog.title })).toBeNull();
  });

  it('yêu cầu bổ sung bắt buộc chọn giấy tờ', async () => {
    let moreInfoCallCount = 0;
    let capturedMoreInfoBody: unknown = null;
    const detail = kycDetail({ id: SUBMISSION_ID_1 });
    server.use(
      meHandler(adminMe('REVIEWER')),
      emptyKycQueueHandler(),
      http.get(`${TEST_API_URL}/admin/kyc/submissions/${SUBMISSION_ID_1}`, () => {
        return HttpResponse.json(detail);
      }),
      http.post(
        `${TEST_API_URL}/admin/kyc/submissions/${SUBMISSION_ID_1}/request-more-info`,
        async ({ request }) => {
          moreInfoCallCount++;
          capturedMoreInfoBody = await request.json();
          return HttpResponse.json(decisionFrom(detail, { status: 'NEEDS_MORE_INFO' }));
        },
      ),
    );

    await renderApp(`/kyc/${SUBMISSION_ID_1}`, { token: 'valid-token' });
    const openMoreInfoBtn = await screen.findByRole('button', {
      name: KYC_COPY.decisions.requestMoreInfo,
    });
    fireEvent.click(openMoreInfoBtn);

    await screen.findByRole('heading', { name: KYC_COPY.moreInfoDialog.title });
    const submitMoreInfoBtn = screen.getByRole('button', {
      name: KYC_COPY.moreInfoDialog.submit,
    });

    fireEvent.click(submitMoreInfoBtn);
    expect(screen.getByText(KYC_COPY.moreInfoDialog.itemsRequired)).toBeTruthy();
    expect(moreInfoCallCount).toBe(0);

    const selfieCheckbox = screen.getByLabelText(KYC_COPY.moreInfoItems.SELFIE);
    fireEvent.click(selfieCheckbox);
    const noteInput = screen.getByLabelText(KYC_COPY.moreInfoDialog.noteLabel);
    fireEvent.change(noteInput, { target: { value: 'Ảnh mờ' } });
    fireEvent.click(submitMoreInfoBtn);

    await screen.findByText(KYC_COPY.decisions.success.requestMoreInfo);
    expect(moreInfoCallCount).toBe(1);
    expect(capturedMoreInfoBody).toEqual({ items: ['SELFIE'], note: 'Ảnh mờ' });
  });

  it('chỉ có kyc:review → không có nút quyết định, vẫn nhận được hồ sơ', async () => {
    const detail = kycDetail({ id: SUBMISSION_ID_1, reviewerId: null });
    server.use(
      meHandler({ ...adminMe('REVIEWER'), permissions: ['kyc:review'] }),
      emptyKycQueueHandler(),
      http.get(`${TEST_API_URL}/admin/kyc/submissions/${SUBMISSION_ID_1}`, () => {
        return HttpResponse.json(detail);
      }),
    );

    await renderApp(`/kyc/${SUBMISSION_ID_1}`, { token: 'valid-token' });
    await screen.findByText(KYC_COPY.decisions.noDecidePermission);

    expect(screen.queryByRole('button', { name: KYC_COPY.decisions.approve })).toBeNull();
    expect(screen.queryByRole('button', { name: KYC_COPY.decisions.reject })).toBeNull();
    expect(screen.queryByRole('button', { name: KYC_COPY.decisions.requestMoreInfo })).toBeNull();
    expect(
      screen.queryByRole('button', {
        name: `${KYC_COPY.detail.stepPass}: ${KYC_COPY.steps.CCCD_CHIP}`,
      }),
    ).toBeNull();
    expect(screen.getByRole('button', { name: KYC_COPY.decisions.assign })).toBeTruthy();
  });
});
