/**
 * MSW handlers và helpers dùng chung cho việc kiểm thử frontend và môi trường phát triển local.
 * Chỉ sử dụng trong test và dev; không đưa vào bundle production của ứng dụng.
 */
import { http, HttpResponse } from 'msw';
import type { AuthTokens } from '@tamgiao/contracts/identity';

export const TEST_API_URL = 'http://api.test';

/**
 * Helper tạo phản hồi lỗi Problem Details chuẩn RFC 7807 cho MSW.
 */
export function problem(
  status: number,
  code: string,
  extra?:
    | {
        meta?: Record<string, unknown> | undefined;
        errors?: { path: string; message: string }[] | undefined;
      }
    | undefined,
) {
  return HttpResponse.json(
    {
      type: 'about:blank',
      title: code,
      status,
      code,
      traceId: 'trace-test',
      ...extra,
    },
    { status },
  );
}

/**
 * Helper tạo đối tượng AuthTokens giả lập hợp lệ theo authTokensSchema.
 */
export function authTokens(overrides?: Partial<AuthTokens> | undefined): AuthTokens {
  return {
    sessionId: '00000000-0000-7000-8000-000000000001',
    accessToken: 'test-access-token',
    accessTokenExpiresInSeconds: 3600,
    refreshToken: 'test-refresh-token-fixed-length-valid',
    refreshTokenExpiresAt: '2026-12-31T23:59:59.000Z',
    ...overrides,
  };
}

/**
 * Bộ handler cơ bản cho MSW (hỗ trợ kiểm tra sức khoẻ hệ thống và làm mới token).
 */
export const baseHandlers = [
  http.post(`${TEST_API_URL}/auth/refresh`, () => HttpResponse.json(authTokens())),
  http.get(`${TEST_API_URL}/health`, () => HttpResponse.json({ status: 'ok' })),
];
