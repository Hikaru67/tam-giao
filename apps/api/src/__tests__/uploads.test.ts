import { createLogger } from '@tamgiao/config';
import { createUploadResponseSchema, problemSchema } from '@tamgiao/contracts';
import { FakeClock, newId, ok, type ObjectStorage, type UnitOfWork } from '@tamgiao/kernel';
import { UPLOAD_MAX_BYTES, UploadService, type RequestUploadInput } from '@tamgiao/db';
import { createMiddleware } from 'hono/factory';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { createUploadRoutes } from '../http/uploads.js';
import type { AppEnv } from '@tamgiao/http';

const userId = newId<'User'>();

/** Storage/UoW giả: đếm số lần được gọi để chứng minh request sai bị chặn TRƯỚC khi cấp URL (AC2). */
function setup() {
  const calls = { presign: 0, uow: 0 };
  const storage: ObjectStorage = {
    presignPut: async (i) => {
      calls.presign++;
      return {
        url: `https://storage.test/${i.key}?sig=x`,
        method: 'PUT',
        headers: { 'content-type': i.contentType },
        expiresAt: new Date('2026-11-18T00:05:00.000Z'),
      };
    },
    presignGet: async () => {
      throw new Error('not used');
    },
    head: async () => null,
    delete: async () => undefined,
  };
  // Không có DB ở test unit: UoW giả bỏ qua bước ghi `platform.uploads` (đã có test tích hợp).
  const uow = {
    run: async () => {
      calls.uow++;
      return ok();
    },
  } as unknown as UnitOfWork;
  const uploads = new UploadService({ uow, clock: new FakeClock(), storage, putTtlSeconds: 300 });
  const recorded: RequestUploadInput[] = [];
  const service = {
    requestUpload: async (input: RequestUploadInput) => {
      recorded.push(input);
      return uploads.requestUpload(input);
    },
  };
  const requireUser = createMiddleware<AppEnv>(async (c, next) => {
    if (c.req.header('authorization') !== 'Bearer ok') return c.json({ code: 'UNAUTHENTICATED' }, 401);
    c.set('auth', { userId, sessionId: newId() });
    return next();
  });
  const app = createApp({
    logger: createLogger({ service: 'api', level: 'silent', destination: { write: () => undefined } }),
    modules: [{ name: 'uploads', routes: createUploadRoutes({ uploads: service, requireUser }) }],
    readinessChecks: [],
    corsOrigins: [],
    bodyLimitBytes: 1_048_576,
  });
  const post = (body: unknown, auth = 'Bearer ok') =>
    app.request('/uploads', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: auth },
      body: JSON.stringify(body),
    });
  return { post, calls, recorded };
}

describe('POST /uploads', () => {
  it('requires a logged-in user', async () => {
    const { post, calls } = setup();
    expect(
      (await post({ purpose: 'profile_photo', contentType: 'image/jpeg', sizeBytes: 10 }, '')).status,
    ).toBe(401);
    expect(calls.presign).toBe(0);
  });

  it.each([
    [{ purpose: 'profile_photo', contentType: 'application/pdf', sizeBytes: 10 }, 'CONTENT_TYPE_NOT_ALLOWED'],
    [{ purpose: 'profile_photo', contentType: 'image/gif', sizeBytes: 10 }, 'CONTENT_TYPE_NOT_ALLOWED'],
    [{ purpose: 'kyc_doc', contentType: 'image/png', sizeBytes: UPLOAD_MAX_BYTES + 1 }, 'SIZE_OUT_OF_RANGE'],
  ])('wrong mime/size → 422 UPLOAD_INVALID before any URL is issued (AC2) %o', async (body, reason) => {
    const { post, calls } = setup();
    const res = await post(body);
    expect(res.status).toBe(422);
    const problem = problemSchema.parse(await res.json());
    expect(problem.code).toBe('UPLOAD_INVALID');
    expect(problem.meta).toMatchObject({ reason });
    expect(calls).toEqual({ presign: 0, uow: 0 });
  });

  it.each([
    { purpose: 'avatar', contentType: 'image/png', sizeBytes: 10 },
    { purpose: 'profile_photo', contentType: 'image/png', sizeBytes: 0 },
    { purpose: 'profile_photo', contentType: 'image/png', sizeBytes: 1.5 },
    { purpose: 'profile_photo', contentType: 'image/png' },
  ])('malformed body → 422 VALIDATION_FAILED %o', async (body) => {
    const { post, calls } = setup();
    const res = await post(body);
    expect(res.status).toBe(422);
    expect(problemSchema.parse(await res.json()).code).toBe('VALIDATION_FAILED');
    expect(calls.presign).toBe(0);
  });

  it('valid request → 201 with presigned PUT bound to the caller; key has no client file name', async () => {
    const { post, recorded } = setup();
    const res = await post({ purpose: 'kyc_selfie', contentType: 'IMAGE/HEIC', sizeBytes: 2_000_000 });
    expect(res.status).toBe(201);
    const body = createUploadResponseSchema.parse(await res.json());
    expect(body.method).toBe('PUT');
    expect(body.key).toMatch(new RegExp(`^kyc_selfie/${userId}/[0-9a-f-]{36}\\.heic$`));
    expect(body.headers).toEqual({ 'content-type': 'image/heic' });
    expect(recorded[0]).toMatchObject({ ownerId: userId, contentType: 'image/heic' });
  });
});
