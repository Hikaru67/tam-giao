import type { DomainEvent, Result, Tx, UnitOfWork } from '@tamgiao/kernel';
import type {
  ConversationReadRepository,
  ConversationReadState,
} from '../application/ports/conversation-read-repository.js';
import type { ConversationRepository } from '../application/ports/conversation-repository.js';
import type { MessageRepository } from '../application/ports/message-repository.js';
import {
  Conversation,
  type ConversationId,
  type ConversationState,
  type ConversationUserId,
} from '../domain/conversation.js';
import type { ClientMessageId, Message, MessageId, MessageState } from '../domain/message.js';
import type {
  ConversationBroadcast,
  ConversationBroadcastListener,
  MessageBroadcaster,
} from '../application/ports/message-broadcaster.js';

/** UnitOfWork giả: chạy thẳng `work` (fake repository không có transaction thật). */
export class PassThroughUnitOfWork implements UnitOfWork {
  runs = 0;
  async run<T, E>(work: (tx: Tx) => Promise<Result<T, E>>): Promise<Result<T, E>> {
    this.runs += 1;
    return work({} as Tx);
  }
}

/** Fake in-memory của `ConversationRepository` (cùng luật version lạc quan + unique `match_id` như adapter Drizzle). */
export class InMemoryConversationRepository implements ConversationRepository {
  readonly states = new Map<string, ConversationState>();
  readonly events: DomainEvent[] = [];

  async save(_tx: Tx, conversation: Conversation): Promise<void> {
    const pending = conversation.pullEvents();
    if (pending.length === 0) return;
    const state = conversation.toState();
    const previous = state.version - pending.length;
    const stored = this.states.get(conversation.id);
    if ((stored?.version ?? 0) !== previous) throw new Error(`xung đột version ${conversation.id}`);
    if (!stored && [...this.states.values()].some((s) => s.matchId === state.matchId)) {
      throw new Error(`trùng match_id ${state.matchId}`);
    }
    this.states.set(conversation.id, state);
    this.events.push(...pending);
  }

  async findById(_tx: Tx, id: ConversationId): Promise<Conversation | null> {
    const state = this.states.get(id);
    return state ? Conversation.restore(state) : null;
  }

  findByIdForUpdate(tx: Tx, id: ConversationId): Promise<Conversation | null> {
    return this.findById(tx, id);
  }

  async findByMatchIdForUpdate(_tx: Tx, matchId: string): Promise<Conversation | null> {
    const state = [...this.states.values()].find((s) => s.matchId === matchId.toLowerCase());
    return state ? Conversation.restore(state) : null;
  }

  async listByParticipant(_tx: Tx, userId: ConversationUserId): Promise<readonly Conversation[]> {
    const id = userId.toLowerCase();
    return [...this.states.values()].filter((s) => s.participants.includes(id)).map(Conversation.restore);
  }
}

/** Fake in-memory của `MessageRepository`. */
export class InMemoryMessageRepository implements MessageRepository {
  readonly states: MessageState[] = [];
  readonly events: DomainEvent[] = [];

  async save(_tx: Tx, message: Message): Promise<void> {
    const pending = message.pullEvents();
    if (pending.length === 0) return;
    this.states.push(message.toState());
    this.events.push(...pending);
  }

  async countSentSince(
    _tx: Tx,
    input: {
      readonly conversationId: ConversationId;
      readonly senderId: ConversationUserId;
      readonly since: Date;
    },
  ): Promise<number> {
    return this.states.filter(
      (m) =>
        m.conversationId === input.conversationId &&
        m.senderId === input.senderId.toLowerCase() &&
        m.sentAt.getTime() > input.since.getTime(),
    ).length;
  }

  async findByClientMessageId(
    _tx: Tx,
    input: { readonly senderId: ConversationUserId; readonly clientMessageId: ClientMessageId },
  ): Promise<MessageState | null> {
    return (
      this.states.find(
        (m) => m.senderId === input.senderId.toLowerCase() && m.clientMessageId === input.clientMessageId,
      ) ?? null
    );
  }

