import { newId } from '@tamgiao/kernel';
import { createMiddleware } from 'hono/factory';
import type { Logger } from '../logger.js';

/** Biến gắn vào context của mỗi request. */
export interface AppEnv {
  Variables: {
    traceId: string;
    logger: Logger;
  };
}

const TRACE_HEADER = 'x-request-id';
/** Chỉ nhận trace id từ client nếu đúng định dạng an toàn (tránh log injection). */
const SAFE_TRACE_ID = /^[A-Za-z0-9._-]{8,128}$/;

/** Gắn trace id (nhận từ header hoặc tự sinh), logger con theo request, và log 1 dòng khi request kết thúc. */
export const requestContext = (logger: Logger) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const incoming = c.req.header(TRACE_HEADER);
    const traceId = incoming && SAFE_TRACE_ID.test(incoming) ? incoming : newId<'Trace'>();
    const requestLogger = logger.child({ traceId });
    c.set('traceId', traceId);
    c.set('logger', requestLogger);
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
