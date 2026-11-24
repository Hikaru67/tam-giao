// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { TEST_API_URL, problem } from '@tamgiao/api-client/mocks';
import { messageFor } from '@tamgiao/api-client';
import { server, meHandler } from '../../test-utils/msw-server';
import { partnerSessionFixture, partnerMeFixture, STAFF_ID } from '../../test-utils/fixtures';
import { renderApp } from '../../test-utils/render-app';
import { setupMockMediaAndCanvas } from '../../test-utils/setup-dom';
import { LOGIN_COPY, SCAN_COPY } from './copy';
import { STAFF_ID_STORAGE_KEY } from './staff-id-store';
import { resetDeviceIdMemoryForTesting } from './device-id';

beforeAll(() => {
  setupMockMediaAndCanvas();
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
  localStorage.clear();
  sessionStorage.clear();
  resetDeviceIdMemoryForTesting();
});

afterAll(() => {
  server.close();
});

describe('LoginPage', () => {
  it('chưa đăng nhập truy cập / sẽ bị chuyển hướng về /login', async () => {
    const { history } = await renderApp('/');

    await screen.findByRole('heading', { name: LOGIN_COPY.title });
    expect(history.location.pathname).toBe('/login');
  });

  it('đăng nhập thành công: gửi đúng body, chuyển về trang quét và lưu token + nhớ staffId', async () => {
    let capturedBody: unknown = null;
    server.use(
      http.post(`${TEST_API_URL}/partner/auth/login`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json(partnerSessionFixture());
      }),
      meHandler(partnerMeFixture()),
    );

    const { history, tokenStore } = await renderApp('/login');

    await screen.findByRole('heading', { name: LOGIN_COPY.title });

    fireEvent.change(screen.getByLabelText(LOGIN_COPY.staffIdLabel), {
      target: { value: STAFF_ID },
    });
    fireEvent.change(screen.getByLabelText(LOGIN_COPY.pinLabel), {
      target: { value: '123456' },
    });

    fireEvent.click(screen.getByRole('button', { name: LOGIN_COPY.submit }));

    await screen.findByText(new RegExp(SCAN_COPY.header.staffLabel));

    expect(capturedBody).toEqual({
      staffId: STAFF_ID,
      pin: '123456',
      deviceId: expect.stringMatching(/^[A-Za-z0-9._:-]{8,128}$/),
    });

    expect(history.location.pathname).toBe('/');
    expect(await tokenStore.getAccessToken()).toBe('partner-session-token');
    expect(localStorage.getItem(STAFF_ID_STORAGE_KEY)).toBe(STAFF_ID);
  });

  it('sai PIN hoặc tài khoản: trả 401 PARTNER_LOGIN_FAILED, hiện alert, xoá ô PIN, không lưu token', async () => {
    server.use(
      http.post(`${TEST_API_URL}/partner/auth/login`, () => {
        return problem(401, 'PARTNER_LOGIN_FAILED');
      }),
    );

    const { history, tokenStore } = await renderApp('/login');

    await screen.findByRole('heading', { name: LOGIN_COPY.title });

    fireEvent.change(screen.getByLabelText(LOGIN_COPY.staffIdLabel), {
      target: { value: STAFF_ID },
    });
    fireEvent.change(screen.getByLabelText(LOGIN_COPY.pinLabel), {
      target: { value: '999999' },
    });

    fireEvent.click(screen.getByRole('button', { name: LOGIN_COPY.submit }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(messageFor({ code: 'PARTNER_LOGIN_FAILED' }).title);

    const pinInput = screen.getByLabelText(LOGIN_COPY.pinLabel) as HTMLInputElement;
    expect(pinInput.value).toBe('');

    expect(history.location.pathname).toBe('/login');
    expect(await tokenStore.getAccessToken()).toBeNull();
  });

  it('tài khoản bị khoá: trả 429 PARTNER_STAFF_LOCKED, hiện số phút còn lại từ meta và xoá PIN', async () => {
    server.use(
      http.post(`${TEST_API_URL}/partner/auth/login`, () => {
        return problem(429, 'PARTNER_STAFF_LOCKED', {
          meta: { retryAfterSeconds: 900 },
        });
      }),
    );

    await renderApp('/login');

    await screen.findByRole('heading', { name: LOGIN_COPY.title });

    fireEvent.change(screen.getByLabelText(LOGIN_COPY.staffIdLabel), {
      target: { value: STAFF_ID },
    });
    fireEvent.change(screen.getByLabelText(LOGIN_COPY.pinLabel), {
      target: { value: '111111' },
    });

    fireEvent.click(screen.getByRole('button', { name: LOGIN_COPY.submit }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(messageFor({ code: 'PARTNER_STAFF_LOCKED' }).title);
    expect(alert.textContent).toContain(LOGIN_COPY.lockedNotice(15));

    const pinInput = screen.getByLabelText(LOGIN_COPY.pinLabel) as HTMLInputElement;
    expect(pinInput.value).toBe('');
  });

  it('quán hoặc nhân viên ngừng hoạt động: trả 403 PARTNER_INACTIVE, hiện alert lỗi', async () => {
    server.use(
      http.post(`${TEST_API_URL}/partner/auth/login`, () => {
        return problem(403, 'PARTNER_INACTIVE');
      }),
    );

    await renderApp('/login');

    await screen.findByRole('heading', { name: LOGIN_COPY.title });

    fireEvent.change(screen.getByLabelText(LOGIN_COPY.staffIdLabel), {
      target: { value: STAFF_ID },
    });
    fireEvent.change(screen.getByLabelText(LOGIN_COPY.pinLabel), {
      target: { value: '123456' },
    });

    fireEvent.click(screen.getByRole('button', { name: LOGIN_COPY.submit }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(messageFor({ code: 'PARTNER_INACTIVE' }).title);
  });

  it('nhớ staffId từ trước: hiện thông báo đã nhớ, cho phép bấm đổi mã nhân viên', async () => {
    localStorage.setItem(STAFF_ID_STORAGE_KEY, STAFF_ID);

    await renderApp('/login');

    await screen.findByRole('heading', { name: LOGIN_COPY.title });
    expect(screen.getByText(LOGIN_COPY.rememberedStaffNotice)).toBeTruthy();
    expect(screen.getByText(STAFF_ID)).toBeTruthy();

    // Bấm đổi mã nhân viên
    fireEvent.click(screen.getByRole('button', { name: LOGIN_COPY.changeStaffId }));

    // Hiện lại ô nhập mã nhân viên rỗng
    const staffIdInput = screen.getByLabelText(LOGIN_COPY.staffIdLabel) as HTMLInputElement;
    expect(staffIdInput.value).toBe('');
    expect(localStorage.getItem(STAFF_ID_STORAGE_KEY)).toBeNull();
  });
});
