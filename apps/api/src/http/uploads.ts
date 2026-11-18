import { createUploadBodySchema, type CreateUploadResponse } from '@tamgiao/contracts';
import type { UploadService } from '@tamgiao/db';
import { parseBody, sendResult, type AppEnv } from '@tamgiao/http';
import { Hono, type MiddlewareHandler } from 'hono';

export interface UploadRoutesDeps {
  readonly uploads: Pick<UploadService, 'requestUpload'>;
  readonly requireUser: MiddlewareHandler<AppEnv>;
}

/**
 * `POST /uploads` (BE-S2-07): cấp presigned PUT để app tải ảnh thẳng lên storage, không đi qua API.
 * Sau khi tải xong, app gửi `key` cho API nghiệp vụ; module đó xác nhận quyền sở hữu qua `UploadRegistry`.
 */
export function createUploadRoutes(deps: UploadRoutesDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.post('/uploads', deps.requireUser, async (c) => {
    const body = await parseBody(c, createUploadBodySchema);
    if (body.isErr()) return body.error;
    const result = await deps.uploads.requestUpload({ ownerId: c.get('auth').userId, ...body.value });
    return sendResult(
      c,
      result.map((t): CreateUploadResponse => ({
        uploadId: t.uploadId,
        key: t.key,
        url: t.url,
        method: t.method,
        headers: { ...t.headers },
        expiresAt: t.expiresAt.toISOString(),
      })),
      201,
    );
  });

  return routes;
}
