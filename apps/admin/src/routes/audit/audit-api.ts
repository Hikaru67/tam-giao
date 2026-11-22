import type { ApiClient } from '@tamgiao/api-client';
import { PAGE_LIMIT_DEFAULT } from '@tamgiao/contracts/http';
import { auditLogListResponseSchema, type AuditLogListResponse } from '@tamgiao/contracts/identity';
import { infiniteQueryOptions } from '@tanstack/react-query';
import type { AuditSearch } from './audit-search';

export const AUDIT_LOGS_QUERY_KEY = ['admin', 'audit-logs'] as const;

/** Số bản ghi mỗi lần "tải thêm". */
export const AUDIT_PAGE_LIMIT = PAGE_LIMIT_DEFAULT;

/** `GET /admin/audit-logs` (permission `audit:read`) — lọc actor/target/thời gian, phân trang cursor. */
export function fetchAuditLogs(
  client: ApiClient,
  filter: AuditSearch,
  cursor: string | undefined,
  signal?: AbortSignal,
): Promise<AuditLogListResponse> {
  return client.get('/admin/audit-logs', {
    query: { ...filter, cursor, limit: AUDIT_PAGE_LIMIT },
    schema: auditLogListResponseSchema,
    signal,
  });
}

export function auditLogsInfiniteQueryOptions(client: ApiClient, filter: AuditSearch) {
  return infiniteQueryOptions({
    queryKey: [...AUDIT_LOGS_QUERY_KEY, filter] as const,
    queryFn: ({ pageParam, signal }) => fetchAuditLogs(client, filter, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    retry: false,
  });
}
