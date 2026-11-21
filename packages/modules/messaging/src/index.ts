import { OutboxWriter, type EventBus } from '@tamgiao/db';
import type { AppEnv } from '@tamgiao/http';
import type { Clock, UnitOfWork } from '@tamgiao/kernel';
import { Hono } from 'hono';
import {
  CloseConversationForMatch,
  OpenConversationForMatch,
  type ConversationLifecycleDeps,
} from './application/conversation-lifecycle.js';
import { SendMessage } from './application/send-message.js';
import type { MessageScreener } from './domain/message-policy.js';
import { createContentScreener } from './domain/message-screener.js';
import { registerConversationConsumers } from './infrastructure/conversation-consumers.js';
import { DrizzleConversationRepository } from './infrastructure/drizzle-conversation-repository.js';
import { DrizzleMessageRepository } from './infrastructure/drizzle-message-repository.js';

/**
 * Module messaging (Sprint 6): chat chỉ mở trong giai đoạn `DATING` của match. BE-S6-01: domain hội thoại/tin nhắn,
 * mở/đóng hội thoại theo event matching, use case `SendMessage`. Transport realtime + route ở BE-S6-02/BE-S6-04,
 * bộ lọc lừa đảo/che liên hệ ở BE-S6-03 (`createContentScreener`, mặc định của `createMessagingModule`).
 */

export type { ConversationCloseReason, ConversationId, ConversationStatus } from './domain/conversation.js';
export type { MessageId, MessageKind, SystemMessageCode } from './domain/message.js';
export type { MessageScreener, MessageScreening } from './domain/message-policy.js';
export type {
  SendMessage,
  SendMessageCommand,
  SendMessageError,
  SentMessageView,
} from './application/send-message.js';
export type {
  CloseConversationOutcome,
  OpenConversationOutcome,
} from './application/conversation-lifecycle.js';
export {
  CLOSE_CONVERSATION_ON_MATCH_CLOSED_CONSUMER,
  CLOSE_CONVERSATION_ON_MATCH_LOCKED_CONSUMER,
  OPEN_CONVERSATION_ON_MATCH_STARTED_DATING_CONSUMER,
} from './infrastructure/conversation-consumers.js';

function lifecycleDeps(clock: Clock): ConversationLifecycleDeps {
  const outbox = new OutboxWriter();
  return {
    clock,
    conversations: new DrizzleConversationRepository(outbox),
    messages: new DrizzleMessageRepository(outbox),
  };
}

export interface MessagingWorkerDeps {
  readonly clock: Clock;
}

export interface MessagingWorker {
  /** Đăng ký consumer mở/đóng hội thoại theo event matching (worker gọi trước `registerConsumers`). */
  registerConsumers(bus: EventBus): void;
}

/** Phần worker của module messaging: `MatchStartedDating` → mở, `MatchClosed`/`MatchLocked` → đóng (BE-S6-01). */
export function createMessagingWorker(deps: MessagingWorkerDeps): MessagingWorker {
  const lifecycle = lifecycleDeps(deps.clock);
  const consumers = {
    open: new OpenConversationForMatch(lifecycle),
    close: new CloseConversationForMatch(lifecycle),
  };
  return { registerConsumers: (bus) => registerConversationConsumers(bus, consumers) };
}

export interface MessagingModuleDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  /** Sàng lọc nội dung tin. Bỏ trống = bộ lọc lừa đảo + che liên hệ (`createContentScreener`, BE-S6-03). */
  readonly screener?: MessageScreener;
}

export interface MessagingModule {
  readonly name: 'messaging';
  /** Chưa có route ở BE-S6-01 (WS ở BE-S6-02, REST lịch sử ở BE-S6-04). */
  readonly routes: Hono<AppEnv>;
  readonly commands: {
    /** Gửi tin — WS `message.send` (BE-S6-02) gọi use case này. */
    readonly sendMessage: SendMessage;
  };
}

/** Composition root phía API của module messaging. */
export function createMessagingModule(deps: MessagingModuleDeps): MessagingModule {
  const lifecycle = lifecycleDeps(deps.clock);
  const sendMessage = new SendMessage({
    uow: deps.uow,
    clock: deps.clock,
    conversations: lifecycle.conversations,
    messages: lifecycle.messages,
    screener: deps.screener ?? createContentScreener(),
  });
  return { name: 'messaging', routes: new Hono<AppEnv>(), commands: { sendMessage } };
}
