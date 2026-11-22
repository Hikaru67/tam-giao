import { act, waitFor } from '@testing-library/react-native';
import { createApiClient } from '@tamgiao/api-client';
import { createFakeFetch, renderWithProviders } from '../../test-utils/render-with-providers.js';
import { PushRegistrar } from './push-registrar.js';
import { getRegisteredDeviceId, setRegisteredDeviceId } from './device-state.js';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

const mockGetPermissionsAsync = jest.fn();
const mockRequestPermissionsAsync = jest.fn();
const mockGetExpoPushTokenAsync = jest.fn((..._args: unknown[]): Promise<unknown> =>
  Promise.resolve(undefined),
);
let mockPushTokenListener: ((token: { data: string }) => void) | null = null;
const mockAddPushTokenListener = jest.fn((cb: (token: { data: string }) => void) => {
  mockPushTokenListener = cb;
  return { remove: jest.fn() };
});
const mockAddNotificationResponseReceivedListener = jest.fn((..._args: unknown[]) => ({ remove: jest.fn() }));
const mockGetLastNotificationResponseAsync = jest.fn(async () => null);

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: () => mockGetPermissionsAsync(),
  requestPermissionsAsync: () => mockRequestPermissionsAsync(),
  getExpoPushTokenAsync: (opts?: unknown) => mockGetExpoPushTokenAsync(opts),
  addPushTokenListener: (cb: (token: { data: string }) => void) => mockAddPushTokenListener(cb),
  addNotificationResponseReceivedListener: (cb: unknown) => mockAddNotificationResponseReceivedListener(cb),
  getLastNotificationResponseAsync: () => mockGetLastNotificationResponseAsync(),
}));

const mockDeviceState = { isDevice: true };
jest.mock('expo-device', () => ({
  get isDevice() {
    return mockDeviceState.isDevice;
  },
}));

const mockExpoConfigState: { extra?: { eas?: { projectId?: string }; apiUrl?: string; wsUrl?: string } } = {
  extra: {
    apiUrl: 'http://api.test',
    wsUrl: 'ws://api.test/ws',
    eas: { projectId: 'mock-eas-project-id' },
  },
};

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return mockExpoConfigState;
    },
  },
}));

