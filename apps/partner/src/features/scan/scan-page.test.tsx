// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { TEST_API_URL, problem } from '@tamgiao/api-client/mocks';
import { server, meHandler } from '../../test-utils/msw-server';
import { redeemSuccessFixture } from '../../test-utils/fixtures';
import { renderApp } from '../../test-utils/render-app';
import { setupMockMediaAndCanvas } from '../../test-utils/setup-dom';
import { SCAN_COPY, LOGIN_COPY } from '../auth/copy';

beforeAll(() => {
  setupMockMediaAndCanvas();
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
  localStorage.clear();
  sessionStorage.clear();
});

afterAll(() => {
  server.close();
});

describe('ScanPage', () => {
  it('đổi voucher thành công qua nhập mã thủ công: hiển thị đúng số tiền VND', async () => {
    let capturedToken: unknown = null;
    server.use(
      meHandler(),
      http.post(`${TEST_API_URL}/partner/vouchers/redeem`, async ({ request }) => {
        const body = (await request.json()) as { token: string };
        capturedToken = body.token;
        return HttpResponse.json(redeemSuccessFixture(300_000));
      }),
    );

    await renderApp('/', { token: 'valid-partner-token' });

    await screen.findByText(new RegExp(SCAN_COPY.header.staffLabel));

    // Mở nhập thủ công
    fireEvent.click(screen.getByRole('button', { name: SCAN_COPY.scanner.openManualInput }));

    fireEvent.change(screen.getByLabelText(SCAN_COPY.manualInput.tokenLabel), {
      target: { value: 'sample-voucher-token-123' },
    });

    fireEvent.click(screen.getByRole('button', { name: SCAN_COPY.manualInput.submit }));

    await screen.findByRole('region', {
      name: SCAN_COPY.outcomes.success.title,
    });

    expect(capturedToken).toBe('sample-voucher-token-123');
    expect(screen.getByText(SCAN_COPY.formatVnd(300_000))).toBeTruthy();

    // Bấm Quét mã tiếp để quay lại màn hình quét
    fireEvent.click(screen.getByRole('button', { name: SCAN_COPY.actions.nextScan }));
    await screen.findByText(SCAN_COPY.scanner.title);
  });

  it('AC1: gửi 2 lần cùng mã → lần 2 báo Voucher đã được sử dụng (không phải lỗi kỹ thuật)', async () => {
    let callCount = 0;
    server.use(
      meHandler(),
      http.post(`${TEST_API_URL}/partner/vouchers/redeem`, () => {
        callCount++;
        if (callCount === 1) {
          return HttpResponse.json(redeemSuccessFixture(300_000));
        }
        return problem(409, 'VOUCHER_ALREADY_REDEEMED');
      }),
    );

    await renderApp('/', { token: 'valid-partner-token' });
    await screen.findByText(new RegExp(SCAN_COPY.header.staffLabel));

    // Lần 1: Thành công
    fireEvent.click(screen.getByRole('button', { name: SCAN_COPY.scanner.openManualInput }));
    fireEvent.change(screen.getByLabelText(SCAN_COPY.manualInput.tokenLabel), {
      target: { value: 'same-token-code' },
    });
    fireEvent.click(screen.getByRole('button', { name: SCAN_COPY.manualInput.submit }));

    await screen.findByRole('region', {
      name: SCAN_COPY.outcomes.success.title,
    });

    // Bấm Quét mã tiếp
    fireEvent.click(screen.getByRole('button', { name: SCAN_COPY.actions.nextScan }));
    await screen.findByText(SCAN_COPY.scanner.title);

    // Lần 2: Quét lại cùng mã
    fireEvent.click(screen.getByRole('button', { name: SCAN_COPY.scanner.openManualInput }));
    fireEvent.change(screen.getByLabelText(SCAN_COPY.manualInput.tokenLabel), {
      target: { value: 'same-token-code' },
    });
    fireEvent.click(screen.getByRole('button', { name: SCAN_COPY.manualInput.submit }));

    await screen.findByRole('region', {
      name: SCAN_COPY.outcomes.alreadyRedeemed.title,
    });
    expect(screen.getByText(SCAN_COPY.outcomes.alreadyRedeemed.title)).toBeTruthy();
    expect(callCount).toBe(2);
  });

  it('lỗi mạng khi đổi voucher: Thử lại gửi lại CÙNG token; nếu nhận ALREADY_REDEEMED thì hiện thông báo nghi vấn thành công trước đó', async () => {
    const sentTokens: string[] = [];
    let callCount = 0;
    server.use(
      meHandler(),
      http.post(`${TEST_API_URL}/partner/vouchers/redeem`, async ({ request }) => {
        callCount++;
        const body = (await request.json()) as { token: string };
        sentTokens.push(body.token);

        if (callCount === 1) {
          // Lần đầu mạng rớt (giả lập status 0 / network error)
          return HttpResponse.error();
        }
        // Lần 2 gửi lại: BE báo đã đổi xong
        return problem(409, 'VOUCHER_ALREADY_REDEEMED');
      }),
    );

    await renderApp('/', { token: 'valid-partner-token' });
    await screen.findByText(new RegExp(SCAN_COPY.header.staffLabel));

    fireEvent.click(screen.getByRole('button', { name: SCAN_COPY.scanner.openManualInput }));
    fireEvent.change(screen.getByLabelText(SCAN_COPY.manualInput.tokenLabel), {
      target: { value: 'retry-network-token' },
    });
    fireEvent.click(screen.getByRole('button', { name: SCAN_COPY.manualInput.submit }));

    // Màn lỗi mạng
    await screen.findByRole('region', {
      name: SCAN_COPY.outcomes.network.title,
    });

    // Bấm "Thử lại"
    fireEvent.click(screen.getByRole('button', { name: SCAN_COPY.actions.retry }));

    // Lần này nhận ALREADY_REDEEMED kèm dòng nghi vấn thành công lần gửi trước
    await screen.findByRole('region', {
      name: SCAN_COPY.outcomes.alreadyRedeemed.title,
    });

    expect(screen.getByText(SCAN_COPY.outcomes.possiblePriorSuccess)).toBeTruthy();
    expect(sentTokens).toEqual(['retry-network-token', 'retry-network-token']);
  });

  it('xử lý các lỗi nghiệp vụ: VOUCHER_TOKEN_INVALID, VOUCHER_EXPIRED, VOUCHER_PARTNER_MISMATCH', async () => {
    let returnCode = 'VOUCHER_TOKEN_INVALID';
    let returnStatus = 422;

    server.use(
      meHandler(),
      http.post(`${TEST_API_URL}/partner/vouchers/redeem`, () => {
        return problem(returnStatus, returnCode);
      }),
    );

    await renderApp('/', { token: 'valid-partner-token' });
    await screen.findByText(new RegExp(SCAN_COPY.header.staffLabel));

    // 1. VOUCHER_TOKEN_INVALID
    fireEvent.click(screen.getByRole('button', { name: SCAN_COPY.scanner.openManualInput }));
    fireEvent.change(screen.getByLabelText(SCAN_COPY.manualInput.tokenLabel), {
      target: { value: 'invalid-token' },
    });
    fireEvent.click(screen.getByRole('button', { name: SCAN_COPY.manualInput.submit }));

    await screen.findByRole('region', {
      name: SCAN_COPY.outcomes.invalidCode.title,
    });
    fireEvent.click(screen.getByRole('button', { name: SCAN_COPY.actions.nextScan }));

    // 2. VOUCHER_EXPIRED
    returnCode = 'VOUCHER_EXPIRED';
    returnStatus = 410;
    fireEvent.click(screen.getByRole('button', { name: SCAN_COPY.scanner.openManualInput }));
    fireEvent.change(screen.getByLabelText(SCAN_COPY.manualInput.tokenLabel), {
      target: { value: 'expired-token' },
    });
    fireEvent.click(screen.getByRole('button', { name: SCAN_COPY.manualInput.submit }));

    await screen.findByRole('region', {
      name: SCAN_COPY.outcomes.expired.title,
    });
    fireEvent.click(screen.getByRole('button', { name: SCAN_COPY.actions.nextScan }));

    // 3. VOUCHER_PARTNER_MISMATCH
    returnCode = 'VOUCHER_PARTNER_MISMATCH';
    returnStatus = 403;
    fireEvent.click(screen.getByRole('button', { name: SCAN_COPY.scanner.openManualInput }));
    fireEvent.change(screen.getByLabelText(SCAN_COPY.manualInput.tokenLabel), {
      target: { value: 'mismatch-token' },
    });
    fireEvent.click(screen.getByRole('button', { name: SCAN_COPY.manualInput.submit }));

    await screen.findByRole('region', {
      name: SCAN_COPY.outcomes.wrongPartner.title,
    });
  });

  it('401 PARTNER_TOKEN_INVALID tự động kích hoạt đăng xuất về trang /login', async () => {
    server.use(
      meHandler(),
      http.post(`${TEST_API_URL}/partner/vouchers/redeem`, () => {
        return problem(401, 'PARTNER_TOKEN_INVALID');
      }),
    );

    const { history, tokenStore } = await renderApp('/', {
      token: 'expired-session-token',
    });
    await screen.findByText(new RegExp(SCAN_COPY.header.staffLabel));

    fireEvent.click(screen.getByRole('button', { name: SCAN_COPY.scanner.openManualInput }));
    fireEvent.change(screen.getByLabelText(SCAN_COPY.manualInput.tokenLabel), {
      target: { value: 'test-token' },
    });
    fireEvent.click(screen.getByRole('button', { name: SCAN_COPY.manualInput.submit }));

    await screen.findByRole('heading', { name: LOGIN_COPY.title });
    expect(history.location.pathname).toBe('/login');
    expect(await tokenStore.getAccessToken()).toBeNull();
  });

  it('403 PARTNER_INACTIVE hiển thị thông báo ngừng hoạt động và nút đăng xuất', async () => {
    server.use(
      meHandler(),
      http.post(`${TEST_API_URL}/partner/vouchers/redeem`, () => {
        return problem(403, 'PARTNER_INACTIVE');
      }),
    );

    await renderApp('/', { token: 'valid-partner-token' });
    await screen.findByText(new RegExp(SCAN_COPY.header.staffLabel));

    fireEvent.click(screen.getByRole('button', { name: SCAN_COPY.scanner.openManualInput }));
    fireEvent.change(screen.getByLabelText(SCAN_COPY.manualInput.tokenLabel), {
      target: { value: 'test-token' },
    });
    fireEvent.click(screen.getByRole('button', { name: SCAN_COPY.manualInput.submit }));

    await screen.findByText(SCAN_COPY.outcomes.inactivePartner.title);
    expect(screen.getByText(SCAN_COPY.outcomes.inactivePartner.description)).toBeTruthy();
  });

  it('403 PARTNER_INACTIVE ngay khi mở app (GET /partner/auth/me) → màn ngừng hoạt động, đăng xuất được', async () => {
    server.use(http.get(`${TEST_API_URL}/partner/auth/me`, () => problem(403, 'PARTNER_INACTIVE')));
    const { history } = await renderApp('/', { token: 'valid-partner-token' });
    await screen.findByText(SCAN_COPY.outcomes.inactivePartner.title);
    fireEvent.click(screen.getByRole('button', { name: SCAN_COPY.outcomes.inactivePartner.logoutAction }));
    await screen.findByRole('heading', { name: LOGIN_COPY.title });
    expect(history.location.pathname).toBe('/login');
  });
});
