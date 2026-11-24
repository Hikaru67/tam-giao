import { isApiError, type ApiClient } from '@tamgiao/api-client';
import { useApiClient } from '@tamgiao/api-client/react';
import {
  adminFeedbackDetailSchema,
  appearanceFlagQueueResponseSchema,
  type AdminFeedbackDetailResponse,
  type AppearanceFlagQueueResponse,
} from '@tamgiao/contracts/dating';
import {
  adminRefundBodySchema,
  adminRefundResponseSchema,
  reconciliationReportListResponseSchema,
  type AdminRefundBody,
  type AdminRefundResponse,
  type ReconciliationReportListResponse,
  type RECONCILIATION_STATUS_VALUES,
} from '@tamgiao/contracts/billing';
import { PAGE_LIMIT_DEFAULT } from '@tamgiao/contracts/http';
import { infiniteQueryOptions, queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';

export type ReconciliationStatusValue = (typeof RECONCILIATION_STATUS_VALUES)[number];

export const OPERATIONS_QUERY_KEYS = {
  all: ['admin', 'operations'] as const,
  appearanceFlags: ['admin', 'operations', 'appearance-flags'] as const,
  appearanceFlagsQueue: ['admin', 'operations', 'appearance-flags', 'queue'] as const,
  feedbackDetail: (feedbackId: string) => ['admin', 'operations', 'feedbacks', feedbackId] as const,
  reconciliation: ['admin', 'operations', 'reconciliation'] as const,
  reconciliationQueue: (status?: ReconciliationStatusValue) =>
    ['admin', 'operations', 'reconciliation', 'queue', status ?? 'ALL'] as const,
};

const throwForbidden = (error: Error) => isApiError(error) && error.status === 403;

export function fetchAppearanceFlags(
  client: ApiClient,
  offset: number,
  limit = PAGE_LIMIT_DEFAULT,
  signal?: AbortSignal,
): Promise<AppearanceFlagQueueResponse> {
  return client.get('/admin/dating/appearance-flags', {
    query: { offset, limit },
    schema: appearanceFlagQueueResponseSchema,
    ...(signal ? { signal } : {}),
  });
}

export function appearanceFlagsInfiniteQueryOptions(client: ApiClient) {
  return infiniteQueryOptions({
    queryKey: OPERATIONS_QUERY_KEYS.appearanceFlagsQueue,
    queryFn: ({ pageParam, signal }) => fetchAppearanceFlags(client, pageParam, PAGE_LIMIT_DEFAULT, signal),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loadedCount = allPages.reduce((acc, p) => acc + p.items.length, 0);
      return loadedCount < lastPage.total ? loadedCount : undefined;
    },
    throwOnError: throwForbidden,
  });
}

export function fetchFeedbackDetail(
  client: ApiClient,
  feedbackId: string,
  signal?: AbortSignal,
): Promise<AdminFeedbackDetailResponse> {
  return client.get(`/admin/dating/feedbacks/${encodeURIComponent(feedbackId)}`, {
    schema: adminFeedbackDetailSchema,
    ...(signal ? { signal } : {}),
  });
}

export function feedbackDetailQueryOptions(client: ApiClient, feedbackId: string) {
  return queryOptions({
    queryKey: OPERATIONS_QUERY_KEYS.feedbackDetail(feedbackId),
    queryFn: ({ signal }) => fetchFeedbackDetail(client, feedbackId, signal),
    gcTime: 0,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    throwOnError: throwForbidden,
  });
}

export function fetchReconciliationReports(
  client: ApiClient,
  status?: ReconciliationStatusValue,
  cursor?: string | null,
  limit = PAGE_LIMIT_DEFAULT,
  signal?: AbortSignal,
): Promise<ReconciliationReportListResponse> {
  return client.get('/admin/billing/reconciliation-reports', {
    query: {
      ...(status ? { status } : {}),
      ...(cursor ? { cursor } : {}),
      limit,
    },
    schema: reconciliationReportListResponseSchema,
    ...(signal ? { signal } : {}),
  });
}

export function reconciliationInfiniteQueryOptions(client: ApiClient, status?: ReconciliationStatusValue) {
  return infiniteQueryOptions({
    queryKey: OPERATIONS_QUERY_KEYS.reconciliationQueue(status),
    queryFn: ({ pageParam, signal }) =>
      fetchReconciliationReports(client, status, pageParam, PAGE_LIMIT_DEFAULT, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    throwOnError: throwForbidden,
  });
}

export function useRefundPayment() {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      paymentId,
      body,
    }: {
      paymentId: string;
      body: AdminRefundBody;
    }): Promise<AdminRefundResponse> =>
      client.post(`/admin/payments/${encodeURIComponent(paymentId)}/refund`, {
        body: adminRefundBodySchema.parse(body),
        schema: adminRefundResponseSchema,
      }),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: OPERATIONS_QUERY_KEYS.reconciliation });
    },
  });
}
