import { renderHook, act, render } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { Text } from '@tamgiao/ui-mobile';
import { createFakeChatClient } from '../../test-utils/fake-chat-client.js';
import {
  ChatClientProvider,
  useChatClient,
  useChatConnectionState,
  usePendingMessages,
} from './chat-client-context.js';

describe('ChatClientContext', () => {
  let appStateListener: ((status: AppStateStatus) => void) | null = null;
  const mockRemove = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    appStateListener = null;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((type, listener) => {
      if (type === 'change') {
        appStateListener = listener;
      }
      return { remove: mockRemove };
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('1. connect khi mount, disconnect khi unmount, AppState active → reconnectNow', async () => {
    const client = createFakeChatClient('idle');

    const screen = await render(
      <ChatClientProvider client={client}>
        <Text>Chat context ready</Text>
      </ChatClientProvider>,
    );

    expect(client.connectedCount).toBe(1);
    expect(client.disconnectedCount).toBe(0);

    // AppState chuyển sang 'background' → không gọi reconnectNow
    await act(async () => {
      appStateListener?.('background');
    });
    expect(client.reconnectedNowCount).toBe(0);

    // AppState chuyển sang 'active' → gọi reconnectNow
    await act(async () => {
      appStateListener?.('active');
    });
    expect(client.reconnectedNowCount).toBe(1);

    // Unmount → gọi disconnect và gỡ listener
    await screen.unmount();
    expect(client.disconnectedCount).toBe(1);
    expect(mockRemove).toHaveBeenCalled();
  });

  it('2. useChatConnectionState và usePendingMessages đồng bộ với client', async () => {
    const client = createFakeChatClient('ready');
    const convId = '01890a5d-ac96-774b-bcce-b302099a0001';

    const { result, unmount } = await renderHook(
      () => {
        const c = useChatClient();
        const state = useChatConnectionState();
        const pending = usePendingMessages(convId);
        return { c, state, pending };
      },
      {
        wrapper: ({ children }) => <ChatClientProvider client={client}>{children}</ChatClientProvider>,
      },
    );

    expect(result.current.c).toBe(client);
    expect(result.current.state).toBe('ready');
    expect(result.current.pending).toEqual([]);

    await act(async () => {
      client.setState('reconnecting');
    });
    expect(result.current.state).toBe('reconnecting');

    const pendingItem = {
      clientMessageId: '01890a5d-ac96-774b-bcce-b302099a0099',
      conversationId: convId,
      body: 'Xin chào',
      createdAt: Date.now(),
      status: 'sending' as const,
    };

    await act(async () => {
      client.setPending(convId, [pendingItem]);
    });
    expect(result.current.pending).toHaveLength(1);
    expect(result.current.pending[0]?.clientMessageId).toBe(pendingItem.clientMessageId);

    await unmount();
  });

  it('3. useChatClient ném lỗi khi dùng ngoài Provider', async () => {
    await expect(renderHook(() => useChatClient())).rejects.toThrow(
      'useChatClient phải dùng bên trong <ChatClientProvider>',
    );
  });
});
