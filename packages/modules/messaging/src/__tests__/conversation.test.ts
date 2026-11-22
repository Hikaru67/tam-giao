import { MESSAGE_MAX_LENGTH, MESSAGE_RATE_LIMIT_PER_MINUTE } from '@tamgiao/contracts/constants';
import { addDuration, newId } from '@tamgiao/kernel';
import { describe, expect, it } from 'vitest';
import { Conversation } from '../domain/conversation.js';
import { Message, SYSTEM_MESSAGE_TEXT } from '../domain/message.js';
import {
  PASS_THROUGH_SCREENER,
  checkMessageRateLimit,
  messageRateWindowStart,
  parseMessageBody,
  type MessageBody,
  type MessageScreening,
} from '../domain/message-policy.js';

const T0 = new Date('2026-06-01T08:00:00.000Z');
const CLOSES = addDuration(T0, { days: 14 });
const A = newId<'User'>();
const B = newId<'User'>();
const OUTSIDER = newId<'User'>();
const MATCH = newId<'Match'>();

const open = (): Conversation => {
  const c = Conversation.open(
    { id: newId<'Conversation'>(), matchId: MATCH, participants: [A, B], openedAt: T0, closesAt: CLOSES },
    T0,
  );
  c.pullEvents();
  return c;
};

const body = (raw: string): MessageBody => {
  const r = parseMessageBody(raw);
  if (r.isErr()) throw new Error(r.error.code);
  return r.value;
};

describe('Conversation.open', () => {
  it('mở OPEN, giữ hạn, phát ConversationOpened (version 1, id chữ thường)', () => {
    const id = newId<'Conversation'>();
    const c = Conversation.open(
      {
        id,
        matchId: MATCH.toUpperCase(),
        participants: [A.toUpperCase(), B],
        openedAt: T0,
        closesAt: CLOSES,
      },
      T0,
    );
    expect(c.toState()).toMatchObject({
      status: 'OPEN',
      matchId: MATCH,
      participants: [A, B],
      openedAt: T0,
      closesAt: CLOSES,
      closedAt: null,
      closeReason: null,
      version: 1,
    });
    const [event, ...rest] = c.pullEvents();
    expect(rest).toHaveLength(0);
    expect(event).toMatchObject({
      type: 'ConversationOpened',
      aggregateType: 'Conversation',
      aggregateId: id,
      version: 1,
      payload: { conversationId: id, matchId: MATCH, participantIds: [A, B], closesAt: CLOSES.toISOString() },
    });
  });

  it('cùng một người hai lần hoặc closesAt không sau openedAt → lỗi lập trình', () => {
    const base = { id: newId<'Conversation'>(), matchId: MATCH, openedAt: T0 };
    expect(() => Conversation.open({ ...base, participants: [A, A], closesAt: CLOSES }, T0)).toThrow();
    expect(() => Conversation.open({ ...base, participants: [A, B], closesAt: T0 }, T0)).toThrow();
  });
});

describe('Conversation.ensureCanSend', () => {
  it('participant gửi khi OPEN và trước closesAt → ok (không phân biệt hoa thường)', () => {
    const c = open();
    expect(c.ensureCanSend(A, T0).isOk()).toBe(true);
    expect(c.ensureCanSend(B.toUpperCase(), addDuration(CLOSES, { milliseconds: -1 })).isOk()).toBe(true);
  });

  it('người ngoài cặp → NOT_PARTICIPANT, kể cả khi hội thoại đã đóng (không lộ trạng thái)', () => {
    const c = open();
    expect(c.ensureCanSend(OUTSIDER, T0)).toMatchObject({ error: { code: 'NOT_PARTICIPANT' } });
    c.close('MATCH_LOCKED', T0);
    expect(c.ensureCanSend(OUTSIDER, T0)).toMatchObject({ error: { code: 'NOT_PARTICIPANT' } });
  });

  it('CLOSED → CONVERSATION_CLOSED{reason: CLOSED}', () => {
    const c = open();
    c.close('MATCH_CLOSED', T0);
    expect(c.ensureCanSend(A, T0)).toMatchObject({
      error: { code: 'CONVERSATION_CLOSED', details: { reason: 'CLOSED' } },
    });
  });

  it('đúng biên closesAt (và sau đó) → CONVERSATION_CLOSED{reason: PERIOD_ENDED}', () => {
    const c = open();
    for (const at of [CLOSES, addDuration(CLOSES, { hours: 1 })]) {
      expect(c.ensureCanSend(A, at)).toMatchObject({
        error: { code: 'CONVERSATION_CLOSED', details: { reason: 'PERIOD_ENDED' } },
      });
    }
  });
});

