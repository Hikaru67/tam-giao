import { createApiClient, createMemoryTokenStore, messageFor } from '@tamgiao/api-client';
import type { CurrentMatchDto, CurrentMatchResponse } from '@tamgiao/contracts/matching';
import type {
  ConversationListResponse,
  ConversationMessageDto,
  ConversationSummaryDto,
  IcebreakersResponse,
  MessagesAfterResponse,
} from '@tamgiao/contracts/messaging';
import { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { createFakeChatClient, type FakeChatClient } from '../../test-utils/fake-chat-client.js';
import {
  createFakeFetch,
  createProblemBody,
  createTestQueryClient,
  renderWithProviders,
} from '../../test-utils/render-with-providers.js';
import { ChatClientProvider, ChatScreen } from '../chat/index.js';
import { CONVERSATIONS_QUERY_KEY } from '../match/index.js';
import { INBOX_COPY } from './copy.js';
import { InboxScreen } from './inbox-screen.js';

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockCanGoBack = jest.fn(() => true);

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    back: mockBack,
    canGoBack: mockCanGoBack,
  }),
  useLocalSearchParams: () => ({}),
}));

const mockReceivedListeners: Array<(n: unknown) => void> = [];
jest.mock('expo-notifications', () => ({
  addNotificationReceivedListener: (cb: (n: unknown) => void) => {
    mockReceivedListeners.push(cb);
    return {
      remove: () => {
        const i = mockReceivedListeners.indexOf(cb);
        if (i >= 0) mockReceivedListeners.splice(i, 1);
      },
    };
  },
}));

jest.mock('expo-screen-capture', () => ({
  usePreventScreenCapture: jest.fn(),
}));

const CONVERSATION_ID_1 = '01890a5d-ac96-774b-bcce-b302099a0001';
const CONVERSATION_ID_2 = '01890a5d-ac96-774b-bcce-b302099a0002';
const PEER_USER_ID_1 = '01890a5d-ac96-774b-bcce-b302099a0011';
const PEER_USER_ID_2 = '01890a5d-ac96-774b-bcce-b302099a0012';
const MY_USER_ID = '01890a5d-ac96-774b-bcce-b302099a0099';
const MATCH_ID_1 = '01890a5d-ac96-774b-bcce-b302099a0050';
const MSG_ID_1 = '01890a5d-ac96-774b-bcce-b302099a0021';
const MSG_ID_2 = '01890a5d-ac96-774b-bcce-b302099a0022';
const MSG_ID_3 = '01890a5d-ac96-774b-bcce-b302099a0023';

const DEFAULT_MATCH: CurrentMatchDto = {
  matchId: MATCH_ID_1,
  status: 'DATING',
  phase: 'DATING',
  offeredAt: '2026-11-20T00:00:00.000Z',
  datingStartedAt: '2026-11-20T00:00:00.000Z',
  score: null,
  commonPoints: [],
  staffNote: null,
  counterpart: {
    userId: PEER_USER_ID_1,
    displayName: 'Minh Trang',
    age: 28,
    currentCity: 'TP. Hồ Chí Minh',
    occupation: 'Kiểm toán',
    education: 'bachelor',
    avatar: {
      url: 'https://example.com/avatar.jpg',
      expiresAt: '2026-12-04T00:00:00.000Z',
    },
  },
  expiresAt: '2026-12-04T00:00:00.000Z',
};

interface HarnessOptions {
  conversations?: ConversationListResponse;
  onGetConversations?: () => { status?: number; body?: unknown };
  match?: CurrentMatchDto | null;
  onPostRead?: (body: unknown) => { status?: number; body?: unknown };
  initialMessages?: ConversationMessageDto[];
}

