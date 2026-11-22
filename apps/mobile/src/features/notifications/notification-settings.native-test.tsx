import { createApiClient, createMemoryTokenStore } from '@tamgiao/api-client';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { createFakeFetch, renderWithProviders } from '../../test-utils/render-with-providers.js';
import { NotificationSettingsScreen } from './notification-settings-screen.js';

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    back: mockBack,
  }),
}));

describe('NotificationSettingsScreen (FE-S2-05)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('màn cài đặt: hiển thị đúng và tắt MESSAGE → PUT body đúng, công tắc SAFETY bị khoá', async () => {
    let putBody: unknown = null;
    let putCalled = false;

    const fakeFetch = createFakeFetch((url, init) => {
      if (url === 'http://api.test/me/notification-settings' && init?.method === 'GET') {
        return {
          status: 200,
          body: {
            matches: true,
            messages: true,
            dates: true,
            alwaysOn: ['ACCOUNT', 'SAFETY'],
          },
        };
      }
      if (url === 'http://api.test/me/notification-settings' && init?.method === 'PUT') {
        putCalled = true;
        putBody = init.body ? JSON.parse(init.body as string) : null;
        return {
          status: 200,
          body: {
            matches: true,
            messages: false,
            dates: true,
            alwaysOn: ['ACCOUNT', 'SAFETY'],
          },
        };
      }
      return { status: 404 };
    });

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: createMemoryTokenStore(),
      fetch: fakeFetch,
    });

    const screen = await renderWithProviders(<NotificationSettingsScreen />, {
      client,
    });

    // Chờ màn hình tải xong cài đặt
    const switchMessages = await screen.findByTestId('switch-messages');
    const switchMatches = screen.getByTestId('switch-matches');
    const switchDates = screen.getByTestId('switch-dates');
    const switchSafety = screen.getByTestId('switch-safety');
    const switchAccount = screen.getByTestId('switch-account');

    // Kiểm tra trạng thái ban đầu
    expect(switchMessages.props.value).toBe(true);
    expect(switchMatches.props.value).toBe(true);
    expect(switchDates.props.value).toBe(true);

    // Công tắc SAFETY và ACCOUNT bị khoá (disabled = true, value = true)
    expect(switchSafety.props.disabled).toBe(true);
    expect(switchSafety.props.value).toBe(true);
    expect(switchAccount.props.disabled).toBe(true);
    expect(switchAccount.props.value).toBe(true);

    // Tắt switch MESSAGE (messages -> false)
    await act(async () => {
      await fireEvent(switchMessages, 'valueChange', false);
    });

    await waitFor(() => {
      expect(putCalled).toBe(true);
      expect(putBody).toEqual({
        matches: true,
        messages: false,
        dates: true,
      });
    });

    await screen.unmount();
  });
});
