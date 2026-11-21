import { OutboxWriter, type EventBus } from '@tamgiao/db';
import type { AppEnv, UserAuthenticator } from '@tamgiao/http';
import type { Clock, UnitOfWork } from '@tamgiao/kernel';
import type { Hono, MiddlewareHandler } from 'hono';
import { JoinConversation, ListMessages } from './application/conversation-access.js';
import {
  GetIcebreakers,
  ListMyConversations,
  MarkConversationRead,
} from './application/conversation-inbox.js';
import type { MessageBroadcaster } from './application/ports/message-broadcaster.js';
import {
  CloseConversationForMatch,
  OpenConversationForMatch,
  type ConversationLifecycleDeps,
} from './application/conversation-lifecycle.js';
import { SendMessage } from './application/send-message.js';
import type { MessageScreener } from './domain/message-policy.js';
import { createContentScreener } from './domain/message-screener.js';
import { registerConversationConsumers } from './infrastructure/conversation-consumers.js';
import { DrizzleConversationReadRepository } from './infrastructure/drizzle-conversation-read-repository.js';
import { DrizzleConversationRepository } from './infrastructure/drizzle-conversation-repository.js';
import { DrizzleMessageRepository } from './infrastructure/drizzle-message-repository.js';
import { ChatGateway, type ChatGatewayLogger } from './presentation/chat-gateway.js';
import { createMessageRoutes } from './presentation/message-routes.js';

/**
 * Module messaging (Sprint 6): chat chỉ mở trong giai đoạn `DATING` của match. BE-S6-01: domain hội thoại/tin nhắn,
 * mở/đóng hội thoại theo event matching, use case `SendMessage`. BE-S6-02: WS gateway `/ws` + Redis pub/sub đa instance,
 * idempotency key phía client. BE-S6-04: hộp thư, lịch sử phân trang theo con trỏ, đánh dấu đã đọc, gợi ý phá băng.
 * Bộ lọc lừa đảo/che liên hệ ở BE-S6-03 (`createContentScreener`, mặc định của `createMessagingModule`).
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
export type {
  ConversationBroadcast,
  MessageBroadcaster,
  RealtimeMessage,
} from './application/ports/message-broadcaster.js';
export type { ChatGateway, ChatGatewayLogger, UpgradableServer } from './presentation/chat-gateway.js';
export {
  DEFAULT_MESSAGING_REDIS_CHANNEL,
  RedisMessageBroadcaster,
  type RedisMessageBroadcasterOptions,
} from './infrastructure/redis-message-broadcaster.js';
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
  /** Guard REST người dùng app (`/me/conversations…`). */
  readonly requireUser: MiddlewareHandler<AppEnv>;
  /** Xác thực access token ở handshake WS (`identity.facade.authenticateUser`). */
  readonly authenticateUser: UserAuthenticator;
  /** Pub/sub realtime giữa các instance (`RedisMessageBroadcaster`). */
  readonly broadcaster: MessageBroadcaster;
  readonly logger?: ChatGatewayLogger;
  /** Ghi đè nhịp heartbeat WS (test). */
  readonly heartbeat?: { readonly intervalMs: number; readonly timeoutMs: number };
}

export interface MessagingModule {
  readonly name: 'messaging';
  /** `GET /me/conversations`, `GET …/:id/messages`, `POST …/:id/read`, `GET …/:id/icebreakers` (BE-S6-02/04). */
  readonly routes: Hono<AppEnv>;
  /** WebSocket gateway `/ws` — composition root gắn vào HTTP server (`attach`) và đóng khi tắt (`close`). */
  readonly realtime: ChatGateway;
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
  const access = { uow: deps.uow, conversations: lifecycle.conversations, messages: lifecycle.messages };
  const inbox = { ...access, clock: deps.clock, reads: new DrizzleConversationReadRepository() };
  const markConversationRead = new MarkConversationRead(inbox);
  const realtime = new ChatGateway({
    authenticate: deps.authenticateUser,
    joinConversation: new JoinConversation(access),
    sendMessage,
    markConversationRead,
    broadcaster: deps.broadcaster,
    ...(deps.logger === undefined ? {} : { logger: deps.logger }),
    ...(deps.heartbeat === undefined
      ? {}
      : { heartbeatIntervalMs: deps.heartbeat.intervalMs, heartbeatTimeoutMs: deps.heartbeat.timeoutMs }),
  });
  const routes = createMessageRoutes({
    listMessages: new ListMessages(access),
    listMyConversations: new ListMyConversations(inbox),
    markConversationRead,
    getIcebreakers: new GetIcebreakers(inbox),
    broadcaster: deps.broadcaster,
    requireUser: deps.requireUser,
    onPublishError: (error) => deps.logger?.warn({ err: error }, 'realtime publish failed'),
  });
  return { name: 'messaging', routes, realtime, commands: { sendMessage } };
}