describe('Conversation.close', () => {
  it('OPEN → CLOSED, phát ConversationClosed với lý do', () => {
    const c = open();
    const at = addDuration(T0, { days: 2 });
    expect(c.close('MATCH_LOCKED', at)).toBe(true);
    expect(c.toState()).toMatchObject({
      status: 'CLOSED',
      closedAt: at,
      closeReason: 'MATCH_LOCKED',
      version: 2,
    });
    expect(c.pullEvents()).toMatchObject([
      { type: 'ConversationClosed', version: 2, payload: { matchId: MATCH, reason: 'MATCH_LOCKED' } },
    ]);
  });

  it('đóng lần hai → false, không event, không tăng version, giữ lý do đầu', () => {
    const c = open();
    c.close('MATCH_CLOSED', T0);
    c.pullEvents();
    expect(c.close('MATCH_LOCKED', addDuration(T0, { hours: 1 }))).toBe(false);
    expect(c.pullEvents()).toEqual([]);
    expect(c.toState()).toMatchObject({ closeReason: 'MATCH_CLOSED', closedAt: T0, version: 2 });
  });

  it('closedBeforeOpening → CLOSED ngay, chỉ phát ConversationClosed', () => {
    const at = addDuration(T0, { hours: 3 });
    const c = Conversation.closedBeforeOpening(
      {
        id: newId<'Conversation'>(),
        matchId: MATCH,
        participants: [A, B],
        reason: 'MATCH_LOCKED',
        closedAt: at,
      },
      T0,
    );
    expect(c.toState()).toMatchObject({
      status: 'CLOSED',
      openedAt: at,
      closesAt: at,
      closedAt: at,
      closeReason: 'MATCH_LOCKED',
      version: 1,
    });
    expect(c.pullEvents().map((e) => e.type)).toEqual(['ConversationClosed']);
    expect(c.ensureCanSend(A, T0)).toMatchObject({ error: { code: 'CONVERSATION_CLOSED' } });
  });

  it('restore ↔ toState giữ nguyên', () => {
    const c = open();
    expect(Conversation.restore(c.toState()).toState()).toEqual(c.toState());
  });
});

describe('Message.send', () => {
  it('tin TEXT: lưu body, MessageSent gửi cho người còn lại, payload không có nội dung', () => {
    const c = open();
    const r = Message.send(
      c,
      {
        id: newId<'Message'>(),
        senderId: A,
        body: body('  Chào bạn  '),
        screening: PASS_THROUGH_SCREENER(body('x')),
      },
      T0,
    );
    expect(r.isOk()).toBe(true);
    const m = r.unwrapOr(undefined as never);
    expect(m.toState()).toMatchObject({
      conversationId: c.id,
      senderId: A,
      kind: 'TEXT',
      systemCode: null,
      body: 'Chào bạn',
      maskedBody: null,
      flagged: false,
      flagReasons: [],
      sentAt: T0,
      version: 1,
    });
    expect(m.displayBody).toBe('Chào bạn');
    const events = m.pullEvents();
    expect(events).toMatchObject([
      {
        type: 'MessageSent',
        aggregateType: 'Message',
        payload: {
          conversationId: c.id,
          senderId: A,
          recipientIds: [B],
          kind: 'TEXT',
          systemCode: null,
          flagged: false,
          sentAt: T0.toISOString(),
        },
      },
    ]);
    expect(JSON.stringify(events)).not.toContain('Chào bạn');
  });

  it('bị gắn cờ + che → maskedBody hiển thị, phát thêm MessageFlagged (mã luật, không nội dung)', () => {
    const c = open();
    const screening: MessageScreening = {
      maskedBody: 'gọi mình ***',
      flagged: true,
      reasons: ['BANK_TRANSFER'],
    };
    const m = Message.send(
      c,
      { id: newId<'Message'>(), senderId: B, body: body('gọi mình 0912345678'), screening },
      T0,
    ).unwrapOr(undefined as never);
    expect(m.displayBody).toBe('gọi mình ***');
    expect(m.toState()).toMatchObject({ flagged: true, flagReasons: ['BANK_TRANSFER'], version: 2 });
    const events = m.pullEvents();
    expect(events.map((e) => [e.type, e.version])).toEqual([
      ['MessageSent', 1],
      ['MessageFlagged', 2],
    ]);
    expect(events[1]?.payload).toEqual({
      messageId: m.id,
      conversationId: c.id,
      senderId: B,
      reasons: ['BANK_TRANSFER'],
    });
    expect(JSON.stringify(events)).not.toContain('0912345678');
  });

  it('gắn cờ mà không có mã luật → lỗi lập trình', () => {
    const c = open();
    expect(() =>
      Message.send(
        c,
        {
          id: newId<'Message'>(),
          senderId: A,
          body: body('x'),
          screening: { maskedBody: null, flagged: true, reasons: [] },
        },
        T0,
      ),
    ).toThrow();
  });

  it('không cho tạo tin khi người gửi ngoài cặp / hội thoại đóng (AC1 ở domain)', () => {
    const c = open();
    const input = (senderId: string) => ({
      id: newId<'Message'>(),
      senderId,
      body: body('hi'),
      screening: PASS_THROUGH_SCREENER(body('hi')),
    });
    expect(Message.send(c, input(OUTSIDER), T0)).toMatchObject({ error: { code: 'NOT_PARTICIPANT' } });
    c.close('MATCH_CLOSED', T0);
    expect(Message.send(c, input(A), T0)).toMatchObject({ error: { code: 'CONVERSATION_CLOSED' } });
  });
});

