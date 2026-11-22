import { createSecureTokenStore } from './secure-token-store.js';

const mockStorage = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockStorage.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockStorage.delete(key);
  }),
}));

describe('createSecureTokenStore', () => {
  beforeEach(() => {
    mockStorage.clear();
    jest.clearAllMocks();
  });

  it('lưu trữ và lấy đúng access token và refresh token', async () => {
    const store = createSecureTokenStore();

    expect(await store.getAccessToken()).toBeNull();
    expect(await store.getRefreshToken()).toBeNull();

    await store.setTokens({
      sessionId: '01952e46-953b-789a-b283-a9d701897d26',
      accessToken: 'access-token-123',
      accessTokenExpiresInSeconds: 3600,
      refreshToken: 'refresh-token-123-very-secure-length',
      refreshTokenExpiresAt: '2026-11-23T00:00:00.000Z',
    });

    expect(await store.getAccessToken()).toBe('access-token-123');
    expect(await store.getRefreshToken()).toBe('refresh-token-123-very-secure-length');
  });

  it('xoá toàn bộ token khi gọi clear', async () => {
    const store = createSecureTokenStore();

    await store.setTokens({
      sessionId: '01952e46-953b-789a-b283-a9d701897d26',
      accessToken: 'access-token-xyz',
      accessTokenExpiresInSeconds: 3600,
      refreshToken: 'refresh-token-xyz-length-above-20',
      refreshTokenExpiresAt: '2026-11-23T00:00:00.000Z',
    });

    expect(await store.getAccessToken()).toBe('access-token-xyz');

    await store.clear();

    expect(await store.getAccessToken()).toBeNull();
    expect(await store.getRefreshToken()).toBeNull();
  });
});
