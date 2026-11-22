import { isApiError, type ApiClient } from '@tamgiao/api-client';
import { useApiClient } from '@tamgiao/api-client/react';
import { PRESIGNED_URL_TTL_SECONDS } from '@tamgiao/contracts/constants';
import {
  KYC_QUEUE_DEFAULT_STATUSES,
  kycAdminDecisionResponseSchema,
  kycAdminDetailResponseSchema,
  kycMarkStepBodySchema,
  kycQueueResponseSchema,
  kycRejectBodySchema,
  kycRequestMoreInfoBodySchema,
  type KycAdminDecisionResponse,
  type KycAdminDetailResponse,
  type KycAdminStatus,
  type KycMarkStepBody,
  type KycQueueResponse,
  type KycRejectBody,
  type KycRequestMoreInfoBody,
} from '@tamgiao/contracts/verification';
import {
  infiniteQueryOptions,
  queryOptions,
  useMutation,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';

/** Số hồ sơ mỗi trang hàng chờ (BE mặc định 20, tối đa 100). */
export const KYC_QUEUE_PAGE_SIZE = 20;

/** Xin lại URL ảnh trước khi hết hạn một khoảng này (ms) để ảnh không bị vỡ giữa chừng. */
export const PRESIGNED_REFRESH_MARGIN_MS = 30_000;
/** Khoảng chờ tối thiểu giữa hai lần xin lại (ms) — tránh gọi dồn (mỗi lần xem chi tiết BE ghi audit). */
export const PRESIGNED_REFRESH_MIN_DELAY_MS = 1_000;

export interface KycQueueFilters {
  /** Trạng thái lọc; mặc định `KYC_QUEUE_DEFAULT_STATUSES`. */
  readonly statuses: readonly KycAdminStatus[];
  /** `true` = chỉ hồ sơ có cờ eKYC; `null` = không lọc. */
  readonly flagged: boolean | null;
  /** Từ khoá tên/nghề nghiệp (BE yêu cầu ≥ 2 ký tự); chuỗi rỗng = không lọc. */
  readonly q: string;
}

export const DEFAULT_KYC_QUEUE_FILTERS: KycQueueFilters = {
  statuses: KYC_QUEUE_DEFAULT_STATUSES,
  flagged: null,
  q: '',
};

export const KYC_QUERY_KEYS = {
  all: ['admin', 'kyc'] as const,
  queue: ['admin', 'kyc', 'queue'] as const,
  queueList: (filters: KycQueueFilters) => ['admin', 'kyc', 'queue', filters] as const,
  detail: (submissionId: string) => ['admin', 'kyc', 'detail', submissionId] as const,
};

function queueQueryParams(filters: KycQueueFilters, cursor: string | null) {
  const q = filters.q.trim();
  return {
    status: filters.statuses.join(','),
    flagged: filters.flagged === null ? undefined : String(filters.flagged),
    q: q.length >= 2 ? q : undefined,
    cursor: cursor ?? undefined,
    limit: KYC_QUEUE_PAGE_SIZE,
  };
}

export function fetchKycQueue(
  client: ApiClient,
  filters: KycQueueFilters,
  cursor: string | null,
  signal?: AbortSignal,
): Promise<KycQueueResponse> {
  return client.get('/admin/kyc/submissions', {
    query: queueQueryParams(filters, cursor),
    schema: kycQueueResponseSchema,
    signal,
  });
}

export function fetchKycDetail(
  client: ApiClient,
  submissionId: string,
  signal?: AbortSignal,
): Promise<KycAdminDetailResponse> {
  return client.get(`/admin/kyc/submissions/${encodeURIComponent(submissionId)}`, {
    schema: kycAdminDetailResponseSchema,
    signal,
  });
}

/** 403 ném lên route để `RouteError` hiện màn "không đủ quyền"; lỗi khác panel tự hiển thị. */
const throwForbidden = (error: Error) => isApiError(error) && error.status === 403;

/** Hàng chờ thẩm định, phân trang cursor (`nextCursor`). */
export function kycQueueQueryOptions(client: ApiClient, filters: KycQueueFilters) {
  return infiniteQueryOptions({
    queryKey: KYC_QUERY_KEYS.queueList(filters),
    queryFn: ({ pageParam, signal }) => fetchKycQueue(client, filters, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    throwOnError: throwForbidden,
  });
}

type PresignedDocument = NonNullable<KycAdminDetailResponse['documents']['cccdFront']>;

/**
 * Mốc (ms, đồng hồ máy) URL presigned hết hiệu lực. Lấy `expiresAt` BE trả, nhưng không quá
 * `PRESIGNED_URL_TTL_SECONDS` kể từ lúc nhận (chặn lệch đồng hồ máy so với server làm giữ URL quá hạn).
 * `expiresAt` đã qua theo đồng hồ máy (máy chạy nhanh) → coi như còn đủ TTL kể từ lúc nhận.
 */
export function presignedDeadlineMs(doc: PresignedDocument, fetchedAt: number): number {
  const ttlDeadline = fetchedAt + PRESIGNED_URL_TTL_SECONDS * 1000;
  const expiresAt = Date.parse(doc.expiresAt);
  if (Number.isNaN(expiresAt) || expiresAt <= fetchedAt) return ttlDeadline;
  return Math.min(expiresAt, ttlDeadline);
}

/**
 * Sau bao lâu (ms) phải xin lại chi tiết để có URL ảnh mới: trước mốc hết hạn sớm nhất
 * `PRESIGNED_REFRESH_MARGIN_MS`. `false` khi hồ sơ không còn ảnh nào (không cần xin lại).
 */
export function detailRefreshDelayMs(
  detail: KycAdminDetailResponse | undefined,
  fetchedAt: number,
  now: number,
): number | false {
  if (!detail) return false;
  const deadlines = Object.values(detail.documents)
    .filter((d): d is PresignedDocument => d !== null)
    .map((d) => presignedDeadlineMs(d, fetchedAt));
  if (deadlines.length === 0) return false;
  const delay = Math.min(...deadlines) - PRESIGNED_REFRESH_MARGIN_MS - now;
  return Math.max(delay, PRESIGNED_REFRESH_MIN_DELAY_MS);
}

/** URL ảnh đã tới (hoặc quá) mốc phải xin lại. */
export function isDetailRefreshDue(
  detail: KycAdminDetailResponse | undefined,
  fetchedAt: number,
  now: number,
): boolean {
  const delay = detailRefreshDelayMs(detail, fetchedAt, now);
  return delay !== false && delay <= PRESIGNED_REFRESH_MIN_DELAY_MS;
}

/**
 * Chi tiết hồ sơ — **chứa PII + URL presigned** (luật F5): không giữ trong cache khi rời màn (`gcTime: 0`),
 * luôn coi là cũ (`staleTime: 0`), tự xin lại trước khi URL ảnh hết hạn (`refetchInterval`). Không persist.
 */
export function kycDetailQueryOptions(client: ApiClient, submissionId: string) {
  return queryOptions({
    queryKey: KYC_QUERY_KEYS.detail(submissionId),
    queryFn: ({ signal }) => fetchKycDetail(client, submissionId, signal),
    gcTime: 0,
    staleTime: 0,
    refetchInterval: (query) => detailRefreshDelayMs(query.state.data, query.state.dataUpdatedAt, Date.now()),
    refetchIntervalInBackground: false,
    // Mỗi lần gọi chi tiết BE ghi một bản audit → quay lại tab / có mạng lại chỉ gọi lại khi URL ảnh đã tới hạn xin lại.
    refetchOnWindowFocus: (query) =>
      isDetailRefreshDue(query.state.data, query.state.dataUpdatedAt, Date.now()),
    refetchOnReconnect: (query) =>
      isDetailRefreshDue(query.state.data, query.state.dataUpdatedAt, Date.now()),
    throwOnError: throwForbidden,
  });
}

export type KycDecisionInput =
  | { readonly kind: 'assign' }
  | { readonly kind: 'markStep'; readonly body: KycMarkStepBody }
  | { readonly kind: 'approve' }
  | { readonly kind: 'reject'; readonly body: KycRejectBody }
  | { readonly kind: 'requestMoreInfo'; readonly body: KycRequestMoreInfoBody };

export type KycDecisionKind = KycDecisionInput['kind'];

export function postKycDecision(
  client: ApiClient,
  submissionId: string,
  input: KycDecisionInput,
): Promise<KycAdminDecisionResponse> {
  const base = `/admin/kyc/submissions/${encodeURIComponent(submissionId)}`;
  const schema = kycAdminDecisionResponseSchema;
  switch (input.kind) {
    case 'assign':
      return client.post(`${base}/assign`, { schema });
    case 'markStep':
      return client.post(`${base}/steps`, { body: kycMarkStepBodySchema.parse(input.body), schema });
    case 'approve':
      return client.post(`${base}/approve`, { schema });
    case 'reject':
      return client.post(`${base}/reject`, { body: kycRejectBodySchema.parse(input.body), schema });
    case 'requestMoreInfo':
      return client.post(`${base}/request-more-info`, {
        body: kycRequestMoreInfoBodySchema.parse(input.body),
        schema,
      });
  }
}

/**
 * Mã lỗi nghĩa là dữ liệu đang xem đã cũ (người khác vừa nhận / quyết định hồ sơ) → thông báo + tải lại.
 */
export const KYC_CONFLICT_CODES = ['KYC_ALREADY_DECIDED', 'KYC_INVALID_TRANSITION'] as const;

export function isKycConflictError(error: unknown): boolean {
  return isApiError(error) && (KYC_CONFLICT_CODES as readonly string[]).includes(error.code);
}

/** Ghép phản hồi quyết định vào chi tiết đang xem (giữ URL ảnh hiện có, không gọi lại chi tiết → không thêm audit). */
function mergeDecision(queryClient: QueryClient, submissionId: string, res: KycAdminDecisionResponse) {
  queryClient.setQueryData<KycAdminDetailResponse>(KYC_QUERY_KEYS.detail(submissionId), (prev) =>
    prev
      ? {
          ...prev,
          status: res.status,
          version: res.version,
          steps: res.steps,
          reviewerId: res.reviewerId,
          decidedBy: res.decidedBy,
          decidedAt: res.decidedAt,
          updatedAt: res.updatedAt,
        }
      : prev,
  );
}

/**
 * Thao tác của chuyên viên trên một hồ sơ (`assign`, `steps`, `approve`, `reject`, `request-more-info`).
 * Thành công → cập nhật chi tiết + làm mới hàng chờ. Xung đột (`KYC_CONFLICT_CODES`) → tải lại chi tiết + hàng chờ.
 */
export function useKycDecision(submissionId: string) {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: KycDecisionInput) => postKycDecision(client, submissionId, input),
    onSuccess: async (res) => {
      mergeDecision(queryClient, submissionId, res);
      await queryClient.invalidateQueries({ queryKey: KYC_QUERY_KEYS.queue });
    },
    onError: async (error) => {
      if (!isKycConflictError(error)) return;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: KYC_QUERY_KEYS.detail(submissionId) }),
        queryClient.invalidateQueries({ queryKey: KYC_QUERY_KEYS.queue }),
      ]);
    },
  });
}
