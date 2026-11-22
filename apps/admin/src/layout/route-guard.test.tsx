// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { act, screen, fireEvent, within } from '@testing-library/react';
import { server, meHandler, meUnauthorizedHandler, logoutHandler } from '../test-utils/msw-server';
import { adminMe } from '../test-utils/fixtures';
import { renderApp } from '../test-utils/render-app';
import { emptyKycQueueHandler } from '../features/kyc/kyc-test-fixtures';
import { LOGIN_COPY } from '../features/auth/copy';
import { FORBIDDEN_COPY, NAV_COPY, OVERVIEW_COPY, SHELL_COPY } from './copy';

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});

describe('route-guard', () => {
  it('chưa đăng nhập vào URL được bảo vệ → màn login', async () => {
    const { history } = await renderApp('/kyc');

    await screen.findByRole('heading', { name: LOGIN_COPY.title });
    expect(history.location.pathname).toBe('/login');
    expect(new URLSearchParams(history.location.search).get('redirect')).toBe('/kyc');
  });

  it('401 từ /admin/auth/me → về đăng nhập + xoá token', async () => {
    server.use(meUnauthorizedHandler());

    const { tokenStore } = await renderApp('/kyc', { token: 'invalid-token' });

    await screen.findByRole('heading', { name: LOGIN_COPY.title });
    expect(await tokenStore.getAccessToken()).toBeNull();
  });

  it('AC1: role không có kyc:review không thấy menu thẩm định và vào URL trực tiếp thấy 403', async () => {
    server.use(meHandler(adminMe('MATCHMAKER')));

    await renderApp('/kyc', { token: 'valid-token' });

    await screen.findByRole('heading', { name: FORBIDDEN_COPY.title });
    const nav = screen.getByRole('navigation', { name: SHELL_COPY.navLabel });
    expect(within(nav).queryByRole('link', { name: NAV_COPY.kyc })).toBeNull();
    expect(within(nav).getByRole('link', { name: NAV_COPY.overview })).toBeTruthy();
  });

  it('REVIEWER thấy menu thẩm định và vào được', async () => {
    server.use(meHandler(adminMe('REVIEWER')), emptyKycQueueHandler());

    const { history } = await renderApp('/kyc', { token: 'valid-token' });

    await screen.findByRole('heading', { name: NAV_COPY.kyc, level: 1 });
    const nav = screen.getByRole('navigation', { name: SHELL_COPY.navLabel });
    expect(within(nav).getByRole('link', { name: NAV_COPY.kyc })).toBeTruthy();
    expect(within(nav).queryByRole('link', { name: NAV_COPY.audit })).toBeNull();

    history.push('/audit');
    await screen.findByRole('heading', { name: FORBIDDEN_COPY.title });
  });

  it('đã đăng nhập mở /login → về trang tổng quan', async () => {
    server.use(meHandler(adminMe('REVIEWER')));

    const { history } = await renderApp('/login', { token: 'valid-token' });

    await screen.findByRole('heading', { name: OVERVIEW_COPY.title });
    expect(history.location.pathname).toBe('/');
  });

  it('phiên hết hạn giữa chừng (api-client báo đăng xuất) → về đăng nhập, giữ trang đang mở để quay lại', async () => {
    server.use(meHandler(adminMe('REVIEWER')), emptyKycQueueHandler());

    const { history, sessionEvents, tokenStore } = await renderApp('/kyc', {
      token: 'admin-session-token',
    });
    await screen.findByRole('heading', { name: NAV_COPY.kyc, level: 1 });

    // Như api-client khi gặp 401: xoá token rồi phát onSignedOut.
    await tokenStore.clear();

    act(() => {
      sessionEvents.emitSignedOut();
    });

    await screen.findByRole('heading', { name: LOGIN_COPY.title });
    expect(history.location.pathname).toBe('/login');
    expect(new URLSearchParams(history.location.search).get('redirect')).toBe('/kyc');
  });

  it('đăng xuất', async () => {
    let authHeader: string | null = null;
    server.use(
      meHandler(adminMe('REVIEWER')),
      logoutHandler((req) => {
        authHeader = req.headers.get('authorization');
      }),
    );

    const { tokenStore } = await renderApp('/', { token: 'admin-session-token' });

    await screen.findByRole('heading', { name: OVERVIEW_COPY.title });
    const logoutBtn = screen.getByRole('button', { name: SHELL_COPY.logout });
    fireEvent.click(logoutBtn);

    await screen.findByRole('heading', { name: LOGIN_COPY.title });
    expect(authHeader).toBe('Bearer admin-session-token');
    expect(await tokenStore.getAccessToken()).toBeNull();
  });
});
