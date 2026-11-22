import { fireEvent } from '@testing-library/react-native';
import { renderWithProviders } from '../../test-utils/render-with-providers.js';
import { BannedScreen } from './banned-screen.js';

const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({
    replace: mockReplace,
  }),
}));

describe('BannedScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('hiển thị thông điệp khoá tài khoản và nút quay lại', async () => {
    const screen = await renderWithProviders(<BannedScreen />);

    expect(screen.getByText(/khoá vĩnh viễn/i)).toBeTruthy();

    const backButtons = screen.getAllByRole('button', { name: /Quay lại màn hình đăng nhập/i });
    expect(backButtons.length).toBeGreaterThan(0);

    const backButton = backButtons[0];
    if (backButton) {
      await fireEvent.press(backButton);
      expect(mockReplace).toHaveBeenCalledWith('/(auth)/phone');
    }
  });
});
