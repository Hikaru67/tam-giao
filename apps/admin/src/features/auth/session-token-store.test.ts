import { describe, it, expect } from 'vitest';
import { authTokens } from '@tamgiao/api-client/mocks';
import {
  createAdminTokenStore,
  ADMIN_TOKEN_STORAGE_KEY,
  type SessionStorageLike,
} from './session-token-store';

function createMockStorage(initial?: Record<string, string>): SessionStorageLike & {
  map: Map<string, string>;
} {
  const map = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

describe('session-token-store', () => {
  it('lưu/đọc/xoá với storage giả (Map)', async () => {
    const storage = createMockStorage();
    const store = createAdminTokenStore(storage);

    expect(await store.getAccessToken()).toBeNull();

    await store.setAdminToken('test-admin-token');
    expect(await store.getAccessToken()).toBe('test-admin-token');
    expect(storage.map.get(ADMIN_TOKEN_STORAGE_KEY)).toBe('test-admin-token');

    await store.setTokens(authTokens({ accessToken: 'new-access-token' }));
    expect(await store.getAccessToken()).toBe('new-access-token');
    expect(storage.map.get(ADMIN_TOKEN_STORAGE_KEY)).toBe('new-access-token');

    await store.clear();
    expect(await store.getAccessToken()).toBeNull();
    expect(storage.map.has(ADMIN_TOKEN_STORAGE_KEY)).toBe(false);
  });

  it('khởi tạo đọc lại token đã lưu (tải lại trang)', async () => {
    const storage = createMockStorage({ [ADMIN_TOKEN_STORAGE_KEY]: 'persisted-token' });
    const store = createAdminTokenStore(storage);

    expect(await store.getAccessToken()).toBe('persisted-token');
  });

  it('getRefreshToken luôn null', async () => {
    const storage = createMockStorage();
    const store = createAdminTokenStore(storage);

    expect(await store.getRefreshToken()).toBeNull();
    await store.setAdminToken('some-token');
    expect(await store.getRefreshToken()).toBeNull();
  });

  it('storage ném lỗi ở mọi method vẫn hoạt động bằng bộ nhớ', async () => {
    const throwingStorage: SessionStorageLike = {
      getItem: () => {
        throw new Error('Storage disabled');
      },
      setItem: () => {
        throw new Error('QuotaExceeded');
      },
      removeItem: () => {
        throw new Error('AccessDenied');
      },
    };

    const store = createAdminTokenStore(throwingStorage);
    expect(await store.getAccessToken()).toBeNull();

    await store.setAdminToken('fallback-memory-token');
    expect(await store.getAccessToken()).toBe('fallback-memory-token');

    await store.clear();
    expect(await store.getAccessToken()).toBeNull();
  });

  it('storage null hoạt động', async () => {
    const store = createAdminTokenStore(null);
    expect(await store.getAccessToken()).toBeNull();

    await store.setAdminToken('memory-only-token');
    expect(await store.getAccessToken()).toBe('memory-only-token');

    await store.clear();
    expect(await store.getAccessToken()).toBeNull();
  });
});
