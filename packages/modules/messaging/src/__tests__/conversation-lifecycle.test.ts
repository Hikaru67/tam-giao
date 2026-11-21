import { FakeClock, addDuration, newId, type Tx } from '@tamgiao/kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CloseConversationForMatch,
  OpenConversationForMatch,
  type CloseConversationInput,
  type OpenConversationInput,
} from '../application/conversation-lifecycle.js';
import { InMemoryConversationRepository, InMemoryMessageRepository } from './messaging-fakes.js';

const T0 = new Date('2026-06-01T08:00:00.000Z');
const A = newId<'User'>();
const B = newId<'User'>();
const TX = {} as Tx;

let clock: FakeClock;
let conversations: InMemoryConversationRepository;
let messages: InMemoryMessageRepository;
let openHandler: OpenConversationForMatch;
let closeHandler: CloseConversationForMatch;
let matchId: string;

const openInput = (): OpenConversationInput => ({
  matchId,
  participantIds: [A, B],
  openedAt: T0,
  closesAt: addDuration(T0, { days: 14 }),
});
const closeInput = (over: Partial<CloseConversationInput> = {}): CloseConversationInput => ({
  matchId,
  participantIds: [A, B],
  fromStatus: 'DATING',
  reason: 'MATCH_CLOSED',
  closedAt: addDuration(T0, { days: 3 }),
  ...over,
});

beforeEach(() => {
  clock = new FakeClock(addDuration(T0, { seconds: 2 }));
  conversations = new InMemoryConversationRepository();
  messages = new InMemoryMessageRepository();
  const deps = { clock, conversations, messages };
  openHandler = new OpenConversationForMatch(deps);
  closeHandler = new CloseConversationForMatch(deps);
  matchId = newId<'Match'>();
});

describe('OpenConversationForMatch (MatchStartedDating)', () => {
  it('mở hội thoại OPEN + tin hệ thống mở đầu', async () => {
    expect(await openHandler.handle(TX, openInput())).toBe('OPENED');
    const [conversation, ...others] = [...conversations.states.values()];
    expect(others).toHaveLength(0);
    expect(conversation).toMatchObject({ matchId, status: 'OPEN', openedAt: T0, participants: [A, B] });
    expect(messages.states).toMatchObject([
      { kind: 'SYSTEM', systemCode: 'CONVERSATION_OPENED', senderId: null },
    ]);
    expect(conversations.events.map((e) => e.type)).toEqual(['ConversationOpened']);
  });

  it('AC2: xử lý 2 lần → chỉ 1 hội thoại, 1 tin mở đầu', async () => {
    expect(await openHandler.handle(TX, openInput())).toBe('OPENED');
    expect(await openHandler.handle(TX, openInput())).toBe('ALREADY_EXISTS');
    expect(conversations.states.size).toBe(1);
    expect(messages.states).toHaveLength(1);
  });
});

describe('CloseConversationForMatch (MatchClosed / MatchLocked)', () => {
  it('đóng hội thoại + tin hệ thống "đã đóng"; lần hai → ALREADY_CLOSED', async () => {
    await openHandler.handle(TX, openInput());
    expect(await closeHandler.handle(TX, closeInput({ reason: 'MATCH_LOCKED' }))).toBe('CLOSED');
    const [conversation] = [...conversations.states.values()];
    expect(conversation).toMatchObject({
      status: 'CLOSED',
      closeReason: 'MATCH_LOCKED',
      closedAt: clock.now(),
    });
    expect(messages.states.map((m) => m.systemCode)).toEqual(['CONVERSATION_OPENED', 'CONVERSATION_CLOSED']);

    expect(await closeHandler.handle(TX, closeInput())).toBe('ALREADY_CLOSED');
    expect(messages.states).toHaveLength(2);
    expect(conversations.events.map((e) => e.type)).toEqual(['ConversationOpened', 'ConversationClosed']);
  });

  it('match khoá khi chưa vào DATING → NO_CONVERSATION, không ghi gì', async () => {
    for (const fromStatus of ['OFFERED', 'AWAITING_RESPONSE']) {
      expect(await closeHandler.handle(TX, closeInput({ fromStatus, reason: 'MATCH_LOCKED' }))).toBe(
        'NO_CONVERSATION',
      );
    }
    expect(conversations.states.size).toBe(0);
    expect(messages.states).toHaveLength(0);
  });

  it('event đóng tới trước event mở (DATING/MET) → hội thoại CLOSED sẵn, event mở sau không mở lại', async () => {
    expect(await closeHandler.handle(TX, closeInput({ reason: 'MATCH_LOCKED' }))).toBe(
      'CLOSED_BEFORE_OPENING',
    );
    expect(await openHandler.handle(TX, openInput())).toBe('ALREADY_EXISTS');
    const [conversation, ...others] = [...conversations.states.values()];
    expect(others).toHaveLength(0);
    expect(conversation).toMatchObject({ status: 'CLOSED', closeReason: 'MATCH_LOCKED' });
    expect(messages.states).toHaveLength(0);

    const metId = newId<'Match'>();
    expect(await closeHandler.handle(TX, closeInput({ matchId: metId, fromStatus: 'MET' }))).toBe(
      'CLOSED_BEFORE_OPENING',
    );
  });
});