function buildInboxHarness(options: HarnessOptions = {}) {
  const fakeChatClient: FakeChatClient = createFakeChatClient();
  const tokenStore = createMemoryTokenStore();
  const queryClient = createTestQueryClient();

  const fetchHandler = (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(init.body.toString()) : undefined;

    if (url === 'http://api.test/me/conversations' && method === 'GET') {
      if (options.onGetConversations) {
        return options.onGetConversations();
      }
      return {
        status: 200,
        body: options.conversations ?? ({ items: [] } satisfies ConversationListResponse),
      };
    }

    if (url === 'http://api.test/me/match' && method === 'GET') {
      return {
        status: 200,
        body: {
          match: options.match !== undefined ? options.match : DEFAULT_MATCH,
        } satisfies CurrentMatchResponse,
      };
    }

    if (
      url.startsWith(`http://api.test/me/conversations/${CONVERSATION_ID_1}/messages`) &&
      method === 'GET'
    ) {
      return {
        status: 200,
        body: {
          items: options.initialMessages ?? [
            {
              messageId: MSG_ID_1,
              conversationId: CONVERSATION_ID_1,
              senderId: PEER_USER_ID_1,
              kind: 'TEXT',
              systemCode: null,
              body: 'Chào bạn',
              masked: false,
              clientMessageId: null,
              sentAt: '2026-11-24T08:00:00.000Z',
            },
          ],
          hasMore: false,
        } satisfies MessagesAfterResponse,
      };
    }

    if (url === `http://api.test/me/conversations/${CONVERSATION_ID_1}/read` && method === 'POST') {
      if (options.onPostRead) {
        return options.onPostRead(body);
      }
      return {
        status: 200,
        body: {
          conversationId: CONVERSATION_ID_1,
          lastReadMessageId: MSG_ID_1,
          readAt: '2026-11-24T08:05:00.000Z',
          unreadCount: 0,
        },
      };
    }

    if (url === `http://api.test/me/conversations/${CONVERSATION_ID_1}/icebreakers` && method === 'GET') {
      return {
        status: 200,
        body: {
          conversationId: CONVERSATION_ID_1,
          datingDay: 4,
          datingDays: 14,
          theme: 'Chủ đề',
          topics: ['Sở thích'],
        } satisfies IcebreakersResponse,
      };
    }

    return { status: 404, body: { error: 'Not found' } };
  };

  const client = createApiClient({
    baseUrl: 'http://api.test',
    tokenStore,
    fetch: createFakeFetch(fetchHandler),
  });

  return { client, queryClient, fakeChatClient, tokenStore };
}

