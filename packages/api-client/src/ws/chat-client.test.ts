import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { wsClientEventSchema, type ConversationMessageDto } from '@tamgiao/contracts/messaging';
import {
  CONNECT_TIMEOUT_MS,
  createChatClient,
  type ChatClient,
  type ChatClientEvent,
  type WebSocketLike,
} from './chat-client.js';

class FakeWebSocket implements WebSocketLike {
  sent: string[] = [];
  closeCode: number | null = null;
  closeReason: string | null = null;

  onopen: ((ev?: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason?: string }) => void) | null = null;
  onerror: ((ev?: unknown) => void) | null = null;

  send(data: string): void {
    this.sent.push(data);
  }

  close(code = 1000, reason?: string): void {
    this.closeCode = code;
    this.closeReason = reason ?? null;
    if (this.onclose) {
      this.onclose({ code, ...(reason ? { reason } : {}) });
    }
  }

  // Tiện ích giả lập server gửi frame xuống client
  receive(event: unknown): void {
    if (this.onmessage) {
      const data = typeof event === 'string' ? event : JSON.stringify(event);
      this.onmessage({ data });
    }
  }
}

describe('ChatClient WebSocket', () => {
  const wsUrl = 'wss://api.tamgiao.vn/ws';
  const testUserId = '01890a5d-ac96-774b-bcce-b302099a8001';
  const testConvId = '01890a5d-ac96-774b-bcce-b302099a8010';
  const testMessageId = '01890a5d-ac96-774b-bcce-b302099a8051';
  const fixedClientMessageId = '01890a5d-ac96-774b-bcce-b302099a8077';

  let fakeSockets: FakeWebSocket[] = [];
  let capturedHeaders: Array<Readonly<Record<string, string>>> = [];
  let capturedUrls: string[] = [];

  let tokenValue: string | null = 'test-access-token';
  let refreshCount = 0;
  let refreshErrorToThrow: unknown = null;

  function createTestClient(overrides: Partial<Parameters<typeof createChatClient>[0]> = {}): {
    client: ChatClient;
    events: ChatClientEvent[];
  } {
    const events: ChatClientEvent[] = [];
    const client = createChatClient({
      url: wsUrl,
      getAccessToken: async () => tokenValue,
      refreshSession: async () => {
        refreshCount++;
        if (refreshErrorToThrow) {
          throw refreshErrorToThrow;
        }
        tokenValue = 'refreshed-token';
      },
      createWebSocket: (url, headers) => {
        capturedUrls.push(url);
        capturedHeaders.push(headers);
        const ws = new FakeWebSocket();
        fakeSockets.push(ws);
        return ws;
      },
      createId: () => fixedClientMessageId,
      random: () => 1, // Để jitter = 1 (không có độ trễ ngẫu nhiên bất định)
      now: () => 1_700_000_000_000,
      ...overrides,
    });

    client.subscribe((e) => events.push(e));
    return { client, events };
  }

  function mockDto(overrides: Partial<ConversationMessageDto> = {}): ConversationMessageDto {
    return {
      messageId: testMessageId,
      conversationId: testConvId,
      senderId: testUserId,
      kind: 'TEXT',
      systemCode: null,
      body: 'Xin chào',
      masked: false,
      clientMessageId: fixedClientMessageId,
      sentAt: '2026-11-24T10:00:00.000Z',
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    fakeSockets = [];
    capturedHeaders = [];
    capturedUrls = [];
    tokenValue = 'test-access-token';
    refreshCount = 0;
    refreshErrorToThrow = null;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('gửi khi ready+joined → frame message.send đúng schema wsClientEventSchema; ack → hết pending, phát message', async () => {
    const { client, events } = createTestClient();
    client.connect();
    await vi.advanceTimersByTimeAsync(0);

    const socket = fakeSockets[0]!;
    expect(client.getState()).toBe('connecting');

    // Server gửi ready
    socket.receive({ type: 'ready', userId: testUserId });
    expect(client.getState()).toBe('ready');

    client.join(testConvId);
    expect(socket.sent).toContain(JSON.stringify({ type: 'conversation.join', conversationId: testConvId }));

    // Server xác nhận đã vào phòng
    socket.receive({ type: 'conversation.joined', conversationId: testConvId, status: 'OPEN' });

    // Gửi tin
    const cId = client.send(testConvId, 'Chào bạn');
    expect(cId).toBe(fixedClientMessageId);

    // Frame gửi đi phải đúng schema wsClientEventSchema
    expect(socket.sent).toHaveLength(2);
    const sentFrame = JSON.parse(socket.sent[1]!);
    const parsed = wsClientEventSchema.safeParse(sentFrame);
    expect(parsed.success).toBe(true);
    expect(sentFrame).toEqual({
      type: 'message.send',
      conversationId: testConvId,
      clientMessageId: fixedClientMessageId,
      body: 'Chào bạn',
    });

    // Lúc này pending đang có tin ở trạng thái 'sending'
    const pendingList = client.getPending(testConvId);
    expect(pendingList).toHaveLength(1);
    expect(pendingList[0]?.status).toBe('sending');

    // Server gửi ack
    const msgDto = mockDto({ body: 'Chào bạn' });
    socket.receive({
      type: 'message.ack',
      clientMessageId: fixedClientMessageId,
      duplicate: false,
      message: msgDto,
    });

    // Sau ack: pending sạch, event message được phát
    expect(client.getPending(testConvId)).toHaveLength(0);
    const messageEvent = events.find((e) => e.type === 'message');
    expect(messageEvent).toEqual({ type: 'message', message: msgDto });
  });

  it('AC1: gửi khi chưa kết nối → pending sending; kết nối + ready + joined → gửi; rớt mạng trước ack → nối lại → gửi lại CÙNG clientMessageId; ack duplicate:true → phát message 1 lần, hết pending, không trùng', async () => {
    const { client, events } = createTestClient();

    // 1. Gửi khi chưa kết nối
    const cId = client.send(testConvId, 'Tin nhắn gửi offline');
    expect(cId).toBe(fixedClientMessageId);
    expect(client.getPending(testConvId)[0]?.status).toBe('sending');

    // 2. Bắt đầu kết nối
    client.connect();
    await vi.advanceTimersByTimeAsync(0);
    const socket1 = fakeSockets[0]!;

    socket1.receive({ type: 'ready', userId: testUserId });
    // Tự động gửi conversation.join vì send đã tự join phòng
    expect(socket1.sent).toContain(JSON.stringify({ type: 'conversation.join', conversationId: testConvId }));

    // Server phản hồi joined OPEN
    socket1.receive({ type: 'conversation.joined', conversationId: testConvId, status: 'OPEN' });

    // Pending được gửi đi trên socket 1
    expect(socket1.sent).toContain(
      JSON.stringify({
        type: 'message.send',
        conversationId: testConvId,
        clientMessageId: fixedClientMessageId,
        body: 'Tin nhắn gửi offline',
      }),
    );

    // 3. Rớt mạng trước khi nhận được ack (mã đóng 1006 bất thường)
    socket1.close(1006, 'CONNECTION_LOST');
    expect(client.getState()).toBe('reconnecting');

    // Chờ backoff nhịp đầu (1000ms với random()=1)
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(0);

    expect(fakeSockets).toHaveLength(2);
    const socket2 = fakeSockets[1]!;

    // Socket 2 kết nối thành công, nhận ready và joined
    socket2.receive({ type: 'ready', userId: testUserId });
    socket2.receive({ type: 'conversation.joined', conversationId: testConvId, status: 'OPEN' });

    // Tin nhắn pending được gửi lại với CÙNG clientMessageId
    expect(socket2.sent).toContain(
      JSON.stringify({
        type: 'message.send',
        conversationId: testConvId,
        clientMessageId: fixedClientMessageId,
        body: 'Tin nhắn gửi offline',
      }),
    );

    // 4. Server phản hồi ack duplicate: true (tin đã được lưu ở lần trước nhưng mất ack)
    const msgDto = mockDto({ body: 'Tin nhắn gửi offline' });
    socket2.receive({
      type: 'message.ack',
      clientMessageId: fixedClientMessageId,
      duplicate: true,
      message: msgDto,
    });

    // Kết quả: hết pending, không bị trùng
    expect(client.getPending(testConvId)).toHaveLength(0);
    expect(events.filter((e) => e.type === 'message')).toHaveLength(1);
    const sentSends = [...socket1.sent, ...socket2.sent].filter((f) => f.includes('message.send'));
    expect(sentSends).toHaveLength(2);
  });

  it('nhiều pending giữ thứ tự; ack timeout → đóng + nối lại', async () => {
    let idCounter = 1;
    let timeCounter = 1000;
    const { client } = createTestClient({
      createId: () => `01890a5d-ac96-774b-bcce-b302099a807${idCounter++}`,
      now: () => (timeCounter += 100),
    });

    client.connect();
    await vi.advanceTimersByTimeAsync(0);
    const socket1 = fakeSockets[0]!;
    socket1.receive({ type: 'ready', userId: testUserId });
    client.join(testConvId);
    socket1.receive({ type: 'conversation.joined', conversationId: testConvId, status: 'OPEN' });

    client.send(testConvId, 'Tin 1');
    client.send(testConvId, 'Tin 2');
    client.send(testConvId, 'Tin 3');

    // Kiểm tra đúng thứ tự được gửi
    const sentFrames = socket1.sent.slice(1).map((s) => JSON.parse(s));
    expect(sentFrames.map((f: { body: string }) => f.body)).toEqual(['Tin 1', 'Tin 2', 'Tin 3']);

    // Quá ACK_TIMEOUT_MS = 15_000ms mà chưa có ack khi đang ready
    await vi.advanceTimersByTimeAsync(15_000);

    // Socket phải bị đóng với mã timeout để kích hoạt nối lại
    expect(socket1.closeCode).toBe(4000);
    expect(socket1.closeReason).toBe('ACK_TIMEOUT');
    expect(client.getState()).toBe('reconnecting');
  });

  it('backoff tăng 1s,2s,4s… trần 30s (random=()=>1), reset sau ready; reconnectNow', async () => {
    const { client } = createTestClient({ random: () => 1 });
    client.connect();
    await vi.advanceTimersByTimeAsync(0);
    expect(fakeSockets).toHaveLength(1);

    // Lần 1: đóng socket thường → backoff 1s (1000ms)
    fakeSockets[0]!.close(1006);
    expect(client.getState()).toBe('reconnecting');

    await vi.advanceTimersByTimeAsync(999);
    expect(fakeSockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(fakeSockets).toHaveLength(2);

    // Lần 2: đóng tiếp → backoff 2s (2000ms)
    fakeSockets[1]!.close(1006);
    await vi.advanceTimersByTimeAsync(1999);
    expect(fakeSockets).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(fakeSockets).toHaveLength(3);

    // Lần 3: đóng tiếp → backoff 4s (4000ms)
    fakeSockets[2]!.close(1006);
    await vi.advanceTimersByTimeAsync(3999);
    expect(fakeSockets).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(fakeSockets).toHaveLength(4);

    // Đang chờ backoff ở lần 4: gọi reconnectNow() → kết nối lại ngay lập tức và reset backoff
    fakeSockets[3]!.close(1006);
    expect(client.getState()).toBe('reconnecting');
    client.reconnectNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(fakeSockets).toHaveLength(5);

    // Sau khi nhận ready, bộ đếm backoff phải được reset về 0
    fakeSockets[4]!.receive({ type: 'ready', userId: testUserId });
    fakeSockets[4]!.close(1006);
    // Nhịp đóng tiếp theo quay về 1000ms
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(0);
    expect(fakeSockets).toHaveLength(6);
  });

  it('4401 → refreshSession 1 lần → token mới ở header; refresh lỗi 401 → signed_out không nối lại; 4401 liên tiếp → có backoff; token null → signed_out', async () => {
    const { client } = createTestClient();
    client.connect();
    await vi.advanceTimersByTimeAsync(0);

    const socket1 = fakeSockets[0]!;
    // Đóng với mã 4401 (TOKEN_EXPIRED)
    socket1.close(4401, 'TOKEN_EXPIRED');

    // Chờ refreshSession hoàn thành
    await vi.advanceTimersByTimeAsync(0);
    expect(refreshCount).toBe(1);
    expect(fakeSockets).toHaveLength(2);
    // Socket 2 mang header authorization mới
    expect(capturedHeaders[1]).toEqual({ authorization: 'Bearer refreshed-token' });

    // Trường hợp 4401 liên tiếp trước khi nhận ready: không lặp refreshSession tức thì mà chuyển sang backoff
    const socket2 = fakeSockets[1]!;
    socket2.close(4401, 'TOKEN_EXPIRED');
    await vi.advanceTimersByTimeAsync(0);
    expect(refreshCount).toBe(1); // Không gọi thêm refreshSession ngay
    expect(client.getState()).toBe('reconnecting');

    // Trường hợp refreshSession ném lỗi 401
    refreshErrorToThrow = { status: 401, message: 'Session expired' };
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(0);
    const socket3 = fakeSockets[2]!;
    // Sau khi có ready để reset cờ refresh
    socket3.receive({ type: 'ready', userId: testUserId });
    socket3.close(4401);
    await vi.advanceTimersByTimeAsync(0);
    expect(client.getState()).toBe('signed_out');

    // Trường hợp getAccessToken trả về null
    tokenValue = null;
    client.connect();
    await vi.advanceTimersByTimeAsync(0);
    expect(client.getState()).toBe('signed_out');
  });

  it('RATE_LIMITED → failed kèm meta; retry gửi lại cùng id; discard', async () => {
    const { client } = createTestClient();
    client.connect();
    await vi.advanceTimersByTimeAsync(0);
    const socket = fakeSockets[0]!;
    socket.receive({ type: 'ready', userId: testUserId });
    client.join(testConvId);
    socket.receive({ type: 'conversation.joined', conversationId: testConvId, status: 'OPEN' });

    const cId = client.send(testConvId, 'Tin nhắn quá nhanh');
    expect(socket.sent).toHaveLength(2);

    // Server phản hồi error RATE_LIMITED
    socket.receive({
      type: 'error',
      code: 'RATE_LIMITED',
      clientMessageId: cId,
      meta: { retryAfterSeconds: 60 },
    });

    const pending = client.getPending(testConvId);
    expect(pending[0]?.status).toBe('failed');
    expect(pending[0]?.error).toEqual({
      code: 'RATE_LIMITED',
      meta: { retryAfterSeconds: 60 },
    });

    // Thử lại với retry
    client.retry(cId);
    expect(client.getPending(testConvId)[0]?.status).toBe('sending');
    expect(client.getPending(testConvId)[0]?.error).toBeUndefined();
    // Đã gửi lại trên socket
    expect(socket.sent).toHaveLength(3);

    // Bỏ qua với discard
    client.discard(cId);
    expect(client.getPending(testConvId)).toHaveLength(0);
  });

  it('CONVERSATION_CLOSED → failed + conversation-error; joined CLOSED → pending failed', async () => {
    const { client, events } = createTestClient({
      createId: (() => {
        let n = 0;
        return () => `01890a5d-ac96-774b-bcce-b302099a807${n++}`;
      })(),
    });
    client.connect();
    await vi.advanceTimersByTimeAsync(0);
    const socket = fakeSockets[0]!;
    socket.receive({ type: 'ready', userId: testUserId });
    client.join(testConvId);
    socket.receive({ type: 'conversation.joined', conversationId: testConvId, status: 'OPEN' });

    const cId = client.send(testConvId, 'Tin nhắn vào phòng sắp đóng');

    // Server trả lỗi CONVERSATION_CLOSED
    socket.receive({
      type: 'error',
      code: 'CONVERSATION_CLOSED',
      clientMessageId: cId,
    });

    expect(client.getPending(testConvId)[0]?.status).toBe('failed');
    expect(client.getPending(testConvId)[0]?.error?.code).toBe('CONVERSATION_CLOSED');
    expect(events).toContainEqual({
      type: 'conversation-error',
      conversationId: testConvId,
      code: 'CONVERSATION_CLOSED',
    });

    // Khi nhận conversation.joined status CLOSED: các tin pending trong phòng chuyển thành failed
    const cId2 = client.send(testConvId, 'Tin nhắn mới');
    expect(client.getPending(testConvId).find((p) => p.clientMessageId === cId2)?.status).toBe('sending');

    socket.receive({
      type: 'conversation.joined',
      conversationId: testConvId,
      status: 'CLOSED',
    });

    expect(client.getPending(testConvId).find((p) => p.clientMessageId === cId2)?.status).toBe('failed');
    expect(client.getPending(testConvId).find((p) => p.clientMessageId === cId2)?.error?.code).toBe(
      'CONVERSATION_CLOSED',
    );
  });

  it('4403/NOT_PARTICIPANT → bỏ phòng, nối lại không join phòng đó', async () => {
    const { client, events } = createTestClient();
    client.connect();
    await vi.advanceTimersByTimeAsync(0);
    const socket1 = fakeSockets[0]!;
    socket1.receive({ type: 'ready', userId: testUserId });

    client.join(testConvId);
    expect(socket1.sent).toContain(JSON.stringify({ type: 'conversation.join', conversationId: testConvId }));

    // Server báo lỗi NOT_PARTICIPANT và ngắt kết nối với 4403
    socket1.receive({
      type: 'error',
      code: 'NOT_PARTICIPANT',
      conversationId: testConvId,
    });
    socket1.close(4403, 'NOT_PARTICIPANT');

    expect(events).toContainEqual({
      type: 'conversation-error',
      conversationId: testConvId,
      code: 'NOT_PARTICIPANT',
    });

    // Chờ nối lại
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(0);
    const socket2 = fakeSockets[1]!;

    socket2.receive({ type: 'ready', userId: testUserId });
    // socket 2 KHÔNG được gửi conversation.join cho phòng đó nữa
    expect(socket2.sent).toEqual([]);
  });

  it('heartbeat ping và timeout; frame rác (không JSON, sai schema) bị bỏ qua', async () => {
    const { client } = createTestClient();
    client.connect();
    await vi.advanceTimersByTimeAsync(0);
    const socket = fakeSockets[0]!;
    socket.receive({ type: 'ready', userId: testUserId });

    // Sau 25s gửi ping
    await vi.advanceTimersByTimeAsync(25_000);
    expect(socket.sent).toContain(JSON.stringify({ type: 'ping' }));

    // Nhận frame rác: chuỗi không phải JSON, JSON sai schema
    expect(() => {
      socket.receive('không phải json');
      socket.receive(JSON.stringify({ type: 'unknown_type' }));
    }).not.toThrow();

    // Quá 60s không có frame hợp lệ từ server → timeout đóng socket
    await vi.advanceTimersByTimeAsync(35_000); // Tổng 60s
    expect(socket.closeCode).toBe(4408);
    expect(socket.closeReason).toBe('HEARTBEAT_TIMEOUT');
  });

  it('disconnect xoá pending, không nối lại, sự kiện socket cũ bị bỏ qua; disconnect khi đang await token', async () => {
    const { client } = createTestClient();
    client.connect();
    await vi.advanceTimersByTimeAsync(0);
    const socket = fakeSockets[0]!;
    socket.receive({ type: 'ready', userId: testUserId });

    client.send(testConvId, 'Tin trước disconnect');
    expect(client.getPending(testConvId)).toHaveLength(1);

    client.disconnect();
    expect(client.getState()).toBe('idle');
    expect(socket.closeCode).toBe(1000);
    expect(client.getPending(testConvId)).toHaveLength(0);

    // Kích hoạt lại onclose trên socket cũ → không làm gì
    socket.close(1006);
    expect(client.getState()).toBe('idle');

    // Disconnect trong khi đang await getAccessToken
    let resolveToken: (token: string | null) => void;
    const tokenPromise = new Promise<string | null>((resolve) => {
      resolveToken = resolve;
    });

    const { client: client2 } = createTestClient({
      getAccessToken: () => tokenPromise,
    });

    client2.connect();
    client2.disconnect();
    resolveToken!('some-token');
    await vi.advanceTimersByTimeAsync(0);

    // Không mở socket mới nào sau khi đã disconnect
    expect(client2.getState()).toBe('idle');
  });

  it('confirm() xoá pending; getPending ổn định tham chiếu', async () => {
    const { client } = createTestClient();
    const cId = client.send(testConvId, 'Tin cần confirm');

    const ref1 = client.getPending(testConvId);
    const ref2 = client.getPending(testConvId);
    // Ổn định tham chiếu giữa các lần đọc không thay đổi
    expect(ref1).toBe(ref2);

    // Gọi confirm với message từ REST API có chứa clientMessageId
    const confirmedMsg = mockDto({ clientMessageId: cId });
    client.confirm([confirmedMsg]);

    expect(client.getPending(testConvId)).toHaveLength(0);
    expect(client.getPending(testConvId)).toBe(client.getPending(testConvId));
  });

  it('4401 lặp lại sau backoff → được refresh lại (token hết hạn khi mất mạng lâu), không refresh hai lần liền nhau', async () => {
    const { client } = createTestClient();
    client.connect();
    await vi.advanceTimersByTimeAsync(0);
    fakeSockets[0]!.close(4401, 'TOKEN_EXPIRED');
    await vi.advanceTimersByTimeAsync(0);
    fakeSockets[1]!.close(4401, 'TOKEN_EXPIRED');
    await vi.advanceTimersByTimeAsync(0);
    expect(refreshCount).toBe(1);
    expect(fakeSockets).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(1000);
    fakeSockets[2]!.close(4401, 'TOKEN_EXPIRED');
    await vi.advanceTimersByTimeAsync(0);
    expect(refreshCount).toBe(2);
    expect(fakeSockets).toHaveLength(4);
  });

  it('mở socket nhưng không nhận ready → bỏ socket sau CONNECT_TIMEOUT_MS và nối lại, kể cả khi close không phát', async () => {
    const { client } = createTestClient({
      createWebSocket: () => {
        const ws = new FakeWebSocket();
        ws.close = () => {
          // Mạng treo: `close` không bao giờ phát sự kiện.
        };
        fakeSockets.push(ws);
        return ws;
      },
    });
    client.connect();
    await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS);
    expect(client.getState()).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(1000);
    expect(fakeSockets).toHaveLength(2);
  });

  it('joined tới sau khi đã leave → bỏ qua, không gửi pending', async () => {
    const { client, events } = createTestClient();
    client.connect();
    await vi.advanceTimersByTimeAsync(0);
    const socket = fakeSockets[0]!;
    socket.receive({ type: 'ready', userId: testUserId });
    client.send(testConvId, 'Tin chờ');
    client.leave(testConvId);
    socket.receive({ type: 'conversation.joined', conversationId: testConvId, status: 'OPEN' });
    expect(events.some((e) => e.type === 'joined')).toBe(false);
    expect(socket.sent.some((f) => f.includes('message.send'))).toBe(false);
    expect(client.getPending(testConvId)).toHaveLength(1);
  });

  it('AC3: spy console.log/warn/error/info/debug không được gọi; URL không chứa token', async () => {
    const logSpy = vi.spyOn(console, 'log');
    const warnSpy = vi.spyOn(console, 'warn');
    const errorSpy = vi.spyOn(console, 'error');
    const infoSpy = vi.spyOn(console, 'info');
    const debugSpy = vi.spyOn(console, 'debug');

    const { client } = createTestClient();
    client.connect();
    await vi.advanceTimersByTimeAsync(0);

    const socket = fakeSockets[0]!;
    socket.receive('bad json');
    socket.receive(JSON.stringify({ type: 'invalid' }));
    socket.receive({ type: 'ready', userId: testUserId });
    client.send(testConvId, 'test log');
    socket.close(4401);
    await vi.advanceTimersByTimeAsync(0);

    // Tuyệt đối không log
    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
    expect(debugSpy).not.toHaveBeenCalled();

    // URL không được chứa token
    for (const url of capturedUrls) {
      expect(url).toBe(wsUrl);
      expect(url).not.toContain('test-access-token');
    }
  });
});
