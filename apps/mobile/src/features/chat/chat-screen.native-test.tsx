import { createApiClient, createMemoryTokenStore, messageFor } from '@tamgiao/api-client';
import { MESSAGE_MAX_LENGTH } from '@tamgiao/contracts/constants';
import type { CurrentMatchDto } from '@tamgiao/contracts/matching';
import type {
  ConversationListResponse,
  ConversationMessageDto,
  ConversationSummaryDto,
  IcebreakersResponse,
  MessagesAfterResponse,
} from '@tamgiao/contracts/messaging';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { createFakeChatClient, type FakeChatClient } from '../../test-utils/fake-chat-client.js';
import {
  createFakeFetch,
  createProblemBody,
  createTestQueryClient,
  renderWithProviders,
} from '../../test-utils/render-with-providers.js';
import { CONVERSATIONS_QUERY_KEY } from '../match/index.js';
import { ChatClientProvider } from './chat-client-context.js';
import { ChatScreen } from './chat-screen.js';
import { CHAT_COPY } from './copy.js';

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    back: mockBack,
    canGoBack: () => true,
  }),
  useLocalSearchParams: () => ({ conversationId: '01890a5d-ac96-774b-bcce-b302099a0001' }),
}));

const mockScreenCaptureProtection = jest.fn();
jest.mock('../security/use-screen-capture-protection', () => ({
  useScreenCaptureProtection: (...args: unknown[]) => mockScreenCaptureProtection(...args),
}));

const CONVERSATION_ID = '01890a5d-ac96-774b-bcce-b302099a0001';
const MY_USER_ID = '01890a5d-ac96-774b-bcce-b302099a0002';
const PEER_USER_ID = '01890a5d-ac96-774b-bcce-b302099a0003';
const MATCH_ID = '01890a5d-ac96-774b-bcce-b302099a0050';

const MSG_ID_1 = '01890a5d-ac96-774b-bcce-b302099a0011';
const MSG_ID_2 = '01890a5d-ac96-774b-bcce-b302099a0012';
const MSG_ID_3 = '01890a5d-ac96-774b-bcce-b302099a0013';
const MSG_ID_4 = '01890a5d-ac96-774b-bcce-b302099a0014';
const CLIENT_MSG_ID_2 = '01890a5d-ac96-774b-bcce-b302099a0092';

const DEFAULT_SUMMARY: ConversationSummaryDto = {
  conversationId: CONVERSATION_ID,
  peerUserId: PEER_USER_ID,
  status: 'OPEN',
  openedAt: '2026-11-20T00:00:00.000Z',
  closesAt: '2026-12-04T00:00:00.000Z',
  datingDay: 4,
  datingDays: 14,
  lastMessage: null,
  unreadCount: 0,
  lastReadMessageId: null,
};

const DEFAULT_MATCH: CurrentMatchDto = {
  matchId: MATCH_ID,
  status: 'DATING',
  phase: 'DATING',
  offeredAt: '2026-11-19T00:00:00.000Z',
  datingStartedAt: '2026-11-20T00:00:00.000Z',
  score: null,
  commonPoints: [],
  staffNote: null,
  counterpart: {
    userId: PEER_USER_ID,
    displayName: 'Minh Trang',
    age: 28,
    currentCity: 'TP. Hồ Chí Minh',
    occupation: 'Kiểm toán',
    education: 'bachelor',
    avatar: null,
  },
  expiresAt: '2026-12-04T00:00:00.000Z',
};

const MSG_1: ConversationMessageDto = {
  messageId: MSG_ID_1,
  conversationId: CONVERSATION_ID,
  senderId: PEER_USER_ID,
  kind: 'TEXT',
  systemCode: null,
  body: 'Chào Huy!',
  masked: false,
  clientMessageId: null,
  sentAt: '2026-11-24T08:00:00.000Z',
};

const MSG_2: ConversationMessageDto = {
  messageId: MSG_ID_2,
  conversationId: CONVERSATION_ID,
  senderId: MY_USER_ID,
  kind: 'TEXT',
  systemCode: null,
  body: 'Chào Trang!',
  masked: false,
  clientMessageId: CLIENT_MSG_ID_2,
  sentAt: '2026-11-24T08:05:00.000Z',
};

interface RecordedRequest {
  url: string;
  method: string;
  body: unknown;
}

