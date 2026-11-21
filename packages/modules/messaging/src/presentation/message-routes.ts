import { messagesAfterQuerySchema, type MessagesAfterResponse } from '@tamgiao/contracts';
import { parseQuery, sendResult, type AppEnv } from '@tamgiao/http';
import { Hono, type MiddlewareHandler } from 'hono';
import type { ListMessagesAfter } from '../application/conversation-access.js';
import { historyToDto } from './message-dto-mapper.js';

export interface MessageRoutesDeps {
  readonly listMessagesAfter: ListMessagesAfter;
  readonly requireUser: MiddlewareHandler<AppEnv>;
}

/**
 * REST tin nhắn (BE-S6-02, bản tối thiểu): `GET /me/conversations/:id/messages?after=&limit=` — client nối lại WS lấy
 * tin bị lỡ. Chỉ người trong cặp; nội dung chọn theo người xem. BE-S6-04 mở rộng (danh sách hội thoại, đánh dấu đã đọc).
 */
export function createMessageRoutes(deps: MessageRoutesDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.get('/me/conversations/:id/messages', deps.requireUser, async (c) => {
    const query = parseQuery(c, messagesAfterQuerySchema);
    if (query.isErr()) return query.error;
    const userId = c.get('auth').userId;
    const result = await deps.listMessagesAfter.execute({
      conversationId: c.req.param('id'),
      userId,
      limit: query.value.limit,
      ...(query.value.after === undefined ? {} : { after: query.value.after }),
    });
    return sendResult(
      c,
      result.map((page): MessagesAfterResponse => ({
        items: page.items.map(historyToDto),
        hasMore: page.hasMore,
      })),
    );
  });

  return routes;
}
