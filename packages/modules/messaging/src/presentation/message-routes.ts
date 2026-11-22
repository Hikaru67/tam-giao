import {
  markConversationReadBodySchema,
  messagesAfterQuerySchema,
  type ConversationListResponse,
  type IcebreakersResponse,
  type MarkConversationReadResponse,
  type MessagesAfterResponse,
} from '@tamgiao/contracts';
import { parseBody, parseQuery, sendResult, type AppEnv } from '@tamgiao/http';
import { Hono, type MiddlewareHandler } from 'hono';
import type { ListMessages } from '../application/conversation-access.js';
import type {
  GetIcebreakers,
  ListMyConversations,
  MarkConversationRead,
} from '../application/conversation-inbox.js';
import type { MessageBroadcaster } from '../application/ports/message-broadcaster.js';
import { historyToDto, readBroadcast, summaryToDto } from './message-dto-mapper.js';

export interface MessageRoutesDeps {
  readonly listMessages: ListMessages;
  readonly listMyConversations: ListMyConversations;
  readonly markConversationRead: MarkConversationRead;
  readonly getIcebreakers: GetIcebreakers;
  /** Phát `message.read` realtime khi đánh dấu đọc qua REST (thiết bị khác + người kia thấy ngay). */
  readonly broadcaster: MessageBroadcaster;
  readonly requireUser: MiddlewareHandler<AppEnv>;
  readonly onPublishError?: (error: unknown) => void;
}

/**
 * REST chat của người dùng app (BE-S6-02 + BE-S6-04), mọi route yêu cầu `requireUser`, chỉ người trong cặp:
 * - `GET /me/conversations` — hộp thư (tin cuối theo người xem, số chưa đọc, ngày X/`DATING_DAYS`).
 * - `GET /me/conversations/:id/messages?after=|before=&limit=` — lịch sử theo con trỏ id (UUID v7).
 * - `POST /me/conversations/:id/read` — lưu con trỏ đã đọc (+ phát `message.read` realtime khi con trỏ tiến).
 * - `GET /me/conversations/:id/icebreakers` — gợi ý phá băng theo ngày tìm hiểu.
 */
export function createMessageRoutes(deps: MessageRoutesDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.get('/me/conversations', deps.requireUser, async (c) => {
    const result = await deps.listMyConversations.execute({ userId: c.get('auth').userId });
    return sendResult(
      c,
      result.map((items): ConversationListResponse => ({ items: items.map(summaryToDto) })),
    );
  });

  routes.get('/me/conversations/:id/messages', deps.requireUser, async (c) => {
    const query = parseQuery(c, messagesAfterQuerySchema);
    if (query.isErr()) return query.error;
    const { after, before, limit } = query.value;
    const result = await deps.listMessages.execute({
      conversationId: c.req.param('id'),
      userId: c.get('auth').userId,
      limit,
      ...(after === undefined ? {} : { after }),
      ...(before === undefined ? {} : { before }),
    });
    return sendResult(
      c,
      result.map((page): MessagesAfterResponse => ({
        items: page.items.map(historyToDto),
        hasMore: page.hasMore,
      })),
    );
  });

  routes.post('/me/conversations/:id/read', deps.requireUser, async (c) => {
    const body = await parseBody(c, markConversationReadBodySchema);
    if (body.isErr()) return body.error;
    const result = await deps.markConversationRead.execute({
      conversationId: c.req.param('id'),
      userId: c.get('auth').userId,
      messageId: body.value.messageId,
    });
    if (result.isOk() && result.value.advanced) {
      // Đã lưu; phát realtime "tốt nhất có thể" — lỗi broadcaster không làm hỏng request.
      await deps.broadcaster.publish(readBroadcast(result.value, null)).catch((error: unknown) => {
        deps.onPublishError?.(error);
      });
    }
    return sendResult(
      c,
      result.map((v): MarkConversationReadResponse => ({
        conversationId: v.conversationId,
        lastReadMessageId: v.lastReadMessageId,
        readAt: v.readAt.toISOString(),
        unreadCount: v.unreadCount,
      })),
    );
  });

  routes.get('/me/conversations/:id/icebreakers', deps.requireUser, async (c) => {
    const result = await deps.getIcebreakers.execute({
      conversationId: c.req.param('id'),
      userId: c.get('auth').userId,
    });
    return sendResult(
      c,
      result.map((v): IcebreakersResponse => ({
        conversationId: v.conversationId,
        datingDay: v.datingDay,
        datingDays: v.datingDays,
        theme: v.theme,
        topics: [...v.topics],
      })),
    );
  });

  return routes;
}
