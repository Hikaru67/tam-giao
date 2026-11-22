// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { TEST_API_URL, problem } from '@tamgiao/api-client/mocks';
import { messageFor } from '@tamgiao/api-client';
import { server, meHandler } from '../../test-utils/msw-server';
import { adminLoginResponse, adminMe } from '../../test-utils/fixtures';
import { renderApp } from '../../test-utils/render-app';
import { LOGIN_COPY } from './copy';
import { OVERVIEW_COPY, NAV_COPY } from '../../layout/copy';

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});

describe('LoginPage', () => {
  it('sai thông tin: trả 401 INVALID_CREDENTIALS, hiện lỗi alert, ô TOTP rỗng, không lưu token', async () => {
    server.use(
      http.post(`${TEST_API_URL}/admin/auth/login`, () => {
        return problem(401, 'INVALID_CREDENTIALS');
      }),
    );

    const { history, tokenStore } = await renderApp('/login');

    await screen.findByRole('heading', { name: LOGIN_COPY.title });

    fireEvent.change(screen.getByLabelText(LOGIN_COPY.emailLabel), {
      target: { value: 'admin@tamgiao.test' },
    });
    fireEvent.change(screen.getByLabelText(LOGIN_COPY.passwordLabel), {
      target: { value: 'wrong-password' },
    });
    fireEvent.change(screen.getByLabelText(LOGIN_COPY.totpLabel), {
      target: { value: '123456' },
    });

    fireEvent.click(screen.getByRole('button', { name: LOGIN_COPY.submit }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(messageFor({ code: 'INVALID_CREDENTIALS' }).title);

    const totpInput = screen.getByLabelText(LOGIN_COPY.totpLabel) as HTMLInputElement;
    expect(totpInput.value).toBe('');

    expect(history.location.pathname).toBe('/login');
    expect(await tokenStore.getAccessToken()).toBeNull();
  });

  it('tài khoản bị khoá 15 phút: trả 429 ADMIN_LOCKED, alert chứa messageFor title và action chứa 900', async () => {
    const lockedInfo = messageFor({ code: 'ADMIN_LOCKED', meta: { retryAfterSeconds: 900 } });

    server.use(
      http.post(`${TEST_API_URL}/admin/auth/login`, () => {
        return problem(429, 'ADMIN_LOCKED', { meta: { retryAfterSeconds: 900 } });
      }),
    );

    await renderApp('/login');

    await screen.findByRole('heading', { name: LOGIN_COPY.title });

    fireEvent.change(screen.getByLabelText(LOGIN_COPY.emailLabel), {
      target: { value: 'locked@tamgiao.test' },
    });
    fireEvent.change(screen.getByLabelText(LOGIN_COPY.passwordLabel), {
      target: { value: 'any-password' },
    });
    fireEvent.change(screen.getByLabelText(LOGIN_COPY.totpLabel), {
      target: { value: '123456' },
    });

    fireEvent.click(screen.getByRole('button', { name: LOGIN_COPY.submit }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(lockedInfo.title);
    expect(alert.textContent).toContain(lockedInfo.action ?? '');
    expect(alert.textContent).toContain('900');
  });

  it('validate phía client: TOTP không đúng 6 số hoặc email rỗng thì không gọi API', async () => {
    let callCount = 0;
    server.use(
      http.post(`${TEST_API_URL}/admin/auth/login`, () => {
        callCount++;
        return HttpResponse.json(adminLoginResponse('REVIEWER'));
      }),
    );

    await renderApp('/login');

    await screen.findByRole('heading', { name: LOGIN_COPY.title });

    // TOTP '12'
    fireEvent.change(screen.getByLabelText(LOGIN_COPY.emailLabel), {
      target: { value: 'admin@tamgiao.test' },
    });
    fireEvent.change(screen.getByLabelText(LOGIN_COPY.passwordLabel), {
      target: { value: 'password123' },
    });
    fireEvent.change(screen.getByLabelText(LOGIN_COPY.totpLabel), {
      target: { value: '12' },
    });

    fireEvent.click(screen.getByRole('button', { name: LOGIN_COPY.submit }));

    expect(screen.getByText(LOGIN_COPY.errors.totpInvalid)).toBeTruthy();
    expect(callCount).toBe(0);

    // Email rỗng
    fireEvent.change(screen.getByLabelText(LOGIN_COPY.emailLabel), {
      target: { value: '   ' },
    });
    fireEvent.change(screen.getByLabelText(LOGIN_COPY.totpLabel), {
      target: { value: '123456' },
    });

    fireEvent.click(screen.getByRole('button', { name: LOGIN_COPY.submit }));

    expect(screen.getByText(LOGIN_COPY.errors.emailRequired)).toBeTruthy();
    expect(callCount).toBe(0);
  });

  it('đăng nhập thành công: gửi đúng body, chuyển về trang tổng quan và lưu token', async () => {
    let capturedBody: unknown = null;
    server.use(
      http.post(`${TEST_API_URL}/admin/auth/login`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json(adminLoginResponse('REVIEWER'));
      }),
      meHandler(adminMe('REVIEWER')),
    );

    const { history, tokenStore } = await renderApp('/login');

    await screen.findByRole('heading', { name: LOGIN_COPY.title });

    fireEvent.change(screen.getByLabelText(LOGIN_COPY.emailLabel), {
      target: { value: 'reviewer@tamgiao.test' },
    });
    fireEvent.change(screen.getByLabelText(LOGIN_COPY.passwordLabel), {
      target: { value: 'secret-password' },
    });
    fireEvent.change(screen.getByLabelText(LOGIN_COPY.totpLabel), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByLabelText(LOGIN_COPY.rememberDevice));

    fireEvent.click(screen.getByRole('button', { name: LOGIN_COPY.submit }));

    await screen.findByRole('heading', { name: OVERVIEW_COPY.title });
    expect(capturedBody).toEqual({
      email: 'reviewer@tamgiao.test',
      password: 'secret-password',
      totpCode: '123456',
      rememberDevice: true,
    });
    expect(history.location.pathname).toBe('/');
    expect(await tokenStore.getAccessToken()).toBe('admin-session-token');
  });

  it('quay lại trang trước khi đăng nhập', async () => {
    server.use(
      http.post(`${TEST_API_URL}/admin/auth/login`, () => {
        return HttpResponse.json(adminLoginResponse('REVIEWER'));
      }),
      meHandler(adminMe('REVIEWER')),
    );

    const { history } = await renderApp('/login?redirect=%2Fkyc');

    await screen.findByRole('heading', { name: LOGIN_COPY.title });

    fireEvent.change(screen.getByLabelText(LOGIN_COPY.emailLabel), {
      target: { value: 'reviewer@tamgiao.test' },
    });
    fireEvent.change(screen.getByLabelText(LOGIN_COPY.passwordLabel), {
      target: { value: 'secret-password' },
    });
    fireEvent.change(screen.getByLabelText(LOGIN_COPY.totpLabel), {
      target: { value: '123456' },
    });

    fireEvent.click(screen.getByRole('button', { name: LOGIN_COPY.submit }));

    await screen.findByRole('heading', { name: NAV_COPY.kyc, level: 1 });
    expect(history.location.pathname).toBe('/kyc');
  });

  it('redirect ra ngoài app (https://evil.com) bị bỏ qua', async () => {
    server.use(
      http.post(`${TEST_API_URL}/admin/auth/login`, () => {
        return HttpResponse.json(adminLoginResponse('REVIEWER'));
      }),
      meHandler(adminMe('REVIEWER')),
    );

    const { history } = await renderApp('/login?redirect=https%3A%2F%2Fevil.com');

    await screen.findByRole('heading', { name: LOGIN_COPY.title });

    fireEvent.change(screen.getByLabelText(LOGIN_COPY.emailLabel), {
      target: { value: 'reviewer@tamgiao.test' },
    });
    fireEvent.change(screen.getByLabelText(LOGIN_COPY.passwordLabel), {
      target: { value: 'secret-password' },
    });
    fireEvent.change(screen.getByLabelText(LOGIN_COPY.totpLabel), {
      target: { value: '123456' },
    });

    fireEvent.click(screen.getByRole('button', { name: LOGIN_COPY.submit }));

    await screen.findByRole('heading', { name: OVERVIEW_COPY.title });
    expect(history.location.pathname).toBe('/');
  });
});
