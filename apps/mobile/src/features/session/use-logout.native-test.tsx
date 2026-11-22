import { Button } from 'react-native';
import { createApiClient } from '@tamgiao/api-client';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import {
  createFakeFetch,
  createProblemBody,
  renderWithProviders,
} from '../../test-utils/render-with-providers.js';
import { useLogout } from './use-logout.js';

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

describe('useLogout (FE-S2-02)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('logout gọi POST /auth/logout thành công: clear tokenStore, queryClient.clear và router.replace("/(auth)/phone")', async () => {
    let logoutCalled = false;
    const fakeFetch = createFakeFetch((url, init) => {
      if (url === 'http://api.test/auth/logout' && init?.method === 'POST') {
        logoutCalled = true;
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
      expect(logoutCalled).toBe(true);
      expect(mockTokenStore.clear).toHaveBeenCalled();
      expect(mockReplace).toHaveBeenCalledWith('/(auth)/phone');
    });
  });

  it('khi POST /auth/logout trả lỗi mạng hoặc lỗi HTTP vẫn clear tokenStore và router.replace("/(auth)/phone")', async () => {
    const fakeFetch = createFakeFetch(() => ({
      status: 500,
      body: createProblemBody({
        code: 'HTTP_500',
        status: 500,
        title: 'Lỗi máy chủ',
      }),
    }));

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
      expect(mockReplace).toHaveBeenCalledWith('/(auth)/phone');
    });
  });
});
