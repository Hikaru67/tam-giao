import { isApiError, type ApiClient } from '@tamgiao/api-client';
import { useApiClient } from '@tamgiao/api-client/react';
import { PRESIGNED_URL_TTL_SECONDS } from '@tamgiao/contracts/constants';
import { PAGE_LIMIT_DEFAULT } from '@tamgiao/contracts/http';
import {
  banUserBodySchema,
  banUserResponseSchema,
  flaggedMessageDetailResponseSchema,
  flaggedMessageQueueResponseSchema,
  reportActionResponseSchema,
  reportDetailResponseSchema,
  reportQueueResponseSchema,
  resolveReportBodySchema,
  type BanUserBody,
  type BanUserResponse,
  type FlaggedMessageDetailResponse,
  type FlaggedMessageQueueResponse,
  type ReportActionResponse,
  type ReportDetailResponse,
  type ReportQueueResponse,
  type ReportStatusName,
  type ResolveReportBody,
} from '@tamgiao/contracts/safety';
import { infiniteQueryOptions, queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';

/** Hằng số thời gian làm mới hàng chờ định kỳ (60 giây). */
export const QUEUE_REFETCH_INTERVAL_MS = 60_000;

/** Khoảng an toàn trước khi URL ảnh hết hạn (30 giây) để làm mới. */
export const PRESIGNED_REFRESH_MARGIN_MS = 30_000;

/** Khoảng chờ tối thiểu giữa hai lần xin lại (1 giây). */
export const PRESIGNED_REFRESH_MIN_DELAY_MS = 1_000;

export const MODERATION_QUERY_KEYS = {
  all: ['admin', 'moderation'] as const,
  reports: ['admin', 'moderation', 'reports'] as const,
  reportQueues: ['admin', 'moderation', 'reports', 'queue'] as const,
  reportQueue: (statuses: readonly ReportStatusName[]) =>
    ['admin', 'moderation', 'reports', 'queue', statuses] as const,
  reportDetail: (reportId: string) => ['admin', 'moderation', 'reports', 'detail', reportId] as const,
  flagged: ['admin', 'moderation', 'flagged'] as const,
  flaggedQueue: ['admin', 'moderation', 'flagged', 'queue'] as const,
  flaggedDetail: (messageId: string) => ['admin', 'moderation', 'flagged', 'detail', messageId] as const,
};

const throwForbidden = (error: Error) => isApiError(error) && error.status === 403;

type EvidenceItem = ReportDetailResponse['evidence'][number];

export function presignedEvidenceDeadlineMs(item: EvidenceItem, fetchedAt: number): number {
  const ttlDeadline = fetchedAt + PRESIGNED_URL_TTL_SECONDS * 1000;
  const expiresAt = Date.parse(item.expiresAt);
  if (Number.isNaN(expiresAt) || expiresAt <= fetchedAt) return ttlDeadline;
  return Math.min(expiresAt, ttlDeadline);
}

/**
 * Tính thời gian chờ (ms) trước khi cần xin lại chi tiết báo cáo để cập nhật URL presigned.
 * Trả về `false` nếu báo cáo không có bằng chứng ảnh nào.
 */
export function evidenceRefreshDelayMs(
  detail: ReportDetailResponse | undefined,
  fetchedAt: number,
  now: number,
): number | false {
  if (!detail || detail.evidence.length === 0) return false;
  const deadlines = detail.evidence.map((e) => presignedEvidenceDeadlineMs(e, fetchedAt));
  const delay = Math.min(...deadlines) - PRESIGNED_REFRESH_MARGIN_MS - now;
  return Math.max(delay, PRESIGNED_REFRESH_MIN_DELAY_MS);
}

export function isEvidenceRefreshDue(
  detail: ReportDetailResponse | undefined,
  fetchedAt: number,
  now: number,
): boolean {
  const delay = evidenceRefreshDelayMs(detail, fetchedAt, now);
  return delay !== false && delay <= PRESIGNED_REFRESH_MIN_DELAY_MS;
}

export function fetchReportQueue(
  client: ApiClient,
  statuses: readonly ReportStatusName[],
  offset: number,
  signal?: AbortSignal,
): Promise<ReportQueueResponse> {
  return client.get('/admin/reports', {
    query: { status: statuses.join(','), limit: PAGE_LIMIT_DEFAULT, offset },
    schema: reportQueueResponseSchema,
    signal,
  });
}

export function fetchReportDetail(
  client: ApiClient,
  reportId: string,
  signal?: AbortSignal,
): Promise<ReportDetailResponse> {
  return client.get(`/admin/reports/${encodeURIComponent(reportId)}`, {
    schema: reportDetailResponseSchema,
    signal,
  });
}

export function reportQueueInfiniteQueryOptions(client: ApiClient, statuses: readonly ReportStatusName[]) {
  return infiniteQueryOptions({
    queryKey: MODERATION_QUERY_KEYS.reportQueue(statuses),
    queryFn: ({ pageParam, signal }) => fetchReportQueue(client, statuses, pageParam, signal),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loadedCount = allPages.reduce((acc, p) => acc + p.items.length, 0);
      return loadedCount < lastPage.total ? loadedCount : undefined;
    },
    refetchInterval: QUEUE_REFETCH_INTERVAL_MS,
    throwOnError: throwForbidden,
  });
}