describe('PushRegistrar (FE-S2-05)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setRegisteredDeviceId(null);
    mockDeviceState.isDevice = true;
    mockExpoConfigState.extra = {
      apiUrl: 'http://api.test',
      wsUrl: 'ws://api.test/ws',
      eas: { projectId: 'mock-eas-project-id' },
    };
  });

  it('PushRegistrar gọi POST đúng body khi có quyền (mock expo-notifications, expo-device isDevice true)', async () => {
    let postCalled = false;
    let postBody: unknown = null;

    const fakeFetch = createFakeFetch((url, init) => {
      if (url === 'http://api.test/me/devices' && init?.method === 'POST') {
        postCalled = true;
        postBody = init.body ? JSON.parse(init.body as string) : null;
        return {
          status: 201,
          body: {
            deviceId: '01952e46-953b-7000-8000-000000000099',
            platform: 'android',
            registeredAt: '2026-11-22T00:00:00.000Z',
          },
        };
      }
      return { status: 404 };
    });

    mockGetPermissionsAsync.mockResolvedValueOnce({ status: 'granted' });
    mockGetExpoPushTokenAsync.mockResolvedValueOnce({ data: 'ExponentPushToken[mock-token-abc-123]' });

    const mockTokenStore = {
      getAccessToken: jest.fn(async () => 'valid-access-token'),
      getRefreshToken: jest.fn(async () => 'valid-refresh-token'),
      setTokens: jest.fn(async () => {}),
      clear: jest.fn(async () => {}),
    };

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: mockTokenStore,
      fetch: fakeFetch,
    });

    const screen = await renderWithProviders(<PushRegistrar />, {
      client,
      tokenStore: mockTokenStore,
    });

    await waitFor(() => {
      expect(postCalled).toBe(true);
      expect(postBody).toEqual({
        token: 'ExponentPushToken[mock-token-abc-123]',
        platform: expect.stringMatching(/^(ios|android)$/),
      });
      expect(getRegisteredDeviceId()).toBe('01952e46-953b-7000-8000-000000000099');
    });

    await screen.unmount();
  });

  it('không có projectId → không gọi POST và không crash', async () => {
    let postCalled = false;
    const fakeFetch = createFakeFetch((url, init) => {
      if (url === 'http://api.test/me/devices' && init?.method === 'POST') {
        postCalled = true;
        return { status: 201, body: {} };
      }
      return { status: 404 };
    });

    mockExpoConfigState.extra = {
      apiUrl: 'http://api.test',
      wsUrl: 'ws://api.test/ws',
      eas: undefined,
    };

    mockGetPermissionsAsync.mockResolvedValueOnce({ status: 'granted' });

    const mockTokenStore = {
      getAccessToken: jest.fn(async () => 'valid-access-token'),
      getRefreshToken: jest.fn(async () => 'valid-refresh-token'),
      setTokens: jest.fn(async () => {}),
      clear: jest.fn(async () => {}),
    };

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: mockTokenStore,
      fetch: fakeFetch,
    });

    const screen = await renderWithProviders(<PushRegistrar />, {
      client,
      tokenStore: mockTokenStore,
    });

    await act(async () => {});

    expect(postCalled).toBe(false);
    expect(getRegisteredDeviceId()).toBeNull();

    await screen.unmount();
  });

  it('khi Device.isDevice là false → không gọi POST', async () => {
    let postCalled = false;
    const fakeFetch = createFakeFetch((url, init) => {
      if (url === 'http://api.test/me/devices' && init?.method === 'POST') {
        postCalled = true;
        return { status: 201, body: {} };
      }
      return { status: 404 };
    });

    mockDeviceState.isDevice = false;

    const mockTokenStore = {
      getAccessToken: jest.fn(async () => 'valid-access-token'),
      getRefreshToken: jest.fn(async () => 'valid-refresh-token'),
      setTokens: jest.fn(async () => {}),
      clear: jest.fn(async () => {}),
    };

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: mockTokenStore,
      fetch: fakeFetch,
    });

    const screen = await renderWithProviders(<PushRegistrar />, {
      client,
      tokenStore: mockTokenStore,
    });

    await act(async () => {});

    expect(postCalled).toBe(false);

    await screen.unmount();
  });

  it('khi token thay đổi (addPushTokenListener) → tự động đăng ký lại', async () => {
    const tokensRegistered: string[] = [];

    const fakeFetch = createFakeFetch((url, init) => {
      if (url === 'http://api.test/me/devices' && init?.method === 'POST') {
        const body = init.body ? (JSON.parse(init.body as string) as { token: string }) : null;
        if (body?.token) {
          tokensRegistered.push(body.token);
        }
        return {
          status: 201,
          body: {
            deviceId: '01952e46-953b-7000-8000-000000000088',
            platform: 'android',
            registeredAt: '2026-11-22T00:00:00.000Z',
          },
        };
      }
      return { status: 404 };
    });

    mockGetPermissionsAsync.mockResolvedValueOnce({ status: 'granted' });
    mockGetExpoPushTokenAsync.mockResolvedValueOnce({ data: 'ExponentPushToken[first-token-111]' });

    const mockTokenStore = {
      getAccessToken: jest.fn(async () => 'valid-access-token'),
      getRefreshToken: jest.fn(async () => 'valid-refresh-token'),
      setTokens: jest.fn(async () => {}),
      clear: jest.fn(async () => {}),
    };

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: mockTokenStore,
      fetch: fakeFetch,
    });

    const screen = await renderWithProviders(<PushRegistrar />, {
      client,
      tokenStore: mockTokenStore,
    });

    await waitFor(() => {
      expect(tokensRegistered).toContain('ExponentPushToken[first-token-111]');
    });

    // Kích hoạt đổi token
    await act(async () => {
      mockPushTokenListener?.({ data: 'ExponentPushToken[second-token-222]' });
    });

    await waitFor(() => {
      expect(tokensRegistered).toContain('ExponentPushToken[second-token-222]');
    });

    await screen.unmount();
  });
});
