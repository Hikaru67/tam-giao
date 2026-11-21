import type { DomainEvent, Result, Tx, UnitOfWork } from '@tamgiao/kernel';
import type { ConversationRepository } from '../application/ports/conversation-repository.js';
import type { MessageRepository } from '../application/ports/message-repository.js';
import {
  Conversation,
  type ConversationId,
  type ConversationState,
  type ConversationUserId,
} from '../domain/conversation.js';
import type { Message, MessageState } from '../domain/message.js';

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
}
