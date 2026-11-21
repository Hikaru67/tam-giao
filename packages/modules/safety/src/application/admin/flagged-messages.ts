import { fail, ok, type DomainError, type Result } from '@tamgiao/kernel';
import type { AuditLogger } from '@tamgiao/module-identity/facade';
import type {
  FlaggedMessageCursor,
  FlaggedMessageDetail,
  FlaggedMessagePage,
  FlaggedMessageSummary,
  MessagingFacade,
} from '@tamgiao/module-messaging/facade';
import {
  SAFETY_AUDIT_ACTION,
  SAFETY_AUDIT_TARGET,
  auditModeration,
  type ModerationActor,
} from './moderation-audit.js';

export type { FlaggedMessageCursor, FlaggedMessageDetail, FlaggedMessageSummary };

export const FLAGGED_QUEUE_PAGE_DEFAULT = 20;
export const FLAGGED_QUEUE_PAGE_MAX = 100;

/**
 * Hàng chờ "Cảnh báo vi phạm" — tin bị bộ lọc lừa đảo gắn cờ (BE-S6-06). Đọc qua facade read-only của messaging (A3:
 * safety không đọc bảng `messaging.*`). Danh sách chỉ có mã luật + id, không nội dung → không ghi audit.
 */
export class ListFlaggedMessages {
  constructor(private readonly deps: { readonly messaging: Pick<MessagingFacade, 'listFlaggedMessages'> }) {}

  async execute(query: {
    readonly cursor: FlaggedMessageCursor | null;
    readonly limit?: number;
  }): Promise<Result<FlaggedMessagePage, never>> {
    const limit = Math.min(Math.max(query.limit ?? FLAGGED_QUEUE_PAGE_DEFAULT, 1), FLAGGED_QUEUE_PAGE_MAX);
    return ok(await this.deps.messaging.listFlaggedMessages({ cursor: query.cursor, limit }));
  }
}

/**
 * Xem nội dung một tin bị gắn cờ (BE-S6-06, AC2): đọc qua facade messaging rồi **ghi audit**
 * `safety.flagged_message.view_detail` trước khi trả nội dung — audit lỗi thì không trả (AGENTS.md mục 5). Tin không
 * tồn tại / không bị gắn cờ → `FLAGGED_MESSAGE_NOT_FOUND` (không ghi audit vì không đọc được gì).
 */
export class GetFlaggedMessage {
  constructor(
    private readonly deps: {
      readonly messaging: Pick<MessagingFacade, 'getFlaggedMessage'>;
      readonly auditLogger: AuditLogger;
    },
  ) {}

  async execute(query: {
    readonly messageId: string;
    readonly actor: ModerationActor;
  }): Promise<Result<FlaggedMessageDetail, DomainError<'FLAGGED_MESSAGE_NOT_FOUND'>>> {
    const message = await this.deps.messaging.getFlaggedMessage(query.messageId);
    if (message === null) return fail('FLAGGED_MESSAGE_NOT_FOUND');
    await auditModeration(this.deps.auditLogger, null, query.actor, {
      action: SAFETY_AUDIT_ACTION.viewFlaggedMessage,
      targetType: SAFETY_AUDIT_TARGET.flaggedMessage,
      targetId: message.messageId,
      meta: {
        conversationId: message.conversationId,
        senderId: message.senderId,
        reasons: [...message.reasons],
      },
    });
    return ok(message);
  }
}
