import { createApiClient } from '@tamgiao/api-client';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import {
  createFakeFetch,
  createProblemBody,
  createTestQueryClient,
  renderWithProviders,
} from '../../test-utils/render-with-providers.js';
import { DataRightsScreen } from './data-rights-screen.js';

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    back: mockBack,
  }),
}));

const mockOpenBrowserAsync = jest.fn(async (..._args: unknown[]) => ({ type: 'opened' }));
jest.mock('expo-web-browser', () => ({
  openBrowserAsync: (...args: unknown[]) => mockOpenBrowserAsync(...args),
}));

const mockClearTokens = jest.fn(async () => {});
const mockTokenStore = {
  getAccessToken: jest.fn(async () => 'mock-access-token'),
  getRefreshToken: jest.fn(async () => 'mock-refresh-token'),
  setTokens: jest.fn(async () => {}),
  clear: mockClearTokens,
};

describe('DataRightsScreen - Xuất dữ liệu cá nhân', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('export PENDING → READY hiện nút tải (mock WebBrowser) và có thông tin hạn 24 giờ', async () => {
    let exportPollCount = 0;

    const fakeFetch = createFakeFetch((url, init) => {
      if (url === 'http://api.test/me/data-exports' && init?.method === 'POST') {
        return {
          status: 202,
          body: {
            exportId: '01952e46-953b-789a-b283-a9d701897d10',
            status: 'PENDING',
            requestedAt: '2026-11-22T20:00:00.000Z',
            readyAt: null,
            expiresAt: null,
            downloadUrl: null,
          },
        };
      }

      if (
        url === 'http://api.test/me/data-exports/01952e46-953b-789a-b283-a9d701897d10' &&
        (!init?.method || init.method === 'GET')
      ) {
        exportPollCount += 1;
        // Lần poll đầu vẫn PENDING, lần poll sau chuyển sang READY
        if (exportPollCount === 1) {
          return {
            status: 200,
            body: {
              exportId: '01952e46-953b-789a-b283-a9d701897d10',
              status: 'PENDING',
              requestedAt: '2026-11-22T20:00:00.000Z',
              readyAt: null,
              expiresAt: null,
              downloadUrl: null,
            },
          };
        }

        return {
          status: 200,
          body: {
            exportId: '01952e46-953b-789a-b283-a9d701897d10',
            status: 'READY',
            requestedAt: '2026-11-22T20:00:00.000Z',
            readyAt: '2026-11-22T20:02:00.000Z',
            expiresAt: '2026-11-23T20:02:00.000Z',
            downloadUrl:
              '/data-exports/01952e46-953b-789a-b283-a9d701897d10/download?expires=1795464120&sig=abc123mocksignature',
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

    const queryClient = createTestQueryClient();
    const screen = await renderWithProviders(<DataRightsScreen />, {
      client,
      queryClient,
      tokenStore: mockTokenStore,
    });

    // Bấm nút Yêu cầu xuất dữ liệu
    const requestBtn = screen.getByLabelText('Yêu cầu xuất dữ liệu');
    await act(async () => {
      await fireEvent.press(requestBtn);
    });

    // Hiện thông báo trạng thái PENDING
    await waitFor(() => {
      expect(screen.getByText('Đang khởi tạo file dữ liệu')).toBeTruthy();
    });

    // Kích hoạt refetch query để giả lập polling chuyển sang READY
    await act(async () => {
      await queryClient.refetchQueries({
        queryKey: ['data-export', '01952e46-953b-789a-b283-a9d701897d10'],
      });
    });

    // Trạng thái READY: có ghi chú hạn 24 giờ và hiển thị nút tải
    await waitFor(() => {
      expect(screen.getByText(/24 giờ/i)).toBeTruthy();
      expect(screen.getByLabelText('Tải file dữ liệu (.json)')).toBeTruthy();
    });

    // Bấm nút tải file dữ liệu
    const downloadBtn = screen.getByLabelText('Tải file dữ liệu (.json)');
    await act(async () => {
      await fireEvent.press(downloadBtn);
    });

    // WebBrowser.openBrowserAsync được gọi với URL đầy đủ
    expect(mockOpenBrowserAsync).toHaveBeenCalledWith(
      'http://api.test/data-exports/01952e46-953b-789a-b283-a9d701897d10/download?expires=1795464120&sig=abc123mocksignature',
    );

    await screen.unmount();
  });
});

describe('DataRightsScreen - Xoá tài khoản', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('màn xác nhận có câu không hoàn phí: checkbox bắt buộc để tiếp tục', async () => {
    const screen = await renderWithProviders(<DataRightsScreen />, {
      tokenStore: mockTokenStore,
    });

    // Bấm mở màn cảnh báo xoá tài khoản
    await act(async () => {
      await fireEvent.press(screen.getByLabelText('Yêu cầu xoá tài khoản'));
    });

    // Kiểm tra màn cảnh báo có câu rõ ràng về không hoàn phí xác thực
    expect(screen.getAllByText(/không hoàn phí xác thực/i).length).toBeGreaterThanOrEqual(1);

    const proceedBtn = screen.getByLabelText('Tiếp tục nhận mã OTP');
    expect(proceedBtn.props.accessibilityState?.disabled).toBe(true);

    // Tick chọn checkbox xác nhận
    const checkbox = screen.getByRole('checkbox');
    await act(async () => {
      await fireEvent.press(checkbox);
    });

    // Nút tiếp tục đã được kích hoạt
    expect(proceedBtn.props.accessibilityState?.disabled).toBe(false);

    await screen.unmount();
  });

  it('OTP sai → thông điệp, vẫn ở màn OTP', async () => {
    let otpRequested = false;

    const fakeFetch = createFakeFetch((url, init) => {
      if (url === 'http://api.test/me/account/deletion/otp' && init?.method === 'POST') {
        otpRequested = true;
        return { status: 200, body: {} };
      }
      if (url === 'http://api.test/me/account/deletion' && init?.method === 'POST') {
        return {
          status: 422,
          body: createProblemBody({
            code: 'OTP_INVALID',
            status: 422,
            title: 'Mã OTP không đúng',
          }),
        };
      }
      return { status: 404 };
    });

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: mockTokenStore,
      fetch: fakeFetch,
    });

    const screen = await renderWithProviders(<DataRightsScreen />, {
      client,
      tokenStore: mockTokenStore,
    });

    // Chuyển sang màn cảnh báo
    await act(async () => {
      await fireEvent.press(screen.getByLabelText('Yêu cầu xoá tài khoản'));
    });

    // Tick checkbox
    await act(async () => {
      await fireEvent.press(screen.getByRole('checkbox'));
    });

    // Bấm tiếp tục nhận OTP
    await act(async () => {
      await fireEvent.press(screen.getByLabelText('Tiếp tục nhận mã OTP'));
    });

    await waitFor(() => {
      expect(otpRequested).toBe(true);
      expect(screen.getByText('Xác thực xoá tài khoản')).toBeTruthy();
    });

    // Nhập mã OTP sai
    const otpInput = screen.getByLabelText('Mã xác thực OTP gồm 6 chữ số');
    await act(async () => {
      await fireEvent.changeText(otpInput, '000000');
    });

    // Thông điệp lỗi hiển thị và người dùng vẫn ở màn OTP
    await waitFor(() => {
      expect(screen.getByText(/Mã xác thực không chính xác/i)).toBeTruthy();
      expect(screen.getByLabelText('Mã xác thực OTP gồm 6 chữ số')).toBeTruthy();
      expect(screen.getByLabelText('Xác nhận xoá vĩnh viễn')).toBeTruthy();
    });

    // Token không bị xoá khi OTP sai
    expect(mockClearTokens).not.toHaveBeenCalled();

    await screen.unmount();
  });

  it('xoá thành công → token bị xoá + hiện tiến độ với các bước module', async () => {
    const fakeFetch = createFakeFetch((url, init) => {
      if (url === 'http://api.test/me/account/deletion/otp' && init?.method === 'POST') {
        return { status: 200, body: {} };
      }
      if (url === 'http://api.test/me/account/deletion' && init?.method === 'POST') {
        return {
          status: 202,
          body: {
            requestId: '01952e46-953b-789a-b283-a9d701897d99',
            status: 'PROCESSING',
            requestedAt: '2026-11-22T21:00:00.000Z',
            steps: [
              { module: 'identity', done: true },
              { module: 'profile', done: false },
              { module: 'matching', done: false },
            ],
          },
        };
      }
      if (
        url === 'http://api.test/account-deletions/01952e46-953b-789a-b283-a9d701897d99' &&
        (!init?.method || init.method === 'GET')
      ) {
        return {
          status: 200,
          body: {
            requestId: '01952e46-953b-789a-b283-a9d701897d99',
            status: 'PROCESSING',
            requestedAt: '2026-11-22T21:00:00.000Z',
            steps: [
              { module: 'identity', done: true },
              { module: 'profile', done: true },
              { module: 'matching', done: false },
            ],
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

    const screen = await renderWithProviders(<DataRightsScreen />, {
      client,
      tokenStore: mockTokenStore,
    });

    // Đi qua bước cảnh báo và tick xác nhận
    await act(async () => {
      await fireEvent.press(screen.getByLabelText('Yêu cầu xoá tài khoản'));
    });
    await act(async () => {
      await fireEvent.press(screen.getByRole('checkbox'));
    });
    await act(async () => {
      await fireEvent.press(screen.getByLabelText('Tiếp tục nhận mã OTP'));
    });

    await waitFor(() => {
      expect(screen.getByLabelText('Mã xác thực OTP gồm 6 chữ số')).toBeTruthy();
    });

    // Nhập OTP hợp lệ
    const otpInput = screen.getByLabelText('Mã xác thực OTP gồm 6 chữ số');
    await act(async () => {
      await fireEvent.changeText(otpInput, '123456');
    });

    // Kiểm tra: token bị xoá khỏi máy
    await waitFor(() => {
      expect(mockClearTokens).toHaveBeenCalled();
    });

    // Màn tiến độ xuất hiện, hiển thị các bước của module
    await waitFor(() => {
      expect(screen.getByText('Tiến độ xoá tài khoản')).toBeTruthy();
      expect(screen.getByText('identity')).toBeTruthy();
      expect(screen.getByText('profile')).toBeTruthy();
      expect(screen.getByText('matching')).toBeTruthy();
    });

    // Có nút về màn hình đăng nhập
    const returnLoginBtn = screen.getByLabelText('Về màn hình đăng nhập');
    expect(returnLoginBtn).toBeTruthy();

    await act(async () => {
      await fireEvent.press(returnLoginBtn);
    });

    expect(mockReplace).toHaveBeenCalledWith('/(auth)/phone');

    await screen.unmount();
  });
});
