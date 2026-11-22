/**
 * Danh sách mã lỗi chuẩn từ phía client.
 * Bao gồm lỗi mạng, quá thời gian chờ, dữ liệu trả về sai schema, hết hạn phiên và lỗi tải tệp lên.
 */
export const CLIENT_ERROR_CODES = [
  'NETWORK_ERROR',
  'TIMEOUT',
  'RESPONSE_INVALID',
  'UNAUTHENTICATED',
  'UPLOAD_FAILED',
] as const;

export type ClientErrorCode = (typeof CLIENT_ERROR_CODES)[number];

export interface ApiErrorInit {
  code: string;
  status: number;
  message: string;
  traceId?: string | undefined;
  meta?: Readonly<Record<string, unknown>> | undefined;
  fieldErrors?: readonly { path: string; message: string }[] | undefined;
}

/**
 * Lớp lỗi thống nhất cho toàn bộ lời gọi API qua ApiClient.
 * Status = 0 cho lỗi client (mạng/timeout).
 * Không đưa nội dung body request/response vào message để tránh rò rỉ dữ liệu cá nhân (PII).
 */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly traceId: string | undefined;
  readonly meta: Readonly<Record<string, unknown>> | undefined;
  readonly fieldErrors: readonly { path: string; message: string }[];

  constructor(init: ApiErrorInit) {
    super(init.message);
    this.name = 'ApiError';
    this.code = init.code;
    this.status = init.status;
    this.traceId = init.traceId;
    this.meta = init.meta;
    this.fieldErrors = init.fieldErrors ?? [];
  }
}

/**
 * Thu hẹp kiểu kiểm tra một lỗi có phải là đối tượng ApiError hay không.
 */
export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}
