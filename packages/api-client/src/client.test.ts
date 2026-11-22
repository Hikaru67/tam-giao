import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse, delay } from 'msw';
import { z } from 'zod';
import { createApiClient } from './client.js';
import { isApiError } from './api-error.js';
import { createMemoryTokenStore } from './token-store.js';
import { TEST_API_URL, problem, authTokens, baseHandlers } from './mocks/index.js';

const server = setupServer(...baseHandlers);

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});

describe('ApiClient', () => {
  it('GET parse đúng schema thành công', async () => {
    const itemSchema = z.object({
      id: z.string(),
      title: z.string(),
    });

    server.use(
      http.get(`${TEST_API_URL}/items/1`, () => {
        return HttpResponse.json({ id: '1', title: 'Tâm Giao' });
      }),
    );

    const tokenStore = createMemoryTokenStore();
    const client = createApiClient({ baseUrl: TEST_API_URL, tokenStore });

    const result = await client.get('/items/1', { schema: itemSchema });
    expect(result).toEqual({ id: '1', title: 'Tâm Giao' });
  });

  it('Response sai schema ném lỗi RESPONSE_INVALID với status 200', async () => {
    const itemSchema = z.object({
      id: z.string(),
      count: z.number(),
    });

    server.use(
      http.get(`${TEST_API_URL}/items/invalid`, () => {
        return HttpResponse.json({ id: '1', count: 'khong-phai-so' });
      }),
    );

    const tokenStore = createMemoryTokenStore();
    const client = createApiClient({ baseUrl: TEST_API_URL, tokenStore });

    try {
      await client.get('/items/invalid', { schema: itemSchema });
      expect.fail('Phải ném lỗi RESPONSE_INVALID');
    } catch (error) {
      expect(isApiError(error)).toBe(true);
      if (isApiError(error)) {
        expect(error.code).toBe('RESPONSE_INVALID');
        expect(error.status).toBe(200);
      }
    }
  });

  it('Status 204 hoặc body rỗng trả về undefined', async () => {
    server.use(
      http.delete(`${TEST_API_URL}/items/204`, () => {
        return new HttpResponse(null, { status: 204 });
      }),
      http.get(`${TEST_API_URL}/empty`, () => {
        return new HttpResponse('', { status: 200, headers: { 'content-type': 'application/json' } });
      }),
    );

    const tokenStore = createMemoryTokenStore();
    const client = createApiClient({ baseUrl: TEST_API_URL, tokenStore });

    const res204 = await client.delete('/items/204');
    expect(res204).toBeUndefined();

    const resEmpty = await client.get('/empty');
    expect(resEmpty).toBeUndefined();
  });

  it('Query parameters loại bỏ các trường undefined và gửi đúng định dạng', async () => {
    let capturedUrl = '';

    server.use(
      http.get(`${TEST_API_URL}/search`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({ ok: true });
      }),
    );

    const tokenStore = createMemoryTokenStore();
    const client = createApiClient({ baseUrl: TEST_API_URL, tokenStore });

    await client.get('/search', {
      query: {
        keyword: 'hanoi',
        page: 1,
        active: true,
        ignored: undefined,
      },
    });

    const parsedUrl = new URL(capturedUrl);
    expect(parsedUrl.searchParams.get('keyword')).toBe('hanoi');
    expect(parsedUrl.searchParams.get('page')).toBe('1');
    expect(parsedUrl.searchParams.get('active')).toBe('true');
    expect(parsedUrl.searchParams.has('ignored')).toBe(false);
  });

  it('Phản hồi Problem JSON chuyển thành ApiError đúng code/status/traceId/meta/fieldErrors', async () => {
    server.use(
      http.post(`${TEST_API_URL}/validate`, () => {
        return problem(422, 'VALIDATION_FAILED', {
          meta: { retryAfterSeconds: 60 },
          errors: [{ path: 'phone', message: 'Số điện thoại không hợp lệ' }],
        });
      }),
    );

    const tokenStore = createMemoryTokenStore();
    const client = createApiClient({ baseUrl: TEST_API_URL, tokenStore });

    try {
      await client.post('/validate', { body: {} });
      expect.fail('Phải ném lỗi ApiError');
    } catch (error) {
      expect(isApiError(error)).toBe(true);
      if (isApiError(error)) {
        expect(error.code).toBe('VALIDATION_FAILED');
        expect(error.status).toBe(422);
        expect(error.message).toBe('VALIDATION_FAILED');
        expect(error.traceId).toBe('trace-test');
        expect(error.meta).toEqual({ retryAfterSeconds: 60 });
        expect(error.fieldErrors).toEqual([{ path: 'phone', message: 'Số điện thoại không hợp lệ' }]);
      }
    }
  });

  it('Body lỗi không phải Problem JSON chuyển thành ApiError HTTP_500', async () => {
    server.use(
      http.get(`${TEST_API_URL}/server-error`, () => {
        return new HttpResponse('<html>Internal Error</html>', {
          status: 500,
          headers: { 'content-type': 'text/html' },
        });
      }),
    );

    const tokenStore = createMemoryTokenStore();
    const client = createApiClient({ baseUrl: TEST_API_URL, tokenStore });

    try {
      await client.get('/server-error');
      expect.fail('Phải ném lỗi ApiError');
    } catch (error) {
      expect(isApiError(error)).toBe(true);
      if (isApiError(error)) {
        expect(error.code).toBe('HTTP_500');
        expect(error.status).toBe(500);
      }
    }
  });

  it('Quá thời gian chờ ném lỗi TIMEOUT với status 0', async () => {
    server.use(
      http.get(`${TEST_API_URL}/slow`, async () => {
        await delay('infinite');
        return HttpResponse.json({ ok: true });
      }),
    );

    const tokenStore = createMemoryTokenStore();
    const client = createApiClient({
      baseUrl: TEST_API_URL,
      tokenStore,
      timeoutMs: 50,
    });

    try {
      await client.get('/slow');
      expect.fail('Phải ném lỗi TIMEOUT');
    } catch (error) {
      expect(isApiError(error)).toBe(true);
      if (isApiError(error)) {
        expect(error.code).toBe('TIMEOUT');
        expect(error.status).toBe(0);
      }
    }
  });

  it('Caller tự huỷ request → ném lại lỗi huỷ gốc (không phải ApiError NETWORK_ERROR)', async () => {
    server.use(
      http.get(`${TEST_API_URL}/slow`, async () => {
        await delay('infinite');
        return HttpResponse.json({});
      }),
    );
    const client = createApiClient({ baseUrl: TEST_API_URL, tokenStore: createMemoryTokenStore() });
    const controller = new AbortController();
    const pending = client.get('/slow', { signal: controller.signal });
    controller.abort();

    const error: unknown = await pending.then(
      () => expect.fail('Phải bị huỷ'),
      (e: unknown) => e,
    );
    expect(isApiError(error)).toBe(false);
    expect(error).toMatchObject({ name: 'AbortError' });
  });

  it('Lỗi mạng ném ApiError NETWORK_ERROR với status 0', async () => {
    server.use(
      http.get(`${TEST_API_URL}/network-fail`, () => {
        return HttpResponse.error();
      }),
    );

    const tokenStore = createMemoryTokenStore();
    const client = createApiClient({ baseUrl: TEST_API_URL, tokenStore });

    try {
      await client.get('/network-fail');
      expect.fail('Phải ném lỗi NETWORK_ERROR');
    } catch (error) {
      expect(isApiError(error)).toBe(true);
      if (isApiError(error)) {
        expect(error.code).toBe('NETWORK_ERROR');
        expect(error.status).toBe(0);
      }
    }
  });

  it('5 request đồng thời nhận 401 -> refresh đúng 1 lần, cả 5 thành công sau khi gửi lại; token mới được lưu', async () => {
    let refreshCalls = 0;
    const initialTokens = authTokens({
      accessToken: 'stale-access-token',
      refreshToken: 'valid-refresh-token-fixed-length',
    });

    const refreshedTokens = authTokens({
      accessToken: 'fresh-access-token',
      refreshToken: 'new-refresh-token-fixed-length',
    });

    server.use(
      http.post(`${TEST_API_URL}/auth/refresh`, () => {
        refreshCalls++;
        return HttpResponse.json(refreshedTokens);
      }),
      http.get(`${TEST_API_URL}/protected-data`, ({ request }) => {
        const authHeader = request.headers.get('authorization');
        if (authHeader === 'Bearer fresh-access-token') {
          return HttpResponse.json({ authorized: true });
        }
        return problem(401, 'TOKEN_EXPIRED');
      }),
    );

    const tokenStore = createMemoryTokenStore();
    await tokenStore.setTokens(initialTokens);

    const client = createApiClient({ baseUrl: TEST_API_URL, tokenStore });

    // Gửi 5 request đồng thời
    const results = await Promise.all([
      client.get('/protected-data'),
      client.get('/protected-data'),
      client.get('/protected-data'),
      client.get('/protected-data'),
      client.get('/protected-data'),
    ]);

    expect(results).toHaveLength(5);
    for (const res of results) {
      expect(res).toEqual({ authorized: true });
    }

    // Xác nhận refresh đúng 1 lần
    expect(refreshCalls).toBe(1);

    // Xác nhận token mới đã được ghi vào tokenStore
    expect(await tokenStore.getAccessToken()).toBe('fresh-access-token');
    expect(await tokenStore.getRefreshToken()).toBe('new-refresh-token-fixed-length');
  });

  it('Refresh trả về 401 -> xoá token, onSignedOut gọi đúng 1 lần và ném UNAUTHENTICATED', async () => {
    let signedOutCount = 0;

    server.use(
      http.post(`${TEST_API_URL}/auth/refresh`, () => {
        return problem(401, 'REFRESH_TOKEN_INVALID');
      }),
      http.get(`${TEST_API_URL}/need-auth`, () => {
        return problem(401, 'TOKEN_EXPIRED');
      }),
    );

    const tokenStore = createMemoryTokenStore();
    await tokenStore.setTokens(authTokens());

    const client = createApiClient({
      baseUrl: TEST_API_URL,
      tokenStore,
      onSignedOut: () => {
        signedOutCount++;
      },
    });

    // 3 request đồng thời gặp 401
    const outcomes = await Promise.allSettled([
      client.get('/need-auth'),
      client.get('/need-auth'),
      client.get('/need-auth'),
    ]);

    for (const outcome of outcomes) {
      expect(outcome.status).toBe('rejected');
      if (outcome.status === 'rejected') {
        expect(isApiError(outcome.reason)).toBe(true);
        expect((outcome.reason as { code: string }).code).toBe('UNAUTHENTICATED');
        expect((outcome.reason as { status: number }).status).toBe(401);
      }
    }

    // Token đã bị xoá
    expect(await tokenStore.getAccessToken()).toBeNull();
    expect(await tokenStore.getRefreshToken()).toBeNull();

    // onSignedOut được gọi đúng 1 lần
    expect(signedOutCount).toBe(1);
  });

  it('Refresh trả về 503 -> không xoá token, ném lỗi 503', async () => {
    let signedOutCalled = false;

    server.use(
      http.post(`${TEST_API_URL}/auth/refresh`, () => {
        return problem(503, 'SERVICE_UNAVAILABLE');
      }),
      http.get(`${TEST_API_URL}/resource-503`, () => {
        return problem(401, 'TOKEN_EXPIRED');
      }),
    );

    const tokenStore = createMemoryTokenStore();
    await tokenStore.setTokens(authTokens());

    const client = createApiClient({
      baseUrl: TEST_API_URL,
      tokenStore,
      onSignedOut: () => {
        signedOutCalled = true;
      },
    });

    try {
      await client.get('/resource-503');
      expect.fail('Phải ném lỗi 503');
    } catch (error) {
      expect(isApiError(error)).toBe(true);
      if (isApiError(error)) {
        expect(error.status).toBe(503);
        expect(error.code).toBe('SERVICE_UNAVAILABLE');
      }
    }

    // Token không bị xoá
    expect(await tokenStore.getAccessToken()).not.toBeNull();
    expect(await tokenStore.getRefreshToken()).not.toBeNull();
    expect(signedOutCalled).toBe(false);
  });

  it('auth: false không gửi Authorization header', async () => {
    let capturedAuth: string | null = 'initialized';

    server.use(
      http.get(`${TEST_API_URL}/public-info`, ({ request }) => {
        capturedAuth = request.headers.get('authorization');
        return HttpResponse.json({ public: true });
      }),
    );

    const tokenStore = createMemoryTokenStore();
    await tokenStore.setTokens(authTokens());

    const client = createApiClient({ baseUrl: TEST_API_URL, tokenStore });

    const result = await client.get('/public-info', { auth: false });
    expect(result).toEqual({ public: true });
    expect(capturedAuth).toBeNull();
  });

  it('upload: POST /uploads rồi PUT lên URL với header trả về, không gửi Authorization ở PUT; PUT 403 -> UPLOAD_FAILED', async () => {
    let postUploadsAuthHeader: string | null = null;
    let putAuthHeader: string | null = 'not-null';
    let putCustomHeader: string | null = null;
    let putBodyContent: string | null = null;

    const storageUrl = 'http://storage.mock.test/upload/photo.jpg';

    server.use(
      http.post(`${TEST_API_URL}/uploads`, ({ request }) => {
        postUploadsAuthHeader = request.headers.get('authorization');
        return HttpResponse.json({
          uploadId: '00000000-0000-7000-8000-000000000010',
          key: 'profiles/photo-10.jpg',
          url: storageUrl,
          method: 'PUT',
          headers: {
            'x-custom-signature': 'sig-12345',
          },
          expiresAt: '2026-12-31T23:59:59.000Z',
        });
      }),
      http.put(storageUrl, async ({ request }) => {
        putAuthHeader = request.headers.get('authorization');
        putCustomHeader = request.headers.get('x-custom-signature');
        putBodyContent = await request.text();
        return new HttpResponse(null, { status: 200 });
      }),
    );

    const tokenStore = createMemoryTokenStore();
    await tokenStore.setTokens(authTokens({ accessToken: 'user-access-token' }));

    const client = createApiClient({ baseUrl: TEST_API_URL, tokenStore });

    const uploadPayload = new TextEncoder().encode('fake-image-bytes');
    const uploadResult = await client.upload({
      purpose: 'profile_photo',
      contentType: 'image/jpeg',
      body: uploadPayload,
      sizeBytes: uploadPayload.byteLength,
    });

    expect(uploadResult).toEqual({
      key: 'profiles/photo-10.jpg',
      uploadId: '00000000-0000-7000-8000-000000000010',
    });

    // POST /uploads có gửi token
    expect(postUploadsAuthHeader).toBe('Bearer user-access-token');

    // PUT lên storage KHÔNG gửi token
    expect(putAuthHeader).toBeNull();
    // PUT mang header được cấp từ server
    expect(putCustomHeader).toBe('sig-12345');
    expect(putBodyContent).toBe('fake-image-bytes');

    // Kiểm thử trường hợp PUT 403 -> ném lỗi UPLOAD_FAILED
    server.use(
      http.put(storageUrl, () => {
        return new HttpResponse(null, { status: 403 });
      }),
    );

    try {
      await client.upload({
        purpose: 'profile_photo',
        contentType: 'image/jpeg',
        body: uploadPayload,
        sizeBytes: uploadPayload.byteLength,
      });
      expect.fail('Phải ném lỗi UPLOAD_FAILED');
    } catch (error) {
      expect(isApiError(error)).toBe(true);
      if (isApiError(error)) {
        expect(error.code).toBe('UPLOAD_FAILED');
        expect(error.status).toBe(403);
      }
    }
  });
});
