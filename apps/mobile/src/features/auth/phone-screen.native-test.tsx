import { createApiClient } from '@tamgiao/api-client';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import {
  createFakeFetch,
  createProblemBody,
  renderWithProviders,
} from '../../test-utils/render-with-providers.js';
import { PhoneScreen } from './phone-screen.js';

const mockPush = jest.fn();
const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
  }),
}));

describe('PhoneScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('nút nhận OTP bị disabled khi số điện thoại chưa đúng hoặc chưa nhập', async () => {
    const screen = await renderWithProviders(<PhoneScreen />);
    const submitBtn = screen.getByRole('button', { name: 'Tiếp tục nhận mã OTP' });

    expect(submitBtn.props.accessibilityState.disabled).toBe(true);

    const input = screen.getByPlaceholderText('0912 345 678');
    await fireEvent.changeText(input, '12345');

    expect(submitBtn.props.accessibilityState.disabled).toBe(true);
  });

  it('gửi POST /auth/otp/request với E.164 khi số điện thoại hợp lệ và chuyển trang', async () => {
    let capturedBody: unknown = null;

    const fakeFetch = createFakeFetch((url, init) => {
      if (url === 'http://api.test/auth/otp/request') {
        capturedBody = init?.body ? JSON.parse(init.body as string) : null;
        return {
          status: 200,
          body: {
            expiresInSeconds: 120,
            resendAfterSeconds: 60,
          },
        };
      }
      return { status: 404 };
    });

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: {
        getAccessToken: jest.fn(),
        getRefreshToken: jest.fn(),
        setTokens: jest.fn(),
        clear: jest.fn(),
      },
      fetch: fakeFetch,
    });

    const screen = await renderWithProviders(<PhoneScreen />, { client });

    const input = screen.getByPlaceholderText('0912 345 678');
    await fireEvent.changeText(input, '0912 345 678');

    const submitBtn = screen.getByRole('button', { name: 'Tiếp tục nhận mã OTP' });
    expect(submitBtn.props.accessibilityState.disabled).toBe(false);

    await act(async () => {
      await fireEvent.press(submitBtn);
    });

    await waitFor(() => {
      expect(capturedBody).toEqual({ phone: '+84912345678' });
      expect(mockPush).toHaveBeenCalledWith({
        pathname: '/(auth)/otp',
        params: {
          phone: '+84912345678',
          resendAfter: '60',
        },
      });
    });
  });

  it('hiển thị thông điệp chứa 60 giây khi gặp lỗi RATE_LIMITED', async () => {
    const fakeFetch = createFakeFetch(() => ({
      status: 429,
      body: createProblemBody({
        code: 'RATE_LIMITED',
        status: 429,
        title: 'Bạn đang thao tác quá nhanh.',
        meta: { retryAfterSeconds: 60 },
      }),
    }));

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: {
        getAccessToken: jest.fn(),
        getRefreshToken: jest.fn(),
        setTokens: jest.fn(),
        clear: jest.fn(),
      },
      fetch: fakeFetch,
    });

    const screen = await renderWithProviders(<PhoneScreen />, { client });

    const input = screen.getByPlaceholderText('0912 345 678');
    await fireEvent.changeText(input, '0912345678');

    const submitBtn = screen.getByRole('button', { name: 'Tiếp tục nhận mã OTP' });

    await act(async () => {
      await fireEvent.press(submitBtn);
    });

    await waitFor(() => {
      expect(screen.getByText(/60/)).toBeTruthy();
    });
  });
});
