// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import { server } from './test-utils/msw-server';
import { renderApp } from './test-utils/render-app';
import { setupMockMediaAndCanvas } from './test-utils/setup-dom';
import { LOGIN_COPY } from './features/auth/copy';

beforeAll(() => {
  setupMockMediaAndCanvas();
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});

describe('PartnerApp', () => {
  it('chưa đăng nhập hiển thị form đăng nhập nhân viên', async () => {
    await renderApp('/login');
    expect(await screen.findByRole('heading', { name: LOGIN_COPY.title })).toBeTruthy();
  });
});