export function reportDetailQueryOptions(client: ApiClient, reportId: string) {
  return queryOptions({
    queryKey: MODERATION_QUERY_KEYS.reportDetail(reportId),
    queryFn: ({ signal }) => fetchReportDetail(client, reportId, signal),
    gcTime: 0,
    staleTime: 0,
    refetchInterval: (query) =>
      evidenceRefreshDelayMs(query.state.data, query.state.dataUpdatedAt, Date.now()),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: (query) =>
      isEvidenceRefreshDue(query.state.data, query.state.dataUpdatedAt, Date.now()),
    refetchOnReconnect: (query) =>
      isEvidenceRefreshDue(query.state.data, query.state.dataUpdatedAt, Date.now()),
    throwOnError: throwForbidden,
  });
}

export function fetchFlaggedQueue(
  client: ApiClient,
  cursor: string | null,
  limit = PAGE_LIMIT_DEFAULT,
  signal?: AbortSignal,
): Promise<FlaggedMessageQueueResponse> {
  return client.get('/admin/flagged-messages', {
    query: {
      ...(cursor ? { cursor } : {}),
      limit,
    },
    schema: flaggedMessageQueueResponseSchema,
    signal,
  });
}

export function fetchFlaggedDetail(
  client: ApiClient,
  messageId: string,
  signal?: AbortSignal,
): Promise<FlaggedMessageDetailResponse> {
  return client.get(`/admin/flagged-messages/${encodeURIComponent(messageId)}`, {
    schema: flaggedMessageDetailResponseSchema,
    signal,
  });
}

export function flaggedInfiniteQueryOptions(client: ApiClient) {
  return infiniteQueryOptions({
    queryKey: MODERATION_QUERY_KEYS.flaggedQueue,
    queryFn: ({ pageParam, signal }) => fetchFlaggedQueue(client, pageParam, PAGE_LIMIT_DEFAULT, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    throwOnError: throwForbidden,
  });
}

export function flaggedDetailQueryOptions(client: ApiClient, messageId: string) {
  return queryOptions({
    queryKey: MODERATION_QUERY_KEYS.flaggedDetail(messageId),
    queryFn: ({ signal }) => fetchFlaggedDetail(client, messageId, signal),
    gcTime: 0,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    throwOnError: throwForbidden,
  });
}

export function useStartReview(reportId: string) {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (): Promise<ReportActionResponse> =>
      client.post(`/admin/reports/${encodeURIComponent(reportId)}/start-review`, {
        schema: reportActionResponseSchema,
      }),
    onSettled: async () => {
      // Khoá `reports` là tiền tố của cả hàng chờ lẫn chi tiết: invalidate một lần để chi tiết chỉ gọi lại một lần
      // (mỗi lần gọi chi tiết BE ghi một bản audit).
      await queryClient.invalidateQueries({ queryKey: MODERATION_QUERY_KEYS.reports });
    },
  });
}

export function useResolveReport(reportId: string) {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: ResolveReportBody): Promise<ReportActionResponse> =>
      client.post(`/admin/reports/${encodeURIComponent(reportId)}/resolve`, {
        body: resolveReportBodySchema.parse(body),
        schema: reportActionResponseSchema,
      }),
    onSettled: async () => {
      // Khoá `reports` là tiền tố của cả hàng chờ lẫn chi tiết: invalidate một lần để chi tiết chỉ gọi lại một lần
      // (mỗi lần gọi chi tiết BE ghi một bản audit).
      await queryClient.invalidateQueries({ queryKey: MODERATION_QUERY_KEYS.reports });
    },
  });
}

export function useBanUser() {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ userId, body }: { userId: string; body: BanUserBody }): Promise<BanUserResponse> =>
      client.post(`/admin/users/${encodeURIComponent(userId)}/ban`, {
        body: banUserBodySchema.parse(body),
        schema: banUserResponseSchema,
      }),
    // Khoá tài khoản không đổi nội dung chi tiết báo cáo / tin gắn cờ: chỉ làm mới danh sách (chi tiết gọi lại sẽ ghi
    // thêm audit thừa).
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: MODERATION_QUERY_KEYS.reportQueues }),
        queryClient.invalidateQueries({ queryKey: MODERATION_QUERY_KEYS.flaggedQueue }),
      ]);
    },
  });
}
