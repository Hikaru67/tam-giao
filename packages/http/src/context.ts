import type { Logger } from '@tamgiao/config';
import { newId } from '@tamgiao/kernel';
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';

/** Người dùng app đã xác thực (gắn bởi `requireUser`). */
export interface UserAuth {
  readonly userId: string;
  readonly sessionId: string;
}

/** Cán bộ quản trị đã xác thực (gắn bởi `requireAdmin`). */
export interface AdminAuth {
  readonly adminId: string;
  readonly sessionId: string;
  readonly role: string;
  readonly permissions: readonly string[];
}

/** Biến gắn vào context của mỗi request. `auth`/`admin` chỉ có sau middleware tương ứng. */
export interface AppEnv {
  Variables: {
    traceId: string;
    logger: Logger;
    /** IP client (dùng cho rate limit, audit). `unknown` khi không xác định được. */
    clientIp: string;
    auth: UserAuth;
    admin: AdminAuth;
  };
}

export interface RequestContextOptions {
  /**
   * API đứng sau reverse proxy tin cậy → lấy IP từ phần tử **cuối** của `x-forwarded-for` (do proxy của ta ghi).
   * Mặc định false: bỏ qua header (client tự đặt được) và dùng địa chỉ socket.
   */
  readonly trustProxy?: boolean;
}

const TRACE_HEADER = 'x-request-id';
/** Chỉ nhận trace id từ client nếu đúng định dạng an toàn (tránh log injection). */
const SAFE_TRACE_ID = /^[A-Za-z0-9._-]{8,128}$/;
const SAFE_IP = /^[0-9A-Fa-f:.]{2,45}$/;

function resolveClientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = c.req.header('x-forwarded-for')?.split(',').at(-1)?.trim();
    if (forwarded && SAFE_IP.test(forwarded)) return forwarded;
  }
  // @hono/node-server gắn request gốc của Node vào `c.env.incoming`; test bằng `app.request()` thì không có.
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
  return env?.incoming?.socket?.remoteAddress ?? 'unknown';
}

/** Gắn trace id (nhận từ header hoặc tự sinh), IP client, logger con theo request, và log 1 dòng khi request kết thúc. */
export const requestContext = (logger: Logger, options: RequestContextOptions = {}) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const incoming = c.req.header(TRACE_HEADER);
    const traceId = incoming && SAFE_TRACE_ID.test(incoming) ? incoming : newId<'Trace'>();
    const requestLogger = logger.child({ traceId });
    c.set('traceId', traceId);
    c.set('logger', requestLogger);
    c.set('clientIp', resolveClientIp(c, options.trustProxy ?? false));
    c.header(TRACE_HEADER, traceId);

    const startedAt = performance.now();
    await next();
    requestLogger.info(
      {
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs: Math.round(performance.now() - startedAt),
      },
      'request completed',
    );
  });
