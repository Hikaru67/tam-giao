import { MATCH_CLOSED, MATCH_LOCKED, MATCH_STARTED_DATING } from '@tamgiao/contracts';
import type { EventBus } from '@tamgiao/db';
import type { DomainEvent, Tx } from '@tamgiao/kernel';
import type {
  CloseConversationForMatch,
  OpenConversationForMatch,
} from '../application/conversation-lifecycle.js';
import type { ConversationCloseReason } from '../domain/conversation.js';

/** Tên consumer (duy nhất toàn hệ thống, `<module>.<việc>`) — đổi tên = consumer mới, event cũ bị xử lý lại. */
export const OPEN_CONVERSATION_ON_MATCH_STARTED_DATING_CONSUMER = 'messaging.open-conversation';
export const CLOSE_CONVERSATION_ON_MATCH_CLOSED_CONSUMER = 'messaging.close-conversation-on-match-closed';
export const CLOSE_CONVERSATION_ON_MATCH_LOCKED_CONSUMER = 'messaging.close-conversation-on-match-locked';

interface MatchEventFields {
  readonly matchId: string;
  readonly participantIds: readonly [string, string];
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const invalid = (event: DomainEvent, field: string): Error =>
  new Error(`${event.type} ${event.eventId}: payload thiếu/sai ${field}`);

/** Trường chung của event matching (`matchId`, `participantIds` đúng 2 người). Sai dạng là lỗi lập trình → throw. */
function matchFields(event: DomainEvent): MatchEventFields & { readonly payload: Record<string, unknown> } {
  const payload = event.payload;
  if (!isRecord(payload)) throw invalid(event, 'payload');
  const { matchId, participantIds } = payload;
  if (typeof matchId !== 'string' || matchId.length === 0) throw invalid(event, 'matchId');
  if (
    !Array.isArray(participantIds) ||
    participantIds.length !== 2 ||
    !participantIds.every((p): p is string => typeof p === 'string' && p.length > 0)
  ) {
    throw invalid(event, 'participantIds');
  }
  const [first, second] = participantIds as [string, string];
  return { matchId, participantIds: [first, second], payload };
}

function stringField(event: DomainEvent, payload: Record<string, unknown>, field: string): string {
  const value = payload[field];
  if (typeof value !== 'string' || value.length === 0) throw invalid(event, field);
  return value;
}

export interface ConversationConsumers {
  readonly open: OpenConversationForMatch;
  readonly close: CloseConversationForMatch;
}

/**
 * Đăng ký consumer vòng đời hội thoại (BE-S6-01) lên `bus`: `MatchStartedDating` → mở; `MatchClosed` / `MatchLocked`
 * → đóng. Handler chạy trong transaction của `deliverOnce` (cùng `processed_events`); bản thân handler cũng idempotent
 * (A9). Không log payload (không có PII nhưng giữ thói quen chỉ log id).
 */
export function registerConversationConsumers(bus: EventBus, consumers: ConversationConsumers): void {
  bus.on(MATCH_STARTED_DATING, OPEN_CONVERSATION_ON_MATCH_STARTED_DATING_CONSUMER, async (event, tx) => {
    const { matchId, participantIds, payload } = matchFields(event);
    const closesAt = new Date(stringField(event, payload, 'expiresAt'));
    if (Number.isNaN(closesAt.getTime())) throw invalid(event, 'expiresAt');
    await consumers.open.handle(tx, { matchId, participantIds, openedAt: event.occurredAt, closesAt });
  });

  const close = (reason: ConversationCloseReason) => async (event: DomainEvent, tx: Tx) => {
    const { matchId, participantIds, payload } = matchFields(event);
    await consumers.close.handle(tx, {
      matchId,
      participantIds,
      fromStatus: stringField(event, payload, 'fromStatus'),
      reason,
      closedAt: event.occurredAt,
    });
  };
  bus.on(MATCH_CLOSED, CLOSE_CONVERSATION_ON_MATCH_CLOSED_CONSUMER, close('MATCH_CLOSED'));
  bus.on(MATCH_LOCKED, CLOSE_CONVERSATION_ON_MATCH_LOCKED_CONSUMER, close('MATCH_LOCKED'));
}