describe('Message.system', () => {
  it.each(['CONVERSATION_OPENED', 'CONVERSATION_CLOSED', 'FRAUD_WARNING'] as const)(
    '%s: không người gửi, mặc định gửi cả hai',
    (code) => {
      const c = open();
      const m = Message.system(c, { id: newId<'Message'>(), code }, T0);
      expect(m.toState()).toMatchObject({
        senderId: null,
        kind: 'SYSTEM',
        systemCode: code,
        body: SYSTEM_MESSAGE_TEXT[code],
        flagged: false,
      });
      expect(m.pullEvents()).toMatchObject([
        {
          type: 'MessageSent',
          payload: { senderId: null, recipientIds: [A, B], kind: 'SYSTEM', systemCode: code },
        },
      ]);
    },
  );

  it('FRAUD_WARNING với visibleTo: chỉ người đó thấy, MessageSent chỉ gửi người đó', () => {
    const c = open();
    const m = Message.system(
      c,
      { id: newId<'Message'>(), code: 'FRAUD_WARNING', visibleTo: B.toUpperCase() },
      T0,
    );
    expect(m.toState()).toMatchObject({ systemCode: 'FRAUD_WARNING', visibleTo: B, senderId: null });
    expect(m.isVisibleTo(B)).toBe(true);
    expect(m.isVisibleTo(A)).toBe(false);
    expect(m.pullEvents()).toMatchObject([{ payload: { recipientIds: [B], systemCode: 'FRAUD_WARNING' } }]);
  });

  it('visibleTo không phải participant → lỗi lập trình', () => {
    const c = open();
    expect(() =>
      Message.system(c, { id: newId<'Message'>(), code: 'FRAUD_WARNING', visibleTo: OUTSIDER }, T0),
    ).toThrow();
  });
});

describe('Message.bodyFor — quy tắc hiển thị', () => {
  it('người gửi thấy body gốc; người nhận thấy maskedBody; không che → cả hai thấy body gốc', () => {
    const c = open();
    const masked = Message.send(
      c,
      {
        id: newId<'Message'>(),
        senderId: A,
        body: body('zalo: 0912345678'),
        screening: { maskedBody: 'zalo: ***', flagged: false, reasons: [] },
      },
      T0,
    ).unwrapOr(undefined as never);
    expect(masked.bodyFor(A.toUpperCase())).toBe('zalo: 0912345678');
    expect(masked.bodyFor(B)).toBe('zalo: ***');
    expect(masked.isVisibleTo(A) && masked.isVisibleTo(B)).toBe(true);

    const plain = Message.send(
      c,
      {
        id: newId<'Message'>(),
        senderId: A,
        body: body('chào'),
        screening: PASS_THROUGH_SCREENER(body('chào')),
      },
      T0,
    ).unwrapOr(undefined as never);
    expect(plain.bodyFor(B)).toBe('chào');
  });
});

describe('parseMessageBody', () => {
  it('bỏ khoảng trắng hai đầu', () => {
    expect(parseMessageBody('\n  xin chào \t').unwrapOr('' as MessageBody)).toBe('xin chào');
  });

  it.each(['', '   ', '\n\t'])('rỗng %j → MESSAGE_EMPTY', (raw) => {
    expect(parseMessageBody(raw)).toMatchObject({ error: { code: 'MESSAGE_EMPTY' } });
  });

  it('đúng MESSAGE_MAX_LENGTH ký tự → ok; thêm 1 → MESSAGE_TOO_LONG (meta không có nội dung)', () => {
    expect(parseMessageBody('a'.repeat(MESSAGE_MAX_LENGTH)).isOk()).toBe(true);
    expect(parseMessageBody('a'.repeat(MESSAGE_MAX_LENGTH + 1))).toMatchObject({
      error: {
        code: 'MESSAGE_TOO_LONG',
        details: { maxLength: MESSAGE_MAX_LENGTH, length: MESSAGE_MAX_LENGTH + 1 },
      },
    });
  });

  it('đếm theo code point: emoji không bị tính gấp đôi', () => {
    expect(parseMessageBody('😀'.repeat(MESSAGE_MAX_LENGTH)).isOk()).toBe(true);
  });
});

describe('giới hạn tốc độ', () => {
  it(`< ${MESSAGE_RATE_LIMIT_PER_MINUTE} tin trong cửa sổ → ok; đạt giới hạn → RATE_LIMITED`, () => {
    expect(checkMessageRateLimit(MESSAGE_RATE_LIMIT_PER_MINUTE - 1).isOk()).toBe(true);
    expect(checkMessageRateLimit(MESSAGE_RATE_LIMIT_PER_MINUTE)).toMatchObject({
      error: { code: 'RATE_LIMITED', details: { limit: 30, windowSeconds: 60 } },
    });
  });

  it('cửa sổ = 60 giây trước now', () => {
    expect(messageRateWindowStart(T0)).toEqual(addDuration(T0, { seconds: -60 }));
  });
});
