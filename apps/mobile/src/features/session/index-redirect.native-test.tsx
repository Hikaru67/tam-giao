import type { Text as RNText } from 'react-native';
import { createApiClient } from '@tamgiao/api-client';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import {
  createFakeFetch,
  createProblemBody,
  renderWithProviders,
} from '../../test-utils/render-with-providers.js';
import { QueryClient } from '@tanstack/react-query';
import { EntryScreen } from './entry-screen.js';

/** Mọi href mà EntryScreen từng redirect tới (kể cả redirect thoáng qua). */
const mockRedirectHrefs: string[] = [];

jest.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => {
    // Factory của jest.mock không được dùng biến ngoài → require trong factory.
    const { Text: MockText } = jest.requireActual('react-native') as { Text: typeof RNText };
    mockRedirectHrefs.push(href);
    return <MockText>{`redirect:${href}`}</MockText>;
  },
}));

beforeEach(() => {
  mockRedirectHrefs.length = 0;
});

describe('EntryScreen / index-redirect (FE-S2-02)', () => {
  it('không có access token trong tokenStore -> redirect:/(auth)/phone', async () => {
    const mockTokenStore = {
      getAccessToken: jest.fn(async () => null),
      getRefreshToken: jest.fn(async () => null),
      setTokens: jest.fn(async () => {}),
      clear: jest.fn(async () => {}),
    };

    const screen = await renderWithProviders(<EntryScreen />, {
      tokenStore: mockTokenStore,
    });

    await waitFor(() => {
      expect(screen.getByText('redirect:/(auth)/phone')).toBeTruthy();
    });
  });

  it('có token + /me trả onboardingStep: "CRITERIA" -> redirect:/(onboarding)/preferences', async () => {
    const mockTokenStore = {
      getAccessToken: jest.fn(async () => 'mock-jwt-token'),
      getRefreshToken: jest.fn(async () => 'mock-refresh-token'),
      setTokens: jest.fn(async () => {}),
      clear: jest.fn(async () => {}),
    };

    const fakeFetch = createFakeFetch((url) => {
      if (url === 'http://api.test/me') {
        return {
          status: 200,
          body: {
            userId: '01952e46-953b-789a-b283-a9d701897d26',
            onboardingStep: 'CRITERIA',
            profile: null,
            badges: [],
            verificationPaid: false,
          },
        };
      }
      return { status: 404 };
    });

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: mockTokenStore,
      fetch: fakeFetch,
    });

    const screen = await renderWithProviders(<EntryScreen />, {
      client,
      tokenStore: mockTokenStore,
    });

    await waitFor(() => {
      expect(screen.getByText('redirect:/(onboarding)/preferences')).toBeTruthy();
    });
  });

  it('cache /me cũ (PROFILE, vừa invalidate sau khi lưu hồ sơ) -> chờ /me mới (CRITERIA), không redirect về PROFILE', async () => {
    const mockTokenStore = {
      getAccessToken: jest.fn(async () => 'mock-jwt-token'),
      getRefreshToken: jest.fn(async () => 'mock-refresh-token'),
      setTokens: jest.fn(async () => {}),
      clear: jest.fn(async () => {}),
    };
    const meBody = (onboardingStep: 'PROFILE' | 'CRITERIA') => ({
      userId: '01952e46-953b-789a-b283-a9d701897d26',
      onboardingStep,
      profile: null,
      badges: [],
      verificationPaid: false,
    });

    const fakeFetch = createFakeFetch((url) =>
      url === 'http://api.test/me' ? { status: 200, body: meBody('CRITERIA') } : { status: 404 },
    );
    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: mockTokenStore,
      fetch: fakeFetch,
    });

    // gcTime Infinity: giữ dữ liệu seed tới khi EntryScreen mount (client test mặc định gcTime 0).
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    queryClient.setQueryData(['me'], meBody('PROFILE'));
    await queryClient.invalidateQueries({ queryKey: ['me'] });

    const screen = await renderWithProviders(<EntryScreen />, {
      client,
      tokenStore: mockTokenStore,
      queryClient,
    });

    await waitFor(() => {
      expect(screen.getByText('redirect:/(onboarding)/preferences')).toBeTruthy();
    });
    expect(mockRedirectHrefs).not.toContain('/(onboarding)/profile');
    queryClient.clear();
  });

  it('/me lỗi 503 -> hiện ErrorState, bấm thử lại gọi lại /me thành công -> redirect', async () => {
    const mockTokenStore = {
      getAccessToken: jest.fn(async () => 'mock-jwt-token'),
      getRefreshToken: jest.fn(async () => 'mock-refresh-token'),
      setTokens: jest.fn(async () => {}),
      clear: jest.fn(async () => {}),
    };

    let callCount = 0;
    const fakeFetch = createFakeFetch((url) => {
      if (url === 'http://api.test/me') {
        callCount++;
        if (callCount === 1) {
          return {
            status: 503,
            body: createProblemBody({
              code: 'HTTP_503',
              status: 503,
              title: 'Hệ thống đang bảo trì',
            }),
          };
        }
        return {
          status: 200,
          body: {
            userId: '01952e46-953b-789a-b283-a9d701897d26',
            onboardingStep: 'PROFILE',
            profile: null,
            badges: [],
            verificationPaid: false,
          },
        };
      }
      return { status: 404 };
    });

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: mockTokenStore,
      fetch: fakeFetch,
    });

    const screen = await renderWithProviders(<EntryScreen />, {
      client,
      tokenStore: mockTokenStore,
    });

    // Lúc đầu gặp lỗi 503 -> hiển thị thông báo lỗi từ messageFor
    await waitFor(() => {
      expect(screen.getByText('Hệ thống đang bận, vui lòng thử lại sau.')).toBeTruthy();
      expect(screen.getByText('Hệ thống đang bận, vui lòng thử lại sau.')).toBeTruthy();
    });

    const retryBtn = screen.getByRole('button', { name: 'Thử lại' });
    await act(async () => {
      await fireEvent.press(retryBtn);
    });

    // Sau khi thử lại thành công -> chuyển hướng về PROFILE
    await waitFor(() => {
      expect(callCount).toBe(2);
      expect(screen.getByText('redirect:/(onboarding)/profile')).toBeTruthy();
    });
  });
});
