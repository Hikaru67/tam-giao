import type { ApiClient } from '@tamgiao/api-client';
import {
  partnerLoginBodySchema,
  partnerSessionResponseSchema,
  partnerMeResponseSchema,
  type PartnerLoginBody,
  type PartnerSessionResponse,
  type PartnerMeResponse,
} from '@tamgiao/contracts/billing';
import { queryOptions } from '@tanstack/react-query';

export const PARTNER_ME_QUERY_KEY = ['partner', 'auth', 'me'] as const;

/**
 * `POST /partner/auth/login` — không gửi Bearer (`auth: false`) để 401 `PARTNER_LOGIN_FAILED` / 429
 * trả thẳng về form, không kích hoạt luồng đăng xuất của api-client.
 */
export function partnerLogin(client: ApiClient, body: PartnerLoginBody): Promise<PartnerSessionResponse> {
  return client.post('/partner/auth/login', {
    body: partnerLoginBodySchema.parse(body),
    schema: partnerSessionResponseSchema,
    auth: false,
  });
}

export function fetchPartnerMe(client: ApiClient, signal?: AbortSignal): Promise<PartnerMeResponse> {
  return client.get('/partner/auth/me', { schema: partnerMeResponseSchema, signal });
}

export function partnerMeQueryOptions(client: ApiClient) {
  return queryOptions({
    queryKey: PARTNER_ME_QUERY_KEY,
    queryFn: ({ signal }) => fetchPartnerMe(client, signal),
    staleTime: 60_000,
    retry: false,
  });
}

export function meFromSession(session: PartnerSessionResponse): PartnerMeResponse {
  return {
    staff: session.staff,
    partner: session.partner,
  };
}