  async listAfter(
    _tx: Tx,
    input: {
      readonly conversationId: ConversationId;
      readonly viewerId: ConversationUserId;
      readonly afterId: MessageId | null;
      readonly limit: number;
    },
  ): Promise<readonly MessageState[]> {
    return this.states
      .filter(
        (m) =>
          m.conversationId === input.conversationId &&
          (m.visibleTo === null || m.visibleTo === input.viewerId.toLowerCase()) &&
          (input.afterId === null || m.id > input.afterId),
      )
      .sort(byId)
      .slice(0, input.limit);
  }

  async findById(_tx: Tx, id: MessageId): Promise<MessageState | null> {
    return this.states.find((m) => m.id === id) ?? null;
  }

  async listBefore(
    _tx: Tx,
    input: {
      readonly conversationId: ConversationId;
      readonly viewerId: ConversationUserId;
      readonly beforeId: MessageId | null;
      readonly limit: number;
    },
  ): Promise<readonly MessageState[]> {
    return this.states
      .filter(
        (m) =>
          m.conversationId === input.conversationId &&
          visibleTo(m, input.viewerId) &&
          (input.beforeId === null || m.id < input.beforeId),
      )
      .sort((x, y) => byId(y, x))
      .slice(0, input.limit);
  }

  async countUnread(
    _tx: Tx,
    input: {
      readonly conversationId: ConversationId;
      readonly viewerId: ConversationUserId;
      readonly afterId: MessageId | null;
    },
  ): Promise<number> {
    return this.states.filter(
      (m) =>
        m.conversationId === input.conversationId &&
        visibleTo(m, input.viewerId) &&
        m.senderId !== input.viewerId.toLowerCase() &&
        (input.afterId === null || m.id > input.afterId),
    ).length;
  }
}

const byId = (x: MessageState, y: MessageState): number => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
const visibleTo = (m: MessageState, viewerId: string): boolean =>
  m.visibleTo === null || m.visibleTo === viewerId.toLowerCase();

/** Fake in-memory của `ConversationReadRepository` (con trỏ chỉ tiến như UPSERT có điều kiện ở DB). */
export class InMemoryConversationReadRepository implements ConversationReadRepository {
  readonly states = new Map<string, ConversationReadState>();

  async advance(
    _tx: Tx,
    input: {
      readonly conversationId: ConversationId;
      readonly userId: ConversationUserId;
      readonly messageId: MessageId;
      readonly readAt: Date;
    },
  ): Promise<{ readonly state: ConversationReadState; readonly advanced: boolean }> {
    const key = `${input.conversationId}:${input.userId.toLowerCase()}`;
    const current = this.states.get(key);
    if (current && current.lastReadMessageId >= input.messageId) return { state: current, advanced: false };
    const state: ConversationReadState = {
      conversationId: input.conversationId,
      userId: input.userId.toLowerCase(),
      lastReadMessageId: input.messageId,
      readAt: input.readAt,
    };
    this.states.set(key, state);
    return { state, advanced: true };
  }

  async find(
    _tx: Tx,
    input: { readonly conversationId: ConversationId; readonly userId: ConversationUserId },
  ): Promise<ConversationReadState | null> {
    return this.states.get(`${input.conversationId}:${input.userId.toLowerCase()}`) ?? null;
  }
}

/** Fake in-memory của `MessageBroadcaster`: phát đồng bộ cho mọi listener (như mọi instance cùng nhận). */
export class InMemoryMessageBroadcaster implements MessageBroadcaster {
  readonly published: ConversationBroadcast[] = [];
  private readonly listeners = new Set<ConversationBroadcastListener>();
  failNextPublish = false;

  async publish(event: ConversationBroadcast): Promise<void> {
    if (this.failNextPublish) {
      this.failNextPublish = false;
      throw new Error('broadcaster down');
    }
    this.published.push(event);
    for (const listener of this.listeners) listener(event);
  }

  async subscribe(listener: ConversationBroadcastListener): Promise<() => Promise<void>> {
    this.listeners.add(listener);
    return async () => {
      this.listeners.delete(listener);
    };
  }
}
