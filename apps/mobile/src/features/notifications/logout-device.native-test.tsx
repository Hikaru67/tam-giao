import { Button } from 'react-native';
import { createApiClient } from '@tamgiao/api-client';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import {
  createFakeFetch,
  createProblemBody,
  renderWithProviders,
} from '../../test-utils/render-with-providers.js';
import { useLogout } from '../session/use-logout.js';
import { getRegisteredDeviceId, setRegisteredDeviceId } from './device-state.js';

const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({
    replace: mockReplace,
  }),
}));

function LogoutTester() {
  const logout = useLogout();
  return (
    <Button
      title="Đăng xuất"
      testID="logout-btn"
      onPress={() => {
        logout.mutate();
      }}
    />
  );
}

describe('useLogout với thiết bị push (FE-S2-05)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('logout gọi DELETE thiết bị rồi clear', async () => {
    setRegisteredDeviceId('00000000-0000-0000-0000-000000000001');

    const callOrder: string[] = [];
    const fakeFetch = createFakeFetch((url, init) => {
      if (
        url === 'http://api.test/me/devices/00000000-0000-0000-0000-000000000001' &&
        init?.method === 'DELETE'
      ) {
        callOrder.push('DELETE_DEVICE');
        return { status: 204 };
      }
      if (url === 'http://api.test/auth/logout' && init?.method === 'POST') {
        callOrder.push('POST_LOGOUT');
        return { status: 204 };
      }
      return { status: 404 };
    });

    const mockTokenStore = {
      getAccessToken: jest.fn(async () => 'mock-jwt'),
      getRefreshToken: jest.fn(async () => 'mock-refresh'),
      setTokens: jest.fn(async () => {}),
      clear: jest.fn(async () => {
        callOrder.push('CLEAR_TOKEN');
      }),
    };

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: mockTokenStore,
      fetch: fakeFetch,
    });

    const screen = await renderWithProviders(<LogoutTester />, {
      client,
      tokenStore: mockTokenStore,
    });

    const button = screen.getByTestId('logout-btn');
    await act(async () => {
      await fireEvent.press(button);
    });

    await waitFor(() => {
      expect(callOrder).toContain('DELETE_DEVICE');
      expect(callOrder).toContain('CLEAR_TOKEN');
      // Đảm bảo DELETE_DEVICE được gọi trước khi clear token
      expect(callOrder.indexOf('DELETE_DEVICE')).toBeLessThan(callOrder.indexOf('CLEAR_TOKEN'));
      expect(getRegisteredDeviceId()).toBeNull();
      expect(mockReplace).toHaveBeenCalledWith('/(auth)/phone');
    });

    await screen.unmount();
  });

  it('khi DELETE thiết bị lỗi HTTP 500 vẫn tiếp tục clear tokenStore và redirect', async () => {
    setRegisteredDeviceId('00000000-0000-0000-0000-000000000002');

    const fakeFetch = createFakeFetch((url, init) => {
      if (url.includes('/me/devices/') && init?.method === 'DELETE') {
        return { status: 500, body: createProblemBody({ code: 'HTTP_500', status: 500 }) };
      }
      if (url === 'http://api.test/auth/logout') {
        return { status: 204 };
      }
      return { status: 404 };
    });

    const mockTokenStore = {
      getAccessToken: jest.fn(async () => 'mock-jwt'),
      getRefreshToken: jest.fn(async () => 'mock-refresh'),
      setTokens: jest.fn(async () => {}),
      clear: jest.fn(async () => {}),
    };

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: mockTokenStore,
      fetch: fakeFetch,
    });

    const screen = await renderWithProviders(<LogoutTester />, {
      client,
      tokenStore: mockTokenStore,
    });

    const button = screen.getByTestId('logout-btn');
    await act(async () => {
      await fireEvent.press(button);
    });

    await waitFor(() => {
      expect(mockTokenStore.clear).toHaveBeenCalled();
      expect(getRegisteredDeviceId()).toBeNull();
      expect(mockReplace).toHaveBeenCalledWith('/(auth)/phone');
    });

    await screen.unmount();
  });
});
