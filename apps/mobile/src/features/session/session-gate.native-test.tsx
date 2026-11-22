import { Text } from 'react-native';
import { act, waitFor } from '@testing-library/react-native';
import { renderWithProviders } from '../../test-utils/render-with-providers.js';
import { sessionEvents } from '../../session/api.js';
import { SessionGate } from './session-gate.js';

const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({
    replace: mockReplace,
  }),
}));

describe('SessionGate (FE-S2-02)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('phát sessionEvents.emitSignedOut() -> clear queryClient và router.replace("/(auth)/phone")', async () => {
    const screen = await renderWithProviders(
      <SessionGate>
        <Text>Nội dung màn hình con</Text>
      </SessionGate>,
    );

    expect(screen.getByText('Nội dung màn hình con')).toBeTruthy();

    await act(async () => {
      sessionEvents.emitSignedOut();
    });

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/(auth)/phone');
    });
  });

  it('khi SessionGate bị unmount -> hủy đăng ký listener, emit không còn trigger router.replace', async () => {
    const screen = await renderWithProviders(
      <SessionGate>
        <Text>Nội dung màn hình con</Text>
      </SessionGate>,
    );

    await screen.unmount();

    await act(async () => {
      sessionEvents.emitSignedOut();
    });

    expect(mockReplace).not.toHaveBeenCalled();
  });
});
