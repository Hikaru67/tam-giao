import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { TEST_API_URL, problem } from '@tamgiao/api-client/mocks';
import type { PartnerMeResponse } from '@tamgiao/contracts/billing';
import { partnerMeFixture } from './fixtures';

export const server = setupServer();

export function meHandler(me: PartnerMeResponse = partnerMeFixture()) {
  return http.get(`${TEST_API_URL}/partner/auth/me`, () => {
    return HttpResponse.json(me);
  });
}

export function meUnauthorizedHandler() {
  return http.get(`${TEST_API_URL}/partner/auth/me`, () => {
    return problem(401, 'PARTNER_TOKEN_INVALID');
  });
}

export function meInactiveHandler() {
  return http.get(`${TEST_API_URL}/partner/auth/me`, () => {
    return problem(403, 'PARTNER_INACTIVE');
  });
}
