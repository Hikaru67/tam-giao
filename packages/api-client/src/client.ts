import type { z } from 'zod';
import { problemSchema } from '@tamgiao/contracts/http';
import { authTokensSchema, type AuthTokens } from '@tamgiao/contracts/identity';
import { createUploadResponseSchema, type UploadPurposeDto } from '@tamgiao/contracts/uploads';
import { ApiError, isApiError } from './api-error.js';
import type { TokenStore } from './token-store.js';

export interface ApiClientOptions {
  /** Địa chỉ gốc của API, vd http://localhost:3000 (tự động chuẩn hoá loại bỏ '/' ở cuối). */
  baseUrl: string;
  /** Adapter lưu trữ token phiên đăng nhập. */
  tokenStore: TokenStore;
  /** Hàm fetch tuỳ biến, mặc định sử dụng globalThis.fetch (đọc lúc thực thi request). */
  fetch?: typeof fetch | undefined;
  /** Thời gian chờ tối đa cho mỗi request (mili-giây), mặc định 15_000. */
  timeoutMs?: number | undefined;
  /** Hàm tạo request ID duy nhất cho header x-request-id. */
  createRequestId?: (() => string) | undefined;
  /** Hàm callback kích hoạt khi phiên đăng nhập hết hạn hoặc bị thu hồi và cần đăng xuất. */
  onSignedOut?: (() => void) | undefined;
}

export interface RequestOptions<S extends z.ZodType | undefined = undefined> {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined> | undefined;
  /** Zod schema kiểm tra và suy luận kiểu phản hồi trả về từ API. */
  schema?: S | undefined;
  /** Tự động gửi Bearer token và làm mới khi gặp 401. Mặc định là true. */
  auth?: boolean | undefined;
  signal?: AbortSignal | undefined;
  headers?: Record<string, string> | undefined;
}

export interface ApiClient {
  request<S extends z.ZodType | undefined = undefined>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    options?: RequestOptions<S> | undefined,
  ): Promise<S extends z.ZodType ? z.infer<S> : unknown>;

  get<S extends z.ZodType | undefined = undefined>(
    path: string,
    options?: RequestOptions<S> | undefined,
  ): Promise<S extends z.ZodType ? z.infer<S> : unknown>;

  post<S extends z.ZodType | undefined = undefined>(
    path: string,
    options?: RequestOptions<S> | undefined,
  ): Promise<S extends z.ZodType ? z.infer<S> : unknown>;

  put<S extends z.ZodType | undefined = undefined>(
    path: string,
    options?: RequestOptions<S> | undefined,
  ): Promise<S extends z.ZodType ? z.infer<S> : unknown>;

  patch<S extends z.ZodType | undefined = undefined>(
    path: string,
    options?: RequestOptions<S> | undefined,
  ): Promise<S extends z.ZodType ? z.infer<S> : unknown>;

  delete<S extends z.ZodType | undefined = undefined>(
    path: string,
    options?: RequestOptions<S> | undefined,
  ): Promise<S extends z.ZodType ? z.infer<S> : unknown>;

  /**
   * Tải tệp lên hệ thống lưu trữ qua presigned URL.
   * Gọi POST /uploads để nhận presigned URL và headers, sau đó gửi PUT trực tiếp lên storage không kèm Authorization.
   */
  upload(input: {
    purpose: UploadPurposeDto;
    contentType: string;
    body: Blob | ArrayBuffer | Uint8Array;
    sizeBytes: number;
    signal?: AbortSignal | undefined;
  }): Promise<{ key: string; uploadId: string }>;
}

/**
 * Sinh mã định danh request ngẫu nhiên khi môi trường không có crypto.randomUUID.
 */
function defaultCreateRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const part1 = Math.random().toString(16).slice(2);
  const part2 = Math.random().toString(16).slice(2);
  return `${part1}${part2}`;
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const normalizedBaseUrl = options.baseUrl.replace(/\/+$/, '');
  let refreshPromise: Promise<AuthTokens> | null = null;

  async function executeRefreshSingleFlight(): Promise<AuthTokens> {
    const refreshToken = await options.tokenStore.getRefreshToken();
    if (!refreshToken) {
      await options.tokenStore.clear();
      options.onSignedOut?.();
      throw new ApiError({
        code: 'UNAUTHENTICATED',
        status: 401,
        message: 'Phiên đăng nhập không có token làm mới',
      });
    }

    try {
      // Gọi POST /auth/refresh với auth: false, xác thực bằng authTokensSchema
      const tokens = await executeRequest<typeof authTokensSchema>(
        'POST',
        '/auth/refresh',
        {
          body: { refreshToken },
          schema: authTokensSchema,
          auth: false,
        },
        false,
      );
      await options.tokenStore.setTokens(tokens);
      return tokens;
    } catch (refreshError) {
      if (isApiError(refreshError)) {
        // Lỗi 4xx khi refresh (token hết hạn, không hợp lệ, thu hồi...) -> xoá token và đăng xuất
        if (refreshError.status >= 400 && refreshError.status < 500) {
          await options.tokenStore.clear();
          options.onSignedOut?.();
          throw new ApiError({
            code: 'UNAUTHENTICATED',
            status: 401,
            message: 'Phiên làm mới không hợp lệ hoặc đã hết hạn',
          });
        }
        // Lỗi mạng, quá thời gian hoặc lỗi phía máy chủ 5xx -> giữ lại token
        throw refreshError;
      }
      throw refreshError;
    }
  }

  function getOrStartRefresh(): Promise<AuthTokens> {
    if (!refreshPromise) {
      refreshPromise = executeRefreshSingleFlight().finally(() => {
        refreshPromise = null;
      });
    }
    return refreshPromise;
  }

  async function executeRequest<S extends z.ZodType | undefined = undefined>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    requestOptions?: RequestOptions<S> | undefined,
    isRetry = false,
  ): Promise<S extends z.ZodType ? z.infer<S> : unknown> {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    let fullUrl = `${normalizedBaseUrl}${normalizedPath}`;

    // Xử lý query params, bỏ qua các giá trị undefined
    if (requestOptions?.query) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(requestOptions.query)) {
        if (value !== undefined) {
          searchParams.append(key, String(value));
        }
      }
      const queryString = searchParams.toString();
      if (queryString) {
        fullUrl += (fullUrl.includes('?') ? '&' : '?') + queryString;
      }
    }

    const requestId = options.createRequestId ? options.createRequestId() : defaultCreateRequestId();
    const headers: Record<string, string> = {
      accept: 'application/json',
      'x-request-id': requestId,
      ...(requestOptions?.headers ?? {}),
    };

    const hasBody = requestOptions?.body !== undefined && method !== 'GET';

    if (hasBody) {
      const hasContentType = Object.keys(headers).some((key) => key.toLowerCase() === 'content-type');
      if (!hasContentType) {
        headers['content-type'] = 'application/json';
      }
    }

    const shouldAuth = requestOptions?.auth !== false;
    let sentAccessToken: string | null = null;
    if (shouldAuth) {
      const hasAuthHeader = Object.keys(headers).some((key) => key.toLowerCase() === 'authorization');
      if (!hasAuthHeader) {
        sentAccessToken = await options.tokenStore.getAccessToken();
        if (sentAccessToken) {
          headers['authorization'] = `Bearer ${sentAccessToken}`;
        }
      }
    }

    const fetchFn = options.fetch ?? globalThis.fetch;
    const timeoutMs = options.timeoutMs ?? 15_000;
    const abortController = new AbortController();
    let isTimedOut = false;

    const timeoutTimer = setTimeout(() => {
      isTimedOut = true;
      abortController.abort();
    }, timeoutMs);

    const callerSignal = requestOptions?.signal;
    const onCallerAbort = () => {
      abortController.abort();
    };

    if (callerSignal) {
      if (callerSignal.aborted) {
        abortController.abort();
      } else {
        callerSignal.addEventListener('abort', onCallerAbort);
      }
    }

    let response: Response;
    try {
      response = await fetchFn(fullUrl, {
        method,
        headers,
        body: hasBody ? JSON.stringify(requestOptions?.body) : null,
        signal: abortController.signal,
      });
    } catch (fetchError) {
      if (isTimedOut) {
        throw new ApiError({
          code: 'TIMEOUT',
          status: 0,
          message: 'Quá thời gian chờ phản hồi từ máy chủ',
        });
      }
      if (isApiError(fetchError)) {
        throw fetchError;
      }
      // Caller tự huỷ (vd TanStack Query huỷ query cũ) → ném lại lỗi huỷ gốc, không báo "lỗi mạng" giả.
      if (callerSignal?.aborted) {
        throw fetchError;
      }
      throw new ApiError({
        code: 'NETWORK_ERROR',
        status: 0,
        message: 'Lỗi kết nối mạng',
      });
    } finally {
      clearTimeout(timeoutTimer);
      callerSignal?.removeEventListener('abort', onCallerAbort);
    }

    // Xử lý mã trạng thái 401 đối với request có bật xác thực
    if (response.status === 401 && shouldAuth) {
      if (isRetry) {
        await options.tokenStore.clear();
        options.onSignedOut?.();
        throw new ApiError({
          code: 'UNAUTHENTICATED',
          status: 401,
          message: 'Phiên đăng nhập đã hết hạn',
        });
      }

      // Nếu đang có luồng refresh chạy đồng thời, cùng chờ promise đó
      if (refreshPromise) {
        await refreshPromise;
        return executeRequest<S>(method, path, requestOptions, true);
      }

      // Kiểm tra nếu token trong kho đã được làm mới bởi một request khác vừa hoàn thành
      const currentToken = await options.tokenStore.getAccessToken();
      if (currentToken && sentAccessToken && currentToken !== sentAccessToken) {
        return executeRequest<S>(method, path, requestOptions, true);
      }

      await getOrStartRefresh();
      return executeRequest<S>(method, path, requestOptions, true);
    }

    // Xử lý các mã phản hồi lỗi (không thuộc dải 2xx)
    if (!response.ok) {
      let errorBody: unknown;
      try {
        const errorText = await response.text();
        errorBody = errorText ? JSON.parse(errorText) : undefined;
      } catch {
        errorBody = undefined;
      }

      const parsedProblem = problemSchema.safeParse(errorBody);
      if (parsedProblem.success) {
        const problemData = parsedProblem.data;
        throw new ApiError({
          code: problemData.code,
          status: problemData.status,
          message: problemData.title,
          traceId: problemData.traceId,
          meta: problemData.meta,
          fieldErrors: problemData.errors,
        });
      }

      throw new ApiError({
        code: `HTTP_${response.status}`,
        status: response.status,
        message: `Máy chủ phản hồi với mã lỗi ${response.status}`,
      });
    }

    // Phản hồi 204 No Content hoặc phản hồi rỗng
    if (response.status === 204) {
      return undefined as S extends z.ZodType ? z.infer<S> : unknown;
    }

    const responseText = await response.text();
    if (responseText.trim().length === 0) {
      return undefined as S extends z.ZodType ? z.infer<S> : unknown;
    }

    let responseJson: unknown;
    try {
      responseJson = JSON.parse(responseText);
    } catch {
      throw new ApiError({
        code: 'RESPONSE_INVALID',
        status: response.status,
        message: 'Dữ liệu phản hồi không phải JSON hợp lệ',
      });
    }

    if (requestOptions?.schema) {
      const parsed = requestOptions.schema.safeParse(responseJson);
      if (!parsed.success) {
        throw new ApiError({
          code: 'RESPONSE_INVALID',
          status: response.status,
          message: 'Dữ liệu phản hồi không khớp schema mong đợi',
        });
      }
      return parsed.data as S extends z.ZodType ? z.infer<S> : unknown;
    }

    return responseJson as S extends z.ZodType ? z.infer<S> : unknown;
  }

  async function upload(input: {
    purpose: UploadPurposeDto;
    contentType: string;
    body: Blob | ArrayBuffer | Uint8Array;
    sizeBytes: number;
    signal?: AbortSignal | undefined;
  }): Promise<{ key: string; uploadId: string }> {
    const uploadMeta = await executeRequest<typeof createUploadResponseSchema>(
      'POST',
      '/uploads',
      {
        body: {
          purpose: input.purpose,
          contentType: input.contentType,
          sizeBytes: input.sizeBytes,
        },
        schema: createUploadResponseSchema,
        signal: input.signal,
      },
      false,
    );

    const fetchFn = options.fetch ?? globalThis.fetch;
    let putResponse: Response;
    try {
      putResponse = await fetchFn(uploadMeta.url, {
        method: 'PUT',
        headers: uploadMeta.headers,
        // Kiểu DOM `BodyInit` chỉ nhận Uint8Array dựa trên ArrayBuffer → chép sang bản mới.
        body: input.body instanceof Uint8Array ? new Uint8Array(input.body) : input.body,
        signal: input.signal ?? null,
      });
    } catch (putError) {
      if (isApiError(putError)) {
        throw putError;
      }
      throw new ApiError({
        code: 'NETWORK_ERROR',
        status: 0,
        message: 'Lỗi kết nối khi tải tệp lên máy chủ lưu trữ',
      });
    }

    if (!putResponse.ok) {
      throw new ApiError({
        code: 'UPLOAD_FAILED',
        status: putResponse.status,
        message: 'Quá trình tải tệp lên máy chủ lưu trữ thất bại',
      });
    }

    return {
      key: uploadMeta.key,
      uploadId: uploadMeta.uploadId,
    };
  }

  return {
    request: (method, path, requestOptions) => executeRequest(method, path, requestOptions),
    get: (path, requestOptions) => executeRequest('GET', path, requestOptions),
    post: (path, requestOptions) => executeRequest('POST', path, requestOptions),
    put: (path, requestOptions) => executeRequest('PUT', path, requestOptions),
    patch: (path, requestOptions) => executeRequest('PATCH', path, requestOptions),
    delete: (path, requestOptions) => executeRequest('DELETE', path, requestOptions),
    upload,
  };
}
