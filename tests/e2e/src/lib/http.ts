/**
 * HTTP client mỏng cho e2e/seed (BE-S7-09) — chỉ dùng `fetch` của Node, không phụ thuộc code ứng dụng, để chạy được
 * nguyên vẹn trên staging. Không log body/headers (có SĐT, OTP, token — AGENTS.md mục 5).
 */
export class HttpError extends Error {
  constructor(
    readonly method: string,
    readonly path: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`${method} ${path} → ${status} ${problemCode(body)}`);
    this.name = 'HttpError';
  }
}

/** Lấy `code` của problem+json (nếu có) để báo lỗi mà không in cả body. */
export function problemCode(body: unknown): string {
  if (typeof body === 'object' && body !== null && 'code' in body) return String(body.code);
  return '';
}

export interface RequestOptions {
  readonly body?: unknown;
  readonly token?: string | undefined;
  readonly headers?: Readonly<Record<string, string>>;
  /** Status chấp nhận; mặc định mọi 2xx. */
  readonly expect?: number | readonly number[];
}

export interface ApiResponse<T> {
  readonly status: number;
  readonly body: T;
}

export class ApiClient {
  readonly baseUrl: string;

  constructor(
    baseUrl: string,
    /** Header gắn vào mọi request của client này (vd `x-forwarded-for` riêng mỗi người dùng ảo). */
    private readonly defaultHeaders: Readonly<Record<string, string>> = {},
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  withHeaders(headers: Readonly<Record<string, string>>): ApiClient {
    return new ApiClient(this.baseUrl, { ...this.defaultHeaders, ...headers });
  }

  async request<T = unknown>(
    method: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = { ...this.defaultHeaders, ...options.headers };
    if (options.token !== undefined) headers.authorization = `Bearer ${options.token}`;
    let payload: string | undefined;
    if (options.body !== undefined) {
      headers['content-type'] ??= 'application/json';
      payload = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    }
    const res = await fetch(`${this.baseUrl}${path}`, { method, headers, body: payload ?? null });
    const text = await res.text();
    let body: unknown = text;
    if (text.length > 0 && (res.headers.get('content-type') ?? '').includes('json')) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    const expected = options.expect;
    const accepted =
      expected === undefined
        ? res.status >= 200 && res.status < 300
        : (typeof expected === 'number' ? [expected] : expected).includes(res.status);
    if (!accepted) throw new HttpError(method, path, res.status, body);
    return { status: res.status, body: body as T };
  }

  get<T = unknown>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('GET', path, options).then((r) => r.body);
  }

  post<T = unknown>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('POST', path, { ...options, body: body ?? {} }).then((r) => r.body);
  }

  put<T = unknown>(path: string, body: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('PUT', path, { ...options, body }).then((r) => r.body);
  }
}

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Thăm dò tới khi `probe` trả giá trị khác `undefined` (dùng cho bước chờ worker xử lý event qua outbox).
 * Hết `timeoutMs` → throw kèm `label`.
 */
export async function waitFor<T>(
  label: string,
  probe: () => Promise<T | undefined>,
  { timeoutMs = 30_000, intervalMs = 500 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<{ value: T; elapsedMs: number }> {
  const startedAt = Date.now();
  let lastError: unknown;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = await probe();
      if (value !== undefined) return { value, elapsedMs: Date.now() - startedAt };
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  const reason = lastError instanceof Error ? ` (lỗi cuối: ${lastError.message})` : '';
  throw new Error(`hết thời gian chờ: ${label}${reason}`);
}