interface BuildHarnessOptions {
  summary?: ConversationSummaryDto | null;
  match?: CurrentMatchDto | null;
  initialMessages?: ConversationMessageDto[];
  hasMoreMessages?: boolean;
  onGetMessages?: (url: string) => { status?: number; body?: unknown };
  onPostRead?: (body: unknown) => { status?: number; body?: unknown };
  icebreakers?: { status?: number; body?: unknown };
  chatClient?: FakeChatClient;
}

function buildChatHarness(options: BuildHarnessOptions = {}) {
  const recordedRequests: RecordedRequest[] = [];
  const fakeChatClient = options.chatClient ?? createFakeChatClient('ready');

  const fakeFetch = createFakeFetch((url, init) => {
    const method = init?.method ?? 'GET';
    let body: unknown = undefined;
    if (init?.body && typeof init.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    recordedRequests.push({ url, method, body });

    if (url === 'http://api.test/me/conversations' && method === 'GET') {
      const summaryItem = options.summary !== undefined ? options.summary : DEFAULT_SUMMARY;
      return {
        status: 200,
        body: { items: summaryItem ? [summaryItem] : [] } satisfies ConversationListResponse,
      };
    }

    if (url === 'http://api.test/me/match' && method === 'GET') {
      return {
        status: 200,
        body: { match: options.match !== undefined ? options.match : DEFAULT_MATCH },
      };
    }

    if (url.startsWith(`http://api.test/me/conversations/${CONVERSATION_ID}/messages`) && method === 'GET') {
      if (options.onGetMessages) {
        return options.onGetMessages(url);
      }
      return {
        status: 200,
        body: {
          items: options.initialMessages ?? [MSG_1, MSG_2],
          hasMore: options.hasMoreMessages ?? false,
        } satisfies MessagesAfterResponse,
      };
    }

    if (url === `http://api.test/me/conversations/${CONVERSATION_ID}/read` && method === 'POST') {
      if (options.onPostRead) {
        return options.onPostRead(body);
      }
      const messageId = (body as { messageId?: string })?.messageId ?? MSG_ID_2;
      return {
        status: 200,
        body: {
          conversationId: CONVERSATION_ID,
          lastReadMessageId: messageId,
          readAt: '2026-11-24T08:10:00.000Z',
          unreadCount: 0,
        },
      };
    }

    if (url === `http://api.test/me/conversations/${CONVERSATION_ID}/icebreakers` && method === 'GET') {
      if (options.icebreakers) {
        return options.icebreakers;
      }
      return {
        status: 200,
        body: {
          conversationId: CONVERSATION_ID,
          datingDay: 4,
          datingDays: 14,
          theme: 'Chủ đề sâu',
          topics: ['Kế hoạch 3 năm tới?', 'Thói quen tài chính'],
        } satisfies IcebreakersResponse,
      };
    }

    return { status: 404 };
  });

  const client = createApiClient({
    baseUrl: 'http://api.test',
    tokenStore: createMemoryTokenStore(),
    fetch: fakeFetch,
  });
  const queryClient = createTestQueryClient();

  return {
    client,
    queryClient,
    fakeChatClient,
    recordedRequests,
  };
}

describe('ChatScreen (FE-S4-04)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('a. render lịch sử + thanh "Ngày 4/14" + tên đối phương; mock expo-screen-capture được gọi', async () => {
    const { client, queryClient, fakeChatClient } = buildChatHarness();

    const screen = await renderWithProviders(
      <ChatClientProvider client={fakeChatClient}>
        <ChatScreen conversationId={CONVERSATION_ID} />
      </ChatClientProvider>,
      { client, queryClient },
    );

    // Tên đối phương + tuổi
    await waitFor(() => {
      expect(screen.getByText('Minh Trang, 28')).toBeTruthy();
    });

    // Thanh tiến trình Ngày 4/14
    expect(screen.getByTestId('chat-progress')).toBeTruthy();
    expect(screen.getByText(CHAT_COPY.progress.day(4, 14))).toBeTruthy();
    expect(screen.getByText(CHAT_COPY.progress.remaining(10))).toBeTruthy();

    // Lịch sử tin nhắn
    expect(screen.getByText('Chào Huy!')).toBeTruthy();
    expect(screen.getByText('Chào Trang!')).toBeTruthy();

    // mock useScreenCaptureProtection được gọi với 'chat'
    expect(mockScreenCaptureProtection).toHaveBeenCalledWith('chat');

    await screen.unmount();
  });

  it('b. AC2: tin realtime trùng messageId với lịch sử → chỉ hiện 1 lần; tin realtime mới → hiện; thứ tự đúng', async () => {
    const { client, queryClient, fakeChatClient } = buildChatHarness();

    const screen = await renderWithProviders(
      <ChatClientProvider client={fakeChatClient}>
        <ChatScreen conversationId={CONVERSATION_ID} />
      </ChatClientProvider>,
      { client, queryClient },
    );

    await waitFor(() => {
      expect(screen.getByText('Chào Trang!')).toBeTruthy();
    });

    // Realtime trùng messageId MSG_2
    await act(async () => {
      fakeChatClient.emit({
        type: 'message',
        message: MSG_2,
      });
    });

    expect(screen.getAllByText('Chào Trang!')).toHaveLength(1);

    // Tin realtime mới MSG_3
    const MSG_3: ConversationMessageDto = {
      messageId: MSG_ID_3,
      conversationId: CONVERSATION_ID,
      senderId: PEER_USER_ID,
      kind: 'TEXT',
      systemCode: null,
      body: 'Chiều nay Huy có rảnh không?',
      masked: false,
      clientMessageId: null,
      sentAt: '2026-11-24T08:15:00.000Z',
    };

    await act(async () => {
      fakeChatClient.emit({
        type: 'message',
        message: MSG_3,
      });
    });

    await waitFor(() => {
      expect(screen.getByText('Chiều nay Huy có rảnh không?')).toBeTruthy();
    });

    const flatList = screen.getByTestId('chat-list');
    expect(flatList.props.data[0].messageId).toBe(MSG_ID_3);
    expect(flatList.props.data[1].messageId).toBe(MSG_ID_2);
    expect(flatList.props.data[2].messageId).toBe(MSG_ID_1);

    await screen.unmount();
  });

  it('c. AC1: gửi → client.send được gọi với text đã trim, ô nhập trống; pending "sending" hiện "Đang gửi"; sau ack chỉ còn 1 bubble', async () => {
    const { client, queryClient, fakeChatClient } = buildChatHarness();

    const screen = await renderWithProviders(
      <ChatClientProvider client={fakeChatClient}>
        <ChatScreen conversationId={CONVERSATION_ID} />
      </ChatClientProvider>,
      { client, queryClient },
    );

    await waitFor(() => {
      expect(screen.getByTestId('chat-input')).toBeTruthy();
    });

    const input = screen.getByTestId('chat-input');
    await act(async () => {
      await fireEvent.changeText(input, '   Mình rảnh nhé!   ');
    });

    const sendBtn = screen.getByTestId('chat-send');
    await waitFor(() => {
      expect(screen.getByTestId('chat-send').props.accessibilityState.disabled).toBe(false);
    });

    await act(async () => {
      await fireEvent.press(sendBtn);
    });

    expect(fakeChatClient.sent).toHaveLength(1);
    expect(fakeChatClient.sent[0]?.body).toBe('Mình rảnh nhé!');
    expect(screen.getByTestId('chat-input').props.value).toBe('');

    // Pending "sending" hiện Đang gửi
    expect(screen.getByText('Mình rảnh nhé!')).toBeTruthy();
    expect(screen.getByText(CHAT_COPY.bubble.sending)).toBeTruthy();

    const sentClientMsgId = fakeChatClient.sent[0]!.clientMessageId;

    // Server ack: emit message + xoá pending
    const ackMessage: ConversationMessageDto = {
      messageId: MSG_ID_3,
      conversationId: CONVERSATION_ID,
      senderId: MY_USER_ID,
      kind: 'TEXT',
      systemCode: null,
      body: 'Mình rảnh nhé!',
      masked: false,
      clientMessageId: sentClientMsgId,
      sentAt: '2026-11-24T08:20:00.000Z',
    };

    await act(async () => {
      fakeChatClient.emit({ type: 'message', message: ackMessage });
      fakeChatClient.setPending(CONVERSATION_ID, []);
    });

    // Chỉ còn 1 bubble cho tin nhắn, nhãn "Đang gửi" biến mất
    expect(screen.getAllByText('Mình rảnh nhé!')).toHaveLength(1);
    expect(screen.queryByText(CHAT_COPY.bubble.sending)).toBeNull();

    await screen.unmount();
  });

  it('d. pending có clientMessageId đã nằm trong lịch sử → không nhân đôi; client.confirm được gọi với tin REST', async () => {
    const fakeChatClient = createFakeChatClient('ready');
    // Giả lập pending còn lưu MSG_2 (có clientMessageId trùng với MSG_2 từ REST)
    fakeChatClient.setPending(CONVERSATION_ID, [
      {
        clientMessageId: CLIENT_MSG_ID_2,
        conversationId: CONVERSATION_ID,
        body: 'Chào Trang!',
        createdAt: Date.now(),
        status: 'sending',
      },
    ]);

    const { client, queryClient } = buildChatHarness({ chatClient: fakeChatClient });

    const screen = await renderWithProviders(
      <ChatClientProvider client={fakeChatClient}>
        <ChatScreen conversationId={CONVERSATION_ID} />
      </ChatClientProvider>,
      { client, queryClient },
    );

    await waitFor(() => {
      expect(screen.getByText('Chào Trang!')).toBeTruthy();
    });

    // Không bị nhân đôi
    expect(screen.getAllByText('Chào Trang!')).toHaveLength(1);
    expect(fakeChatClient.confirmed.length).toBeGreaterThan(0);

    await screen.unmount();
  });

  it('e. failed RATE_LIMITED meta { retryAfterSeconds: 10 } → title lỗi + nút Gửi lại gọi retry, Xoá gọi discard', async () => {
    const fakeChatClient = createFakeChatClient('ready');
    const failedClientMsgId = '01890a5d-ac96-774b-bcce-b302099a0095';
    fakeChatClient.setPending(CONVERSATION_ID, [
      {
        clientMessageId: failedClientMsgId,
        conversationId: CONVERSATION_ID,
        body: 'Tin bị chậm mạng',
        createdAt: Date.now(),
        status: 'failed',
        error: {
          code: 'RATE_LIMITED',
          meta: { retryAfterSeconds: 10 },
        },
      },
    ]);

    const { client, queryClient } = buildChatHarness({ chatClient: fakeChatClient });

    const screen = await renderWithProviders(
      <ChatClientProvider client={fakeChatClient}>
        <ChatScreen conversationId={CONVERSATION_ID} />
      </ChatClientProvider>,
      { client, queryClient },
    );

    await waitFor(() => {
      expect(screen.getByText('Tin bị chậm mạng')).toBeTruthy();
    });

    expect(screen.getByText(messageFor({ code: 'RATE_LIMITED' }).title)).toBeTruthy();

    // Nút Gửi lại gọi client.retry
    const retryBtn = screen.getByTestId(`chat-retry-${failedClientMsgId}`);
    await act(async () => {
      await fireEvent.press(retryBtn);
    });
    expect(fakeChatClient.retried).toContain(failedClientMsgId);

    // Nút Xoá gọi client.discard (gửi lại vẫn lỗi)
    await act(async () => {
      fakeChatClient.setPending(CONVERSATION_ID, [
        {
          clientMessageId: failedClientMsgId,
          conversationId: CONVERSATION_ID,
          body: 'Tin bị chậm mạng',
          createdAt: Date.now(),
          status: 'failed',
          error: { code: 'RATE_LIMITED', meta: { retryAfterSeconds: 10 } },
        },
      ]);
    });
    const discardBtn = screen.getByTestId(`chat-discard-${failedClientMsgId}`);
    await act(async () => {
      await fireEvent.press(discardBtn);
    });
    expect(fakeChatClient.discarded).toContain(failedClientMsgId);

    await screen.unmount();
  });

  it('f. quá MESSAGE_MAX_LENGTH → không gửi, hiện lỗi; toàn khoảng trắng → nút disabled', async () => {
    const { client, queryClient, fakeChatClient } = buildChatHarness();

    const screen = await renderWithProviders(
      <ChatClientProvider client={fakeChatClient}>
        <ChatScreen conversationId={CONVERSATION_ID} />
      </ChatClientProvider>,
      { client, queryClient },
    );

    await waitFor(() => {
      expect(screen.getByTestId('chat-input')).toBeTruthy();
    });

    const input = screen.getByTestId('chat-input');

    // Toàn khoảng trắng → disabled
    await act(async () => {
      await fireEvent.changeText(input, '     ');
    });
    expect(screen.getByTestId('chat-send').props.accessibilityState.disabled).toBe(true);

    // Quá MESSAGE_MAX_LENGTH
    const overText = 'A'.repeat(MESSAGE_MAX_LENGTH + 1);
    await act(async () => {
      await fireEvent.changeText(input, overText);
    });

    expect(screen.getByTestId('chat-send').props.accessibilityState.disabled).toBe(true);
    // Hiện thông báo lỗi
    expect(
      screen.getByText(
        messageFor({ code: 'MESSAGE_TOO_LONG', meta: { maxLength: MESSAGE_MAX_LENGTH } }).title,
      ),
    ).toBeTruthy();
    expect(fakeChatClient.sent).toHaveLength(0);

    await screen.unmount();
  });

  it('g. status CLOSED → chat-readonly, không có chat-input; joined CLOSED khi đang mở → chuyển chỉ đọc', async () => {
    // 1. Mở màn với status CLOSED sẵn
    const {
      client: clientA,
      queryClient: qcA,
      fakeChatClient: fakeA,
    } = buildChatHarness({
      summary: { ...DEFAULT_SUMMARY, status: 'CLOSED' },
    });

    const screenA = await renderWithProviders(
      <ChatClientProvider client={fakeA}>
        <ChatScreen conversationId={CONVERSATION_ID} />
      </ChatClientProvider>,
      { client: clientA, queryClient: qcA },
    );

    await waitFor(() => {
      expect(screenA.getByTestId('chat-readonly')).toBeTruthy();
    });
    expect(screenA.queryByTestId('chat-input')).toBeNull();
    await screenA.unmount();

    // 2. Mở màn OPEN, sau đó server emit joined CLOSED
    const { client: clientB, queryClient: qcB, fakeChatClient: fakeB } = buildChatHarness();
    const screenB = await renderWithProviders(
      <ChatClientProvider client={fakeB}>
        <ChatScreen conversationId={CONVERSATION_ID} />
      </ChatClientProvider>,
      { client: clientB, queryClient: qcB },
    );

    await waitFor(() => {
      expect(screenB.getByTestId('chat-input')).toBeTruthy();
    });

    await act(async () => {
      fakeB.emit({
        type: 'joined',
        conversationId: CONVERSATION_ID,
        status: 'CLOSED',
      });
    });

    await waitFor(() => {
      expect(screenB.getByTestId('chat-readonly')).toBeTruthy();
      expect(screenB.queryByTestId('chat-input')).toBeNull();
    });

    await screenB.unmount();
  });

  it('h. đã đọc: POST read với messageId tin cuối đúng 1 lần; tin mới tới → POST tiếp; unreadCount trong cache về đúng giá trị server trả', async () => {
    const { client, queryClient, fakeChatClient, recordedRequests } = buildChatHarness({
      summary: { ...DEFAULT_SUMMARY, unreadCount: 3, lastReadMessageId: MSG_ID_1 },
    });

    const screen = await renderWithProviders(
      <ChatClientProvider client={fakeChatClient}>
        <ChatScreen conversationId={CONVERSATION_ID} />
      </ChatClientProvider>,
      { client, queryClient },
    );

    await waitFor(() => {
      expect(screen.getByText('Chào Trang!')).toBeTruthy();
    });

    // POST read với messageId MSG_ID_2 đúng 1 lần
    const readRequests1 = recordedRequests.filter(
      (r) => r.url === `http://api.test/me/conversations/${CONVERSATION_ID}/read` && r.method === 'POST',
    );
    expect(readRequests1).toHaveLength(1);
    expect((readRequests1[0]?.body as { messageId?: string })?.messageId).toBe(MSG_ID_2);

    // Tin mới MSG_3 tới
    const MSG_3: ConversationMessageDto = {
      messageId: MSG_ID_3,
      conversationId: CONVERSATION_ID,
      senderId: PEER_USER_ID,
      kind: 'TEXT',
      systemCode: null,
      body: 'Tin mới từ Trang',
      masked: false,
      clientMessageId: null,
      sentAt: '2026-11-24T08:30:00.000Z',
    };

    await act(async () => {
      fakeChatClient.emit({ type: 'message', message: MSG_3 });
    });

    await waitFor(() => {
      const readRequests2 = recordedRequests.filter(
        (r) => r.url === `http://api.test/me/conversations/${CONVERSATION_ID}/read` && r.method === 'POST',
      );
      expect(readRequests2).toHaveLength(2);
      expect((readRequests2[1]?.body as { messageId?: string })?.messageId).toBe(MSG_ID_3);
    });

    const cached = queryClient.getQueryData<ConversationListResponse>(CONVERSATIONS_QUERY_KEY);
    expect(cached?.items[0]?.unreadCount).toBe(0);
    expect(cached?.items[0]?.lastReadMessageId).toBe(MSG_ID_3);

    await screen.unmount();
  });

  it('i. "read" của đối phương → "Đã đọc"', async () => {
    const { client, queryClient, fakeChatClient } = buildChatHarness();

    const screen = await renderWithProviders(
      <ChatClientProvider client={fakeChatClient}>
        <ChatScreen conversationId={CONVERSATION_ID} />
      </ChatClientProvider>,
      { client, queryClient },
    );

    await waitFor(() => {
      expect(screen.getByText('Chào Trang!')).toBeTruthy();
    });

    expect(screen.queryByText(CHAT_COPY.bubble.read)).toBeNull();

    // Đối phương đọc tới MSG_2
    await act(async () => {
      fakeChatClient.emit({
        type: 'read',
        conversationId: CONVERSATION_ID,
        readerId: PEER_USER_ID,
        messageId: MSG_ID_2,
        readAt: '2026-11-24T08:15:00.000Z',
      });
    });

    await waitFor(() => {
      expect(screen.getByText(CHAT_COPY.bubble.read)).toBeTruthy();
    });

    await screen.unmount();
  });

  it('j. nối lại: emit joined lần 2 → GET after=<id cuối> và hiện tin bị lỡ; hasMore true → gọi tiếp', async () => {
    let callCount = 0;
    const { client, queryClient, fakeChatClient } = buildChatHarness({
      onGetMessages: (url) => {
        if (url.includes('after=')) {
          callCount++;
          if (callCount === 1) {
            return {
              status: 200,
              body: {
                items: [
                  {
                    messageId: MSG_ID_3,
                    conversationId: CONVERSATION_ID,
                    senderId: PEER_USER_ID,
                    kind: 'TEXT' as const,
                    systemCode: null,
                    body: 'Tin bị lỡ trang 1',
                    masked: false,
                    clientMessageId: null,
                    sentAt: '2026-11-24T08:25:00.000Z',
                  },
                ],
                hasMore: true,
              },
            };
          }
          return {
            status: 200,
            body: {
              items: [
                {
                  messageId: MSG_ID_4,
                  conversationId: CONVERSATION_ID,
                  senderId: PEER_USER_ID,
                  kind: 'TEXT' as const,
                  systemCode: null,
                  body: 'Tin bị lỡ trang 2',
                  masked: false,
                  clientMessageId: null,
                  sentAt: '2026-11-24T08:26:00.000Z',
                },
              ],
              hasMore: false,
            },
          };
        }
        return {
          status: 200,
          body: {
            items: [MSG_1, MSG_2],
            hasMore: false,
          },
        };
      },
    });

    const screen = await renderWithProviders(
      <ChatClientProvider client={fakeChatClient}>
        <ChatScreen conversationId={CONVERSATION_ID} />
      </ChatClientProvider>,
      { client, queryClient },
    );

    await waitFor(() => {
      expect(screen.getByText('Chào Trang!')).toBeTruthy();
    });

    // Nối lại: phát joined lần 2
    await act(async () => {
      fakeChatClient.emit({
        type: 'joined',
        conversationId: CONVERSATION_ID,
        status: 'OPEN',
      });
    });

    await waitFor(() => {
      expect(screen.getByText('Tin bị lỡ trang 1')).toBeTruthy();
      expect(screen.getByText('Tin bị lỡ trang 2')).toBeTruthy();
    });
    expect(callCount).toBe(2);

    await screen.unmount();
  });

  it('j2. joined tới trước khi trang đầu tải xong → sau khi tải xong vẫn lấy bù một lần', async () => {
    const afterUrls: string[] = [];
    const { client, queryClient, fakeChatClient } = buildChatHarness({
      onGetMessages: (url) => {
        if (url.includes('after=')) {
          afterUrls.push(url);
          return {
            status: 200,
            body: { items: [{ ...MSG_1, messageId: MSG_ID_3, body: 'Tin chen giữa' }], hasMore: false },
          };
        }
        return { status: 200, body: { items: [MSG_1, MSG_2], hasMore: false } };
      },
    });
    // Phòng được xác nhận ngay lúc join (đồng bộ) — trước khi REST trả trang đầu.
    const join = fakeChatClient.join.bind(fakeChatClient);
    fakeChatClient.join = (id: string) => {
      join(id);
      void Promise.resolve().then(() =>
        fakeChatClient.emit({ type: 'joined', conversationId: id, status: 'OPEN' }),
      );
    };

    const screen = await renderWithProviders(
      <ChatClientProvider client={fakeChatClient}>
        <ChatScreen conversationId={CONVERSATION_ID} />
      </ChatClientProvider>,
      { client, queryClient },
    );

    await waitFor(() => {
      expect(screen.getByText('Tin chen giữa')).toBeTruthy();
    });
    expect(afterUrls).toHaveLength(1);
    expect(afterUrls[0]).toContain(`after=${MSG_ID_2}`);

    await screen.unmount();
  });

  it('k. cuộn lên: onEndReached → GET before=<id đầu>, hiện tin cũ; hasMore false → không gọi nữa', async () => {
    let beforeCalls = 0;
    const { client, queryClient, fakeChatClient } = buildChatHarness({
      initialMessages: [MSG_2],
      hasMoreMessages: true,
      onGetMessages: (url) => {
        if (url.includes('before=')) {
          beforeCalls++;
          return {
            status: 200,
            body: {
              items: [MSG_1],
              hasMore: false,
            },
          };
        }
        return {
          status: 200,
          body: {
            items: [MSG_2],
            hasMore: true,
          },
        };
      },
    });

    const screen = await renderWithProviders(
      <ChatClientProvider client={fakeChatClient}>
        <ChatScreen conversationId={CONVERSATION_ID} />
      </ChatClientProvider>,
      { client, queryClient },
    );

    await waitFor(() => {
      expect(screen.getByText('Chào Trang!')).toBeTruthy();
    });

    const list = screen.getByTestId('chat-list');
    await act(async () => {
      await fireEvent(list, 'endReached');
    });

    await waitFor(() => {
      expect(screen.getByText('Chào Huy!')).toBeTruthy();
    });
    expect(beforeCalls).toBe(1);

    // hasMore giờ đã false, gọi lại onEndReached không fetch thêm
    await act(async () => {
      await fireEvent(list, 'endReached');
    });
    expect(beforeCalls).toBe(1);

    await screen.unmount();
  });

  it('l. FRAUD_WARNING hiện cảnh báo; masked hiện chú thích', async () => {
    const fraudMsg: ConversationMessageDto = {
      messageId: MSG_ID_3,
      conversationId: CONVERSATION_ID,
      senderId: null,
      kind: 'SYSTEM',
      systemCode: 'FRAUD_WARNING',
      body: 'Cảnh báo: Không chuyển tiền cho người lạ dưới mọi hình thức',
      masked: false,
      clientMessageId: null,
      sentAt: '2026-11-24T08:40:00.000Z',
    };

    const maskedMsg: ConversationMessageDto = {
      messageId: MSG_ID_4,
      conversationId: CONVERSATION_ID,
      senderId: PEER_USER_ID,
      kind: 'TEXT',
      systemCode: null,
      body: 'SĐT của mình là ***',
      masked: true,
      clientMessageId: null,
      sentAt: '2026-11-24T08:45:00.000Z',
    };

    const { client, queryClient, fakeChatClient } = buildChatHarness({
      initialMessages: [MSG_1, fraudMsg, maskedMsg],
    });

    const screen = await renderWithProviders(
      <ChatClientProvider client={fakeChatClient}>
        <ChatScreen conversationId={CONVERSATION_ID} />
      </ChatClientProvider>,
      { client, queryClient },
    );

    await waitFor(() => {
      expect(screen.getByTestId('chat-fraud-warning')).toBeTruthy();
      expect(screen.getByText('Cảnh báo: Không chuyển tiền cho người lạ dưới mọi hình thức')).toBeTruthy();
      expect(screen.getByText(CHAT_COPY.bubble.maskedNotice)).toBeTruthy();
    });

    await screen.unmount();
  });

  it('m. icebreaker bấm → điền ô nhập; API lỗi 500 → không có khối', async () => {
    // 1. Thành công: bấm chip điền ô nhập
    const { client: clientA, queryClient: qcA, fakeChatClient: fakeA } = buildChatHarness();
    const screenA = await renderWithProviders(
      <ChatClientProvider client={fakeA}>
        <ChatScreen conversationId={CONVERSATION_ID} />
      </ChatClientProvider>,
      { client: clientA, queryClient: qcA },
    );

    await waitFor(() => {
      expect(screenA.getByText('Kế hoạch 3 năm tới?')).toBeTruthy();
    });

    const chip = screenA.getByText('Kế hoạch 3 năm tới?');
    await act(async () => {
      await fireEvent.press(chip);
    });

    const input = screenA.getByTestId('chat-input');
    expect(input.props.value).toBe('Kế hoạch 3 năm tới?');
    await screenA.unmount();

    // 2. Lỗi 500 → không có khối
    const {
      client: clientB,
      queryClient: qcB,
      fakeChatClient: fakeB,
    } = buildChatHarness({
      icebreakers: {
        status: 500,
        body: createProblemBody({ code: 'INTERNAL_ERROR', status: 500, title: 'Lỗi server' }),
      },
    });

    const screenB = await renderWithProviders(
      <ChatClientProvider client={fakeB}>
        <ChatScreen conversationId={CONVERSATION_ID} />
      </ChatClientProvider>,
      { client: clientB, queryClient: qcB },
    );

    await waitFor(() => {
      expect(screenB.getByTestId('chat-input')).toBeTruthy();
    });
    expect(screenB.queryByText('Kế hoạch 3 năm tới?')).toBeNull();

    await screenB.unmount();
  });

  it('n. banner kết nối khi reconnecting', async () => {
    const { client, queryClient, fakeChatClient } = buildChatHarness();

    const screen = await renderWithProviders(
      <ChatClientProvider client={fakeChatClient}>
        <ChatScreen conversationId={CONVERSATION_ID} />
      </ChatClientProvider>,
      { client, queryClient },
    );

    await waitFor(() => {
      expect(screen.getByTestId('chat-input')).toBeTruthy();
    });

    await act(async () => {
      fakeChatClient.setState('reconnecting');
    });

    await waitFor(() => {
      expect(screen.getByText(CHAT_COPY.connection.reconnecting)).toBeTruthy();
    });

    await screen.unmount();
  });

  it('o. forbidden → EmptyState. unmount → client.leave', async () => {
    const { client, queryClient, fakeChatClient } = buildChatHarness();

    const screen = await renderWithProviders(
      <ChatClientProvider client={fakeChatClient}>
        <ChatScreen conversationId={CONVERSATION_ID} />
      </ChatClientProvider>,
      { client, queryClient },
    );

    await waitFor(() => {
      expect(screen.getByTestId('chat-input')).toBeTruthy();
    });

    await act(async () => {
      fakeChatClient.emit({
        type: 'conversation-error',
        conversationId: CONVERSATION_ID,
        code: 'NOT_PARTICIPANT',
      });
    });

    await waitFor(() => {
      expect(screen.getByText(CHAT_COPY.empty.title)).toBeTruthy();
    });

    await screen.unmount();
    expect(fakeChatClient.left).toContain(CONVERSATION_ID);
  });

  it('p. AC3: spy console.* không bị gọi với nội dung tin', async () => {
    const spyLog = jest.spyOn(console, 'log').mockImplementation(() => {});
    const spyInfo = jest.spyOn(console, 'info').mockImplementation(() => {});
    const spyWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const spyError = jest.spyOn(console, 'error').mockImplementation(() => {});

    const secretText = 'BiMatKhongGhiVaoLog123';
    const { client, queryClient, fakeChatClient } = buildChatHarness();

    const screen = await renderWithProviders(
      <ChatClientProvider client={fakeChatClient}>
        <ChatScreen conversationId={CONVERSATION_ID} />
      </ChatClientProvider>,
      { client, queryClient },
    );

    await waitFor(() => {
      expect(screen.getByTestId('chat-input')).toBeTruthy();
    });

    const input = screen.getByTestId('chat-input');
    await act(async () => {
      await fireEvent.changeText(input, secretText);
    });

    const sendBtn = screen.getByTestId('chat-send');
    await act(async () => {
      await fireEvent.press(sendBtn);
    });

    const calls = [
      ...spyLog.mock.calls,
      ...spyInfo.mock.calls,
      ...spyWarn.mock.calls,
      ...spyError.mock.calls,
    ];

    for (const call of calls) {
      const serialized = JSON.stringify(call);
      expect(serialized).not.toContain(secretText);
    }

    spyLog.mockRestore();
    spyInfo.mockRestore();
    spyWarn.mockRestore();
    spyError.mockRestore();

    await screen.unmount();
  });
});
