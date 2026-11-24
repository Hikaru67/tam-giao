import { isApiError, type ApiClient } from '@tamgiao/api-client';
import { useApiClient } from '@tamgiao/api-client/react';
import {
  adminPartnerListResponseSchema,
  adminPartnerSchema,
  adminPartnerStaffListResponseSchema,
  adminPartnerStaffSchema,
  createPartnerBodySchema,
  createPartnerStaffBodySchema,
  updatePartnerBodySchema,
  updatePartnerStaffBodySchema,
  type AdminPartner,
  type AdminPartnerListResponse,
  type AdminPartnerStaff,
  type AdminPartnerStaffListResponse,
  type CreatePartnerBody,
  type CreatePartnerStaffBody,
  type UpdatePartnerBody,
  type UpdatePartnerStaffBody,
} from '@tamgiao/contracts/billing';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';

export const PARTNERS_QUERY_KEYS = {
  all: ['admin', 'partners'] as const,
  list: (active?: boolean) =>
    active === undefined
      ? (['admin', 'partners', 'list'] as const)
      : (['admin', 'partners', 'list', active] as const),
  detail: (partnerId: string) => ['admin', 'partners', 'detail', partnerId] as const,
  staffList: (partnerId: string) => ['admin', 'partners', 'staff', partnerId] as const,
};

const throwForbidden = (error: Error) => isApiError(error) && error.status === 403;

export function fetchPartnersList(
  client: ApiClient,
  active?: boolean,
  signal?: AbortSignal,
): Promise<AdminPartnerListResponse> {
  return client.get('/admin/partners', {
    ...(active !== undefined ? { query: { active: String(active) } } : {}),
    schema: adminPartnerListResponseSchema,
    signal,
  });
}

export function fetchPartnerDetail(
  client: ApiClient,
  partnerId: string,
  signal?: AbortSignal,
): Promise<AdminPartner> {
  return client.get(`/admin/partners/${encodeURIComponent(partnerId)}`, {
    schema: adminPartnerSchema,
    signal,
  });
}

export function fetchPartnerStaffList(
  client: ApiClient,
  partnerId: string,
  signal?: AbortSignal,
): Promise<AdminPartnerStaffListResponse> {
  return client.get(`/admin/partners/${encodeURIComponent(partnerId)}/staff`, {
    schema: adminPartnerStaffListResponseSchema,
    signal,
  });
}

export function partnersListQueryOptions(client: ApiClient, active?: boolean) {
  return queryOptions({
    queryKey: PARTNERS_QUERY_KEYS.list(active),
    queryFn: ({ signal }) => fetchPartnersList(client, active, signal),
    throwOnError: throwForbidden,
  });
}

export function partnerDetailQueryOptions(client: ApiClient, partnerId: string) {
  return queryOptions({
    queryKey: PARTNERS_QUERY_KEYS.detail(partnerId),
    queryFn: ({ signal }) => fetchPartnerDetail(client, partnerId, signal),
    throwOnError: throwForbidden,
  });
}

export function partnerStaffListQueryOptions(client: ApiClient, partnerId: string) {
  return queryOptions({
    queryKey: PARTNERS_QUERY_KEYS.staffList(partnerId),
    queryFn: ({ signal }) => fetchPartnerStaffList(client, partnerId, signal),
    throwOnError: throwForbidden,
  });
}

export function useCreatePartner() {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: CreatePartnerBody): Promise<AdminPartner> =>
      client.post('/admin/partners', {
        body: createPartnerBodySchema.parse(body),
        schema: adminPartnerSchema,
      }),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: PARTNERS_QUERY_KEYS.all });
    },
  });
}

export function useUpdatePartner(partnerId: string) {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: UpdatePartnerBody): Promise<AdminPartner> =>
      client.patch(`/admin/partners/${encodeURIComponent(partnerId)}`, {
        body: updatePartnerBodySchema.parse(body),
        schema: adminPartnerSchema,
      }),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: PARTNERS_QUERY_KEYS.all });
    },
  });
}

export function useCreatePartnerStaff(partnerId: string) {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    gcTime: 0,
    mutationFn: (body: CreatePartnerStaffBody): Promise<AdminPartnerStaff> =>
      client.post(`/admin/partners/${encodeURIComponent(partnerId)}/staff`, {
        body: createPartnerStaffBodySchema.parse(body),
        schema: adminPartnerStaffSchema,
      }),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: PARTNERS_QUERY_KEYS.staffList(partnerId) });
    },
  });
}

export function useUpdatePartnerStaff(partnerId: string) {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    gcTime: 0,
    mutationFn: ({
      staffId,
      body,
    }: {
      staffId: string;
      body: UpdatePartnerStaffBody;
    }): Promise<AdminPartnerStaff> =>
      client.patch(`/admin/partners/${encodeURIComponent(partnerId)}/staff/${encodeURIComponent(staffId)}`, {
        body: updatePartnerStaffBodySchema.parse(body),
        schema: adminPartnerStaffSchema,
      }),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: PARTNERS_QUERY_KEYS.staffList(partnerId) });
    },
  });
}
