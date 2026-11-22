import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { TEST_API_URL, problem } from '@tamgiao/api-client/mocks';
import type { AdminMeResponse } from '@tamgiao/contracts/identity';

export const server = setupServer();

export function meHandler(me: AdminMeResponse) {
  return http.get(`${TEST_API_URL}/admin/auth/me`, () => {
    return HttpResponse.json(me);
  });
}

export function meUnauthorizedHandler() {
  return http.get(`${TEST_API_URL}/admin/auth/me`, () => {
    return problem(401, 'UNAUTHENTICATED');
  });
}

export function logoutHandler(onCall?: (request: Request) => void) {
  return http.post(`${TEST_API_URL}/admin/auth/logout`, ({ request }) => {
    onCall?.(request);
    return new HttpResponse(null, { status: 204 });
  });
}