describe('InboxScreen (FE-S4-05)', () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockReplace.mockClear();
    mockBack.mockClear();
    mockCanGoBack.mockReturnValue(true);
    mockReceivedListeners.length = 0;
  });

  it('a. rỗng → EmptyState; bấm back khi canGoBack=true gọi back, canGoBack=false gọi replace', async () => {
    const { client, queryClient, fakeChatClient } = buildInboxHarness({
      conversations: { items: [] },
    });

    const screen = await renderWithProviders(
      <ChatClientProvider client={fakeChatClient}>
        <InboxScreen />
      </ChatClientProvider>,
      { client, queryClient },
    );

    await waitFor(() => {
      expect(screen.getByTestId('inbox-list')).toBeTruthy();
      expect(screen.getByText(INBOX_COPY.empty.title)).toBeTruthy();
      expect(screen.getByText(INBOX_COPY.empty.description)).toBeTruthy();
    });

    // Bấm back khi canGoBack=true
    await act(async () => {
      await fireEvent.press(screen.getByTestId('inbox-back'));
    });
    expect(mockBack).toHaveBeenCalledTimes(1);

    // Bấm back khi canGoBack=false
    mockCanGoBack.mockReturnValue(false);
    await act(async () => {
      await fireEvent.press(screen.getByTestId('inbox-back'));
    });
    expect(mockReplace).toHaveBeenCalledWith('/(main)/home');

    await screen.unmount();
  });

  it('b. có tin: tên, tin cuối, "Ngày 4/14", badge chưa đọc, hội thoại CLOSED ở nhóm đã kết thúc không có nút đặt lịch', async () => {
    const openConversation: ConversationSummaryDto = {
      conversationId: CONVERSATION_ID_1,
      peerUserId: PEER_USER_ID_1,
      status: 'OPEN',
      openedAt: '2026-11-20T08:00:00.000Z',
      closesAt: '2026-12-04T08:00:00.000Z',
      datingDay: 4,
      datingDays: 14,
      unreadCount: 3,
      lastReadMessageId: null,
      lastMessage: {
        messageId: MSG_ID_1,
        conversationId: CONVERSATION_ID_1,
        senderId: PEER_USER_ID_1,
        kind: 'TEXT',
        systemCode: null,
        body: 'Hẹn gặp bạn cuối tuần này nhé',
        masked: false,
        clientMessageId: null,
        sentAt: new Date().toISOString(),
      },
    };

    const closedConversation: ConversationSummaryDto = {
      conversationId: CONVERSATION_ID_2,
      peerUserId: PEER_USER_ID_2,
      status: 'CLOSED',
      openedAt: '2026-10-01T08:00:00.000Z',
      closesAt: '2026-10-15T08:00:00.000Z',
      datingDay: 14,
      datingDays: 14,
      unreadCount: 0,
      lastReadMessageId: null,
      lastMessage: {
        messageId: MSG_ID_2,
        conversationId: CONVERSATION_ID_2,
        senderId: MY_USER_ID,
        kind: 'TEXT',
        systemCode: null,
        body: 'Cảm ơn và chúc bạn may mắn',
        masked: false,
        clientMessageId: null,
        sentAt: '2026-10-15T08:00:00.000Z',
      },
    };

    const { client, queryClient, fakeChatClient } = buildInboxHarness({
      conversations: { items: [openConversation, closedConversation] },
      match: DEFAULT_MATCH,
    });

    const screen = await renderWithProviders(
      <ChatClientProvider client={fakeChatClient}>
        <InboxScreen />
      </ChatClientProvider>,
      { client, queryClient },
    );

    await waitFor(() => {
      // Tên đối phương
      expect(screen.getByText('Minh Trang')).toBeTruthy();
      expect(screen.getByText(INBOX_COPY.peerFallback)).toBeTruthy();

      // Tin cuối
      expect(screen.getByText('Hẹn gặp bạn cuối tuần này nhé')).toBeTruthy();
      expect(screen.getByText(`${INBOX_COPY.youPrefix}Cảm ơn và chúc bạn may mắn`)).toBeTruthy();

      // 'Ngày 4/14'
      expect(screen.getByText(INBOX_COPY.dayMilestone(4, 14))).toBeTruthy();

      // Badge chưa đọc ở hội thoại 1 (unreadCount: 3)
      const unreadBadge = screen.getByTestId(`inbox-unread-${CONVERSATION_ID_1}`);
      expect(unreadBadge).toBeTruthy();
      expect(screen.getByText('3')).toBeTruthy();

      // Hội thoại 2 (unreadCount: 0) không hiện badge
      expect(screen.queryByTestId(`inbox-unread-${CONVERSATION_ID_2}`)).toBeNull();

      // Nhóm đã kết thúc
      expect(screen.getByText(INBOX_COPY.sections.closed)).toBeTruthy();

      // Nút đặt lịch ở hội thoại OPEN
      expect(screen.getByTestId(`inbox-date-${CONVERSATION_ID_1}`)).toBeTruthy();

      // Hội thoại CLOSED không có nút đặt lịch
      expect(screen.queryByTestId(`inbox-date-${CONVERSATION_ID_2}`)).toBeNull();
    });

    await screen.unmount();
  });

  it('c. bấm row → push chat; bấm đặt lịch → push dates và KHÔNG push chat', async () => {
    const openConversation: ConversationSummaryDto = {
      conversationId: CONVERSATION_ID_1,
      peerUserId: PEER_USER_ID_1,
      status: 'OPEN',
      openedAt: '2026-11-20T08:00:00.000Z',
      closesAt: '2026-12-04T08:00:00.000Z',
      datingDay: 4,
      datingDays: 14,
      unreadCount: 0,
      lastReadMessageId: null,
      lastMessage: null,
    };

    const { client, queryClient, fakeChatClient } = buildInboxHarness({
      conversations: { items: [openConversation] },
      match: DEFAULT_MATCH,
    });

    const screen = await renderWithProviders(
      <ChatClientProvider client={fakeChatClient}>
        <InboxScreen />
      </ChatClientProvider>,
      { client, queryClient },
    );

    await waitFor(() => {
      expect(screen.getByTestId(`inbox-row-${CONVERSATION_ID_1}`)).toBeTruthy();
      expect(screen.getByTestId(`inbox-date-${CONVERSATION_ID_1}`)).toBeTruthy();
    });

    // Bấm đặt lịch
    await act(async () => {
      await fireEvent.press(screen.getByTestId(`inbox-date-${CONVERSATION_ID_1}`));
    });

    expect(mockPush).toHaveBeenCalledWith('/(main)/dates');
    expect(mockPush).not.toHaveBeenCalledWith(`/(main)/chat/${CONVERSATION_ID_1}`);

    mockPush.mockClear();

    // Bấm row
    await act(async () => {
      await fireEvent.press(screen.getByTestId(`inbox-row-${CONVERSATION_ID_1}`));
    });

    expect(mockPush).toHaveBeenCalledWith(`/(main)/chat/${CONVERSATION_ID_1}`);

    await screen.unmount();
  });

  it('d. không có /chuyên viên|tư vấn|tương hợp|%|eKYC/i', async () => {
    const openConversation: ConversationSummaryDto = {
      conversationId: CONVERSATION_ID_1,
      peerUserId: PEER_USER_ID_1,
      status: 'OPEN',
      openedAt: '2026-11-20T08:00:00.000Z',
      closesAt: '2026-12-04T08:00:00.000Z',
      datingDay: 4,
      datingDays: 14,
      unreadCount: 2,
      lastReadMessageId: null,
      lastMessage: {
        messageId: MSG_ID_1,
        conversationId: CONVERSATION_ID_1,
        senderId: PEER_USER_ID_1,
        kind: 'TEXT',
        systemCode: null,
        body: 'Xin chào',
        masked: false,
        clientMessageId: null,
        sentAt: '2026-11-24T08:00:00.000Z',
      },
    };

    const { client, queryClient, fakeChatClient } = buildInboxHarness({
      conversations: { items: [openConversation] },
      match: DEFAULT_MATCH,
    });

    const screen = await renderWithProviders(
      <ChatClientProvider client={fakeChatClient}>
        <InboxScreen />
      </ChatClientProvider>,
      { client, queryClient },
    );

    await waitFor(() => {
      expect(screen.getByTestId(`inbox-row-${CONVERSATION_ID_1}`)).toBeTruthy();
    });

    const forbiddenRegex = /chuyên viên|tư vấn|tương hợp|%|eKYC/i;
    expect(screen.queryByText(forbiddenRegex)).toBeNull();

    await screen.unmount();
  });

  it('e. lỗi 500 → retry', async () => {
    let shouldFail = true;

    const { client, queryClient, fakeChatClient } = buildInboxHarness({
      onGetConversations: () => {
        if (shouldFail) {
          return {
            status: 500,
            body: createProblemBody({ code: 'INTERNAL_ERROR', status: 500 }),
          };
        }
        return {
          status: 200,
          body: { items: [] },
        };
      },
    });

    const screen = await renderWithProviders(
      <ChatClientProvider client={fakeChatClient}>
        <InboxScreen />
      </ChatClientProvider>,
      { client, queryClient },
    );

    await waitFor(() => {
      expect(screen.getByText(messageFor({ code: 'INTERNAL_ERROR', status: 500 }).title)).toBeTruthy();
      expect(screen.getByText(INBOX_COPY.retry)).toBeTruthy();
    });

    // Sửa cờ lỗi và bấm retry
    shouldFail = false;
    await act(async () => {
      await fireEvent.press(screen.getByText(INBOX_COPY.retry));
    });

    await waitFor(() => {
      expect(screen.getByTestId('inbox-list')).toBeTruthy();
      expect(screen.getByText(INBOX_COPY.empty.title)).toBeTruthy();
    });

    await screen.unmount();
  });

  it('f. AC1 (tích hợp): dùng CHUNG queryClient + fake ChatClient: InboxScreen unread 3 → ChatScreen read 0 → InboxScreen không còn badge', async () => {
    const customQueryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
        mutations: { retry: false, gcTime: Infinity },
      },
    });
    const fakeChatClient = createFakeChatClient();

    let conversationsData: ConversationListResponse = {
      items: [
        {
          conversationId: CONVERSATION_ID_1,
          peerUserId: PEER_USER_ID_1,
          status: 'OPEN',
          openedAt: '2026-11-20T08:00:00.000Z',
          closesAt: '2026-12-04T08:00:00.000Z',
          datingDay: 4,
          datingDays: 14,
          unreadCount: 3,
          lastReadMessageId: null,
          lastMessage: {
            messageId: MSG_ID_1,
            conversationId: CONVERSATION_ID_1,
            senderId: PEER_USER_ID_1,
            kind: 'TEXT',
            systemCode: null,
            body: 'Chào bạn',
            masked: false,
            clientMessageId: null,
            sentAt: '2026-11-24T08:00:00.000Z',
          },
        },
      ],
    };

    let postReadCalled = false;

    const { client } = buildInboxHarness({
      onGetConversations: () => ({ status: 200, body: conversationsData }),
      match: DEFAULT_MATCH,
      onPostRead: () => {
        postReadCalled = true;
        conversationsData = {
          items: [
            {
              ...conversationsData.items[0]!,
              unreadCount: 0,
              lastReadMessageId: MSG_ID_1,
            },
          ],
        };
        return {
          status: 200,
          body: {
            conversationId: CONVERSATION_ID_1,
            lastReadMessageId: MSG_ID_1,
            readAt: '2026-11-24T08:05:00.000Z',
            unreadCount: 0,
          },
        };
      },
    });

    // 1. Render InboxScreen thấy unread 3
    const screen1 = await renderWithProviders(
      <ChatClientProvider client={fakeChatClient}>
        <InboxScreen />
      </ChatClientProvider>,
      { client, queryClient: customQueryClient },
    );

    await waitFor(() => {
      const badge = screen1.getByTestId(`inbox-unread-${CONVERSATION_ID_1}`);
      expect(badge).toBeTruthy();
      expect(screen1.getByText('3')).toBeTruthy();
    });

    // 2. Unmount InboxScreen
    await screen1.unmount();

    // 3. Render ChatScreen cùng conversation
    const chatScreen = await renderWithProviders(
      <ChatClientProvider client={fakeChatClient}>
        <ChatScreen conversationId={CONVERSATION_ID_1} />
      </ChatClientProvider>,
      { client, queryClient: customQueryClient },
    );

    // Chờ server nhận POST read và trả unreadCount 0
    await waitFor(() => {
      expect(postReadCalled).toBe(true);
    });

    // 4. Unmount ChatScreen
    await chatScreen.unmount();

    // Kiểm tra cache đã được cập nhật unreadCount: 0
    const cachedData = customQueryClient.getQueryData<ConversationListResponse>(CONVERSATIONS_QUERY_KEY);
    expect(cachedData?.items[0]?.unreadCount).toBe(0);

    // 5. Render lại InboxScreen: KHÔNG còn badge ngay cả khi GET /me/conversations chưa trả về lần mới
    const screen2 = await renderWithProviders(
      <ChatClientProvider client={fakeChatClient}>
        <InboxScreen />
      </ChatClientProvider>,
      { client, queryClient: customQueryClient },
    );

    // Badge không xuất hiện từ cache
    expect(screen2.queryByTestId(`inbox-unread-${CONVERSATION_ID_1}`)).toBeNull();

    // Khi refetch GET /me/conversations trả unread 0 vẫn không có badge
    await act(async () => {
      await customQueryClient.refetchQueries({ queryKey: CONVERSATIONS_QUERY_KEY });
    });

    expect(screen2.queryByTestId(`inbox-unread-${CONVERSATION_ID_1}`)).toBeNull();

    await screen2.unmount();
  });

  it('g. emit "message" → GET /me/conversations được gọi lại đúng 1 lần dù phát 3 sự kiện liên tiếp', async () => {
    let conversationsCallCount = 0;

    const { client, queryClient, fakeChatClient } = buildInboxHarness({
      onGetConversations: () => {
        conversationsCallCount++;
        return {
          status: 200,
          body: { items: [] },
        };
      },
    });

    const screen = await renderWithProviders(
      <ChatClientProvider client={fakeChatClient}>
        <InboxScreen />
      </ChatClientProvider>,
      { client, queryClient },
    );

    await waitFor(() => {
      expect(screen.getByTestId('inbox-list')).toBeTruthy();
    });
    expect(conversationsCallCount).toBe(1);

    const messageDto: ConversationMessageDto = {
      messageId: MSG_ID_1,
      conversationId: CONVERSATION_ID_1,
      senderId: PEER_USER_ID_1,
      kind: 'TEXT',
      systemCode: null,
      body: 'Tin nhắn 1',
      masked: false,
      clientMessageId: null,
      sentAt: '2026-11-24T08:00:00.000Z',
    };

    // Phát 3 sự kiện 'message' liên tiếp
    await act(async () => {
      fakeChatClient.emit({
        type: 'message',
        message: messageDto,
      });
      fakeChatClient.emit({
        type: 'message',
        message: { ...messageDto, messageId: MSG_ID_2, body: 'Tin nhắn 2' },
      });
      fakeChatClient.emit({
        type: 'message',
        message: { ...messageDto, messageId: MSG_ID_3, body: 'Tin nhắn 3' },
      });
    });

    // Chờ debounce 500ms hoàn thành và refetch
    await waitFor(
      () => {
        expect(conversationsCallCount).toBe(2);
      },
      { timeout: 2000 },
    );

    // Chờ thêm 300ms để đảm bảo không bị gọi thêm lần nào nữa
    await new Promise<void>((resolve) => setTimeout(() => resolve(), 300));
    expect(conversationsCallCount).toBe(2);

    await screen.unmount();
  });
});
