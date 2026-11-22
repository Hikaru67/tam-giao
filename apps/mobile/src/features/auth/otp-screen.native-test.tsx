import { createApiClient } from '@tamgiao/api-client';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import {
  createFakeFetch,
  createProblemBody,
  renderWithProviders,
} from '../../test-utils/render-with-providers.js';
import { OtpScreen } from './otp-screen.js';

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();

let mockRouteParams: { phone?: string; resendAfter?: string } = {
  phone: '+84912345678',
  resendAfter: '120',
};

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    back: mockBack,
  }),
  useLocalSearchParams: () => mockRouteParams,
}));

const mockSetTokens = jest.fn();
const mockTokenStore = {
  getAccessToken: jest.fn(async () => null),
  getRefreshToken: jest.fn(async () => null),
  setTokens: mockSetTokens,
  clear: jest.fn(async () => {}),
};

jest.mock('../../session/api.js', () => ({
  tokenStore: mockTokenStore,
  apiClient: {},
  sessionEvents: {
    onSignedOut: jest.fn(),
    emitSignedOut: jest.fn(),
  },
}));

describe('OtpScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouteParams = {
      phone: '+84912345678',
      resendAfter: '120',
    };
  });

  it('nhập đủ 6 số xác thực thành công: gọi đúng body, setTokens và điều hướng về trang chủ', async () => {
    let capturedBody: unknown = null;

    const fakeFetch = createFakeFetch((url, init) => {
      if (url === 'http://api.test/auth/otp/verify') {
        capturedBody = init?.body ? JSON.parse(init.body as string) : null;
        return {
          status: 200,
          body: {
            userId: '01952e46-953b-789a-b283-a9d701897d26',
            isNewUser: false,
            tokens: {
              sessionId: '01952e46-953b-789a-b283-a9d701897d27',
              accessToken: 'mock-access-token-jwt',
              accessTokenExpiresInSeconds: 3600,
              refreshToken: 'mock-refresh-token-string-20-chars',
              refreshTokenExpiresAt: '2026-11-23T00:00:00.000Z',
            },
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

    const screen = await renderWithProviders(<OtpScreen />, { client, tokenStore: mockTokenStore });

    // Kiểm tra số điện thoại hiển thị che 4 số giữa
    expect(screen.getByText('0912 *** 678')).toBeTruthy();

    const otpInput = screen.getByLabelText('Mã xác thực OTP gồm 6 chữ số');

    await act(async () => {
      await fireEvent.changeText(otpInput, '123456');
    });

    await waitFor(() => {
      expect(capturedBody).toEqual({
        phone: '+84912345678',
        code: '123456',
      });
      expect(mockSetTokens).toHaveBeenCalledWith(
        expect.objectContaining({
          accessToken: 'mock-access-token-jwt',
          refreshToken: 'mock-refresh-token-string-20-chars',
        }),
      );
      expect(mockReplace).toHaveBeenCalledWith('/');
    });
  });

  it('OTP_INVALID với remainingAttempts > 0: hiện thông điệp lỗi và vẫn cho phép nhập', async () => {
    const fakeFetch = createFakeFetch(() => ({
      status: 400,
      body: createProblemBody({
        code: 'OTP_INVALID',
        status: 400,
        title: 'Mã xác thực không chính xác.',
        meta: { remainingAttempts: 2 },
      }),
    }));

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: mockTokenStore,
      fetch: fakeFetch,
    });

    const screen = await renderWithProviders(<OtpScreen />, { client, tokenStore: mockTokenStore });
    const otpInput = screen.getByLabelText('Mã xác thực OTP gồm 6 chữ số');

    await act(async () => {
      await fireEvent.changeText(otpInput, '654321');
    });

    await waitFor(() => {
      expect(screen.getByText('Mã xác thực không chính xác.')).toBeTruthy();
    });

    // Ô nhập vẫn có thể chỉnh sửa
    expect(otpInput.props.editable).toBe(true);
  });

  it('OTP_INVALID với remainingAttempts = 0: khoá ô nhập', async () => {
    const fakeFetch = createFakeFetch(() => ({
      status: 400,
      body: createProblemBody({
        code: 'OTP_INVALID',
        status: 400,
        title: 'Mã xác thực không chính xác.',
        meta: { remainingAttempts: 0 },
      }),
    }));

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: mockTokenStore,
      fetch: fakeFetch,
    });

    const screen = await renderWithProviders(<OtpScreen />, { client, tokenStore: mockTokenStore });
    const otpInput = screen.getByLabelText('Mã xác thực OTP gồm 6 chữ số');

    await act(async () => {
      await fireEvent.changeText(otpInput, '000000');
    });

    await waitFor(() => {
      expect(otpInput.props.editable).toBe(false);
    });
  });

  it('OTP_LOCKED: khoá ô nhập', async () => {
    const fakeFetch = createFakeFetch(() => ({
      status: 429,
      body: createProblemBody({
        code: 'OTP_LOCKED',
        status: 429,
        title: 'Bạn đã nhập sai mã xác thực quá số lần cho phép.',
        meta: { retryAfterSeconds: 300 },
      }),
    }));

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: mockTokenStore,
      fetch: fakeFetch,
    });

    const screen = await renderWithProviders(<OtpScreen />, { client, tokenStore: mockTokenStore });
    const otpInput = screen.getByLabelText('Mã xác thực OTP gồm 6 chữ số');

    await act(async () => {
      await fireEvent.changeText(otpInput, '999999');
    });

    await waitFor(() => {
      expect(otpInput.props.editable).toBe(false);
    });
  });

  it('ACCOUNT_BANNED: điều hướng sang banned screen và KHÔNG lưu token', async () => {
    const fakeFetch = createFakeFetch(() => ({
      status: 403,
      body: createProblemBody({
        code: 'ACCOUNT_BANNED',
        status: 403,
        title: 'Tài khoản của bạn đã bị khoá vĩnh viễn.',
      }),
    }));

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: mockTokenStore,
      fetch: fakeFetch,
    });

    const screen = await renderWithProviders(<OtpScreen />, { client, tokenStore: mockTokenStore });
    const otpInput = screen.getByLabelText('Mã xác thực OTP gồm 6 chữ số');

    await act(async () => {
      await fireEvent.changeText(otpInput, '111222');
    });

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/(auth)/banned');
      expect(mockSetTokens).not.toHaveBeenCalled();
    });
  });
});
