import { createApiClient } from '@tamgiao/api-client';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import {
  createFakeFetch,
  createTestQueryClient,
  renderWithProviders,
} from '../../test-utils/render-with-providers.js';
import { SessionsScreen } from './sessions-screen.js';
import { SettingsScreen } from './settings-screen.js';

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

const mockTokenStore = {
  getAccessToken: jest.fn(async () => 'mock-access-token'),
  getRefreshToken: jest.fn(async () => 'mock-refresh-token'),
  setTokens: jest.fn(async () => {}),
  clear: jest.fn(async () => {}),
};

describe('SettingsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('hiển thị đầy đủ các mục Cài đặt và điều hướng đúng', async () => {
    const screen = await renderWithProviders(<SettingsScreen />, {
      tokenStore: mockTokenStore,
    });

    expect(screen.getByText('Cài đặt')).toBeTruthy();
    expect(screen.getByText('Cài đặt thông báo')).toBeTruthy();
    expect(screen.getByText('Thiết bị đăng nhập')).toBeTruthy();
    expect(screen.getByText('Quyền dữ liệu cá nhân')).toBeTruthy();

    // Điều hướng mục Thông báo
    await act(async () => {
      await fireEvent.press(screen.getByLabelText('Cài đặt thông báo'));
    });
    expect(mockPush).toHaveBeenCalledWith('/(main)/settings/notifications');

    // Điều hướng mục Thiết bị đăng nhập
    await act(async () => {
      await fireEvent.press(screen.getByLabelText('Thiết bị đăng nhập'));
    });
    expect(mockPush).toHaveBeenCalledWith('/(main)/settings/sessions');

    // Điều hướng mục Quyền dữ liệu cá nhân
    await act(async () => {
      await fireEvent.press(screen.getByLabelText('Quyền dữ liệu cá nhân'));
    });
    expect(mockPush).toHaveBeenCalledWith('/(main)/settings/account');

    await screen.unmount();
  });

  it('đăng xuất thành công: mở modal xác nhận, gọi POST /auth/logout, xoá token và chuyển màn đăng nhập', async () => {
    let logoutCalled = false;

    const fakeFetch = createFakeFetch((url) => {
      if (url === 'http://api.test/auth/logout') {
        logoutCalled = true;
        return { status: 200, body: {} };
      }
      return { status: 404 };
    });

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: mockTokenStore,
      fetch: fakeFetch,
    });

    const screen = await renderWithProviders(<SettingsScreen />, {
      client,
      tokenStore: mockTokenStore,
    });

    // Bấm nút Đăng xuất ban đầu
    const logoutBtn = screen.getByLabelText('Đăng xuất');
    await act(async () => {
      await fireEvent.press(logoutBtn);
    });

    // Modal xác nhận xuất hiện
    expect(screen.getByText('Bạn có chắc chắn muốn đăng xuất khỏi tài khoản?')).toBeTruthy();

    // Bấm nút Xác nhận đăng xuất trong modal
    const confirmButtons = screen.getAllByRole('button', { name: 'Đăng xuất' });
    const modalConfirmBtn = confirmButtons[confirmButtons.length - 1];
    expect(modalConfirmBtn).toBeTruthy();

    await act(async () => {
      await fireEvent.press(modalConfirmBtn!);
    });

    await waitFor(() => {
      expect(logoutCalled).toBe(true);
      expect(mockTokenStore.clear).toHaveBeenCalled();
      expect(mockReplace).toHaveBeenCalledWith('/(auth)/phone');
    });

    await screen.unmount();
  });
});

describe('SessionsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('danh sách thiết bị: gắn nhãn thiết bị hiện tại, không có nút thu hồi cho thiết bị hiện tại, thu hồi gọi DELETE đúng id', async () => {
    const mockSessions = [
      {
        id: '01952e46-953b-789a-b283-a9d701897d01',
        deviceName: 'iPhone 15 Pro Max',
        createdAt: '2026-11-20T10:00:00.000Z',
        lastUsedAt: '2026-11-22T20:00:00.000Z',
        current: true,
      },
      {
        id: '01952e46-953b-789a-b283-a9d701897d02',
        deviceName: 'Chrome on macOS',
        createdAt: '2026-11-15T08:00:00.000Z',
        lastUsedAt: '2026-11-21T15:00:00.000Z',
        current: false,
      },
    ];

    let deletedSessionId: string | null = null;

    const fakeFetch = createFakeFetch((url, init) => {
      if (url === 'http://api.test/auth/sessions' && (!init?.method || init.method === 'GET')) {
        return {
          status: 200,
          body: { items: mockSessions },
        };
      }
      if (url.startsWith('http://api.test/auth/sessions/') && init?.method === 'DELETE') {
        deletedSessionId = url.replace('http://api.test/auth/sessions/', '');
        return { status: 204 };
      }
      return { status: 404 };
    });

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: mockTokenStore,
      fetch: fakeFetch,
    });

    const queryClient = createTestQueryClient();
    const screen = await renderWithProviders(<SessionsScreen />, {
      client,
      queryClient,
      tokenStore: mockTokenStore,
    });

    // Kiểm tra danh sách hiển thị đúng tên hai thiết bị
    await waitFor(() => {
      expect(screen.getByText('iPhone 15 Pro Max')).toBeTruthy();
      expect(screen.getByText('Chrome on macOS')).toBeTruthy();
    });

    // Thiết bị hiện tại có nhãn "Thiết bị này"
    expect(screen.getByText('Thiết bị này')).toBeTruthy();

    // Thiết bị hiện tại không có nút thu hồi
    expect(screen.queryByLabelText('Thu hồi phiên đăng nhập iPhone 15 Pro Max')).toBeNull();

    // Thiết bị khác có nút thu hồi
    const revokeOtherBtn = screen.getByLabelText('Thu hồi phiên đăng nhập Chrome on macOS');
    expect(revokeOtherBtn).toBeTruthy();

    // Bấm nút thu hồi
    await act(async () => {
      await fireEvent.press(revokeOtherBtn);
    });

    // Xuất hiện modal xác nhận thu hồi
    expect(screen.getByText('Thu hồi phiên đăng nhập')).toBeTruthy();
    expect(
      screen.getByText('Bạn có chắc chắn muốn đăng xuất thiết bị "Chrome on macOS" khỏi tài khoản của bạn?'),
    ).toBeTruthy();

    // Xác nhận thu hồi trong modal
    const confirmRevokeBtn = screen.getByRole('button', { name: 'Xác nhận thu hồi' });
    await act(async () => {
      await fireEvent.press(confirmRevokeBtn);
    });

    // Kiểm tra DELETE được gọi đúng ID của thiết bị Chrome on macOS
    await waitFor(() => {
      expect(deletedSessionId).toBe('01952e46-953b-789a-b283-a9d701897d02');
    });

    await screen.unmount();
  });
});
