import {
  KYC_APPROVED,
  KYC_REJECTED,
  MATCH_AWAITING_RESPONSE,
  MATCH_DECLINED,
  MATCH_EXPIRED,
  MATCH_LOCKED,
  MATCH_OFFERED,
  MATCH_STARTED_DATING,
  MESSAGE_SENT,
  REFUND_COMPLETED,
  REPORT_FILED,
  REPORT_STATUS_CHANGED,
} from '@tamgiao/contracts';
import { DATE_REMINDER_HOURS, OFFER_EXPIRY_REMINDER_HOURS } from '@tamgiao/contracts/constants';
import type { EventBus } from '@tamgiao/db';
import { newId, type Clock, type DomainEvent, type Scheduler, type Tx } from '@tamgiao/kernel';
import { reminderTime, type NotificationKind } from '../domain/templates.js';
import type { DrizzleNotificationStore, NewDelivery } from './drizzle-notification-store.js';

/** Hàng đợi job gửi một thông báo (`{deliveryId}`); key job = deliveryId, `runAt` = `send_after`. */
export const NOTIFICATION_SEND_QUEUE = 'notification.send';

/**
 * Event của module dating (BE-S7-01, làm song song) — chưa có contract nên khai báo theo **tên event trong outbox**,
 * không import code dating. Payload giả định tối thiểu (xem `dateParticipants`, `dateStartsAt`).
 */
export const DATE_PROPOSED_EVENT = 'DateProposed';
export const DATE_CONFIRMED_EVENT = 'DateConfirmed';
export const DATE_CANCELLED_EVENT = 'DateCancelled';

/** Tên consumer (duy nhất toàn hệ thống) — đổi tên = consumer mới, event cũ bị xử lý lại. */
export const NOTIFICATION_CONSUMERS = {
  matchOffered: 'notification.on-match-offered',
  matchAwaitingResponse: 'notification.on-match-awaiting-response',
  matchStartedDating: 'notification.on-match-started-dating',
  matchDeclined: 'notification.cancel-offer-reminder-on-match-declined',
  matchExpired: 'notification.cancel-offer-reminder-on-match-expired',
  matchLocked: 'notification.cancel-offer-reminder-on-match-locked',
  messageSent: 'notification.on-message-sent',
  dateProposed: 'notification.on-date-proposed',
  dateConfirmed: 'notification.on-date-confirmed',
  dateCancelled: 'notification.cancel-date-reminder-on-date-cancelled',
  kycApproved: 'notification.on-kyc-approved',
  kycRejected: 'notification.on-kyc-rejected',
  refundCompleted: 'notification.on-refund-completed',
  reportFiled: 'notification.on-report-filed',
  reportStatusChanged: 'notification.on-report-status-changed',
} as const;

type Payload = Readonly<Record<string, unknown>>;

const isRecord = (v: unknown): v is Payload => typeof v === 'object' && v !== null && !Array.isArray(v);

const invalid = (event: DomainEvent, field: string): Error =>
  new Error(`${event.type} ${event.eventId}: payload thiếu/sai ${field}`);

/** Payload sai dạng là lỗi lập trình của bên phát → throw (retry → dead-letter, vận hành thấy ngay). */
function payloadOf(event: DomainEvent): Payload {
  if (!isRecord(event.payload)) throw invalid(event, 'payload');
  return event.payload;
}

function optionalString(p: Payload, field: string): string | undefined {
  const v = p[field];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function str(event: DomainEvent, p: Payload, field: string): string {
  const v = optionalString(p, field);
  if (v === undefined) throw invalid(event, field);
  return v;
}

function optionalStrings(p: Payload, field: string): string[] | undefined {
  const v = p[field];
  if (!Array.isArray(v)) return undefined;
  return v.filter((x): x is string => typeof x === 'string' && x.length > 0);
}

function strings(event: DomainEvent, p: Payload, field: string): string[] {
  const v = optionalStrings(p, field);
  if (v === undefined || v.length === 0) throw invalid(event, field);
  return v;
}

function optionalDate(event: DomainEvent, p: Payload, field: string): Date | undefined {
  const raw = optionalString(p, field);
  if (raw === undefined) return undefined;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw invalid(event, field);
  return d;
}

function date(event: DomainEvent, p: Payload, field: string): Date {
  const d = optionalDate(event, p, field);
  if (d === undefined) throw invalid(event, field);
  return d;
}

/**
 * Người tham gia lịch hẹn (giả định payload dating): ưu tiên `participantIds`; không có thì gom các trường
 * `proposerId`/`proposedBy`/`inviterId`/`inviteeId`.
 */
function dateParticipants(event: DomainEvent, p: Payload): string[] {
  const listed = optionalStrings(p, 'participantIds');
  const ids =
    listed !== undefined && listed.length > 0
      ? listed
      : ['proposerId', 'proposedBy', 'inviterId', 'inviteeId']
          .map((f) => optionalString(p, f))
          .filter((x): x is string => x !== undefined);
  if (ids.length === 0) throw invalid(event, 'participantIds');
  return [...new Set(ids)];
}

/** Người đề xuất lịch hẹn (giả định: `proposerId` | `proposedBy` | `inviterId`). */
const dateProposer = (p: Payload): string | undefined =>
  optionalString(p, 'proposerId') ?? optionalString(p, 'proposedBy') ?? optionalString(p, 'inviterId');

/** Giờ bắt đầu buổi hẹn (giả định: `startsAt` | `scheduledAt` | `startAt`, ISO 8601). */
const dateStartsAt = (event: DomainEvent, p: Payload): Date | undefined =>
  optionalDate(event, p, 'startsAt') ??
  optionalDate(event, p, 'scheduledAt') ??
  optionalDate(event, p, 'startAt');

/** Id lịch hẹn: `datePlanId` | `dateId` trong payload, mặc định `aggregateId` của event. */
const dateId = (event: DomainEvent, p: Payload): string =>
  optionalString(p, 'datePlanId') ?? optionalString(p, 'dateId') ?? event.aggregateId;

interface NotifyRequest {
  readonly kind: NotificationKind;
  readonly userIds: readonly string[];
  readonly aggregateId: string;
  readonly data: Readonly<Record<string, string>>;
  /** Mặc định: `occurredAt` của event (gửi ngay). */
  readonly sendAfter?: Date;
}

export interface NotificationConsumerDeps {
  readonly clock: Clock;
  readonly store: DrizzleNotificationStore;
  readonly scheduler: Scheduler;
}

/**
 * Ghi thông báo `PENDING` (mỗi người một dòng, unique theo event + người + loại) rồi hẹn job gửi **cùng transaction**
 * (`Scheduler`) chỉ cho dòng mới thêm — event xử lý lại không sinh thông báo/job mới (AC1, A9). Gửi thật chạy ở job
 * `notification.send` ngoài transaction consumer (không giữ connection khi gọi nhà cung cấp).
 */
async function notify(
  deps: NotificationConsumerDeps,
  tx: Tx,
  event: DomainEvent,
  requests: readonly NotifyRequest[],
): Promise<void> {
  const rows: NewDelivery[] = requests.flatMap((r) =>
    [...new Set(r.userIds)].map((userId) => ({
      id: newId(),
      eventId: event.eventId,
      eventType: event.type,
      kind: r.kind,
      userId,
      aggregateId: r.aggregateId,
      data: r.data,
      sendAfter: r.sendAfter ?? event.occurredAt,
    })),
  );
  const inserted = await deps.store.insertDeliveries(tx, rows, deps.clock.now());
  for (const row of inserted) {
    await deps.scheduler.schedule(tx, {
      queue: NOTIFICATION_SEND_QUEUE,
      key: row.id,
      runAt: row.sendAfter,
      payload: { deliveryId: row.id },
    });
  }
}

/** Nhắc "gợi ý sắp hết hạn" cho `userIds` nếu mốc nhắc còn ở tương lai so với lúc phát event. */
function offerReminder(
  event: DomainEvent,
  matchId: string,
  userIds: readonly string[],
  expiresAt: Date,
): NotifyRequest[] {
  const at = reminderTime(expiresAt, OFFER_EXPIRY_REMINDER_HOURS, event.occurredAt);
  return at === null
    ? []
    : [{ kind: 'MATCH_OFFER_EXPIRING', userIds, aggregateId: matchId, data: { matchId }, sendAfter: at }];
}

/**
 * Đăng ký consumer notification lên `bus` (BE-S7-05). Mỗi consumer chạy trong transaction của `deliverOnce` (cùng
 * `processed_events`); không log payload.
 *
 * Nhắc nhở hẹn trước (gợi ý sắp hết hạn, lịch hẹn trước `DATE_REMINDER_HOURS` giờ) là dòng `PENDING` có `send_after` ở
 * tương lai; event làm nhắc nhở mất ý nghĩa (match đã phản hồi/hết hạn/khoá, lịch hẹn bị huỷ) chuyển dòng sang
 * `CANCELLED`.
 */
export function registerNotificationConsumers(bus: EventBus, deps: NotificationConsumerDeps): void {
  const { store, clock } = deps;
  const cancelOfferReminders = (tx: Tx, event: DomainEvent, matchId: string) =>
    store.cancelPending(tx, {
      aggregateId: matchId,
      kind: 'MATCH_OFFER_EXPIRING',
      exceptEventId: event.eventId,
      now: clock.now(),
    });

  bus.on(MATCH_OFFERED, NOTIFICATION_CONSUMERS.matchOffered, async (event, tx) => {
    const p = payloadOf(event);
    const matchId = str(event, p, 'matchId');
    const participants = strings(event, p, 'participantIds');
    await notify(deps, tx, event, [
      { kind: 'MATCH_OFFERED', userIds: participants, aggregateId: matchId, data: { matchId } },
      ...offerReminder(event, matchId, participants, date(event, p, 'expiresAt')),
    ]);
  });

  bus.on(MATCH_AWAITING_RESPONSE, NOTIFICATION_CONSUMERS.matchAwaitingResponse, async (event, tx) => {
    const p = payloadOf(event);
    const matchId = str(event, p, 'matchId');
    const awaiting = str(event, p, 'awaitingUserId');
    // Hạn phản hồi đổi (`RESPONSE_TTL_HOURS` từ lúc bên kia đồng ý): huỷ nhắc cũ, nhắc lại theo hạn mới cho người còn lại.
    await cancelOfferReminders(tx, event, matchId);
    await notify(deps, tx, event, [
      { kind: 'MATCH_AWAITING_RESPONSE', userIds: [awaiting], aggregateId: matchId, data: { matchId } },
      ...offerReminder(event, matchId, [awaiting], date(event, p, 'expiresAt')),
    ]);
  });

  bus.on(MATCH_STARTED_DATING, NOTIFICATION_CONSUMERS.matchStartedDating, async (event, tx) => {
    const p = payloadOf(event);
    const matchId = str(event, p, 'matchId');
    await cancelOfferReminders(tx, event, matchId);
    await notify(deps, tx, event, [
      {
        kind: 'MATCH_STARTED_DATING',
        userIds: strings(event, p, 'participantIds'),
        aggregateId: matchId,
        data: { matchId },
      },
    ]);
  });

  const cancelOnly = async (event: DomainEvent, tx: Tx) => {
    await cancelOfferReminders(tx, event, str(event, payloadOf(event), 'matchId'));
  };
  bus.on(MATCH_DECLINED, NOTIFICATION_CONSUMERS.matchDeclined, cancelOnly);
  bus.on(MATCH_EXPIRED, NOTIFICATION_CONSUMERS.matchExpired, cancelOnly);
  bus.on(MATCH_LOCKED, NOTIFICATION_CONSUMERS.matchLocked, cancelOnly);

  bus.on(MESSAGE_SENT, NOTIFICATION_CONSUMERS.messageSent, async (event, tx) => {
    const p = payloadOf(event);
    // Tin hệ thống (mở/đóng hội thoại, cảnh báo lừa đảo) không push — đã có thông báo riêng hoặc chỉ hiện trong chat.
    if (optionalString(p, 'senderId') === undefined || optionalString(p, 'systemCode') !== undefined) return;
    const conversationId = str(event, p, 'conversationId');
    await notify(deps, tx, event, [
      {
        kind: 'MESSAGE_RECEIVED',
        userIds: optionalStrings(p, 'recipientIds') ?? [],
        aggregateId: conversationId,
        data: { conversationId },
      },
    ]);
  });

  bus.on(DATE_PROPOSED_EVENT, NOTIFICATION_CONSUMERS.dateProposed, async (event, tx) => {
    const p = payloadOf(event);
    const id = dateId(event, p);
    const invitee = optionalString(p, 'inviteeId');
    const proposer = dateProposer(p);
    const recipients =
      invitee !== undefined ? [invitee] : dateParticipants(event, p).filter((u) => u !== proposer);
    await notify(deps, tx, event, [
      { kind: 'DATE_PROPOSED', userIds: recipients, aggregateId: id, data: { datePlanId: id } },
    ]);
  });

  bus.on(DATE_CONFIRMED_EVENT, NOTIFICATION_CONSUMERS.dateConfirmed, async (event, tx) => {
    const p = payloadOf(event);
    const id = dateId(event, p);
    const participants = dateParticipants(event, p);
    const confirmedBy = optionalString(p, 'confirmedBy');
    const startsAt = dateStartsAt(event, p);
    const remindAt =
      startsAt === undefined ? null : reminderTime(startsAt, DATE_REMINDER_HOURS, event.occurredAt);
    const data = { datePlanId: id };
    await notify(deps, tx, event, [
      {
        kind: 'DATE_CONFIRMED',
        userIds: participants.filter((u) => u !== confirmedBy),
        aggregateId: id,
        data,
      },
      ...(remindAt === null
        ? []
        : [
            {
              kind: 'DATE_REMINDER' as const,
              userIds: participants,
              aggregateId: id,
              data,
              sendAfter: remindAt,
            },
          ]),
    ]);
  });

  bus.on(DATE_CANCELLED_EVENT, NOTIFICATION_CONSUMERS.dateCancelled, async (event, tx) => {
    await store.cancelPending(tx, {
      aggregateId: dateId(event, payloadOf(event)),
      kind: 'DATE_REMINDER',
      exceptEventId: event.eventId,
      now: clock.now(),
    });
  });

  const accountEvent =
    (kind: NotificationKind, aggregateField: string) => async (event: DomainEvent, tx: Tx) => {
      const p = payloadOf(event);
      const aggregateId = str(event, p, aggregateField);
      await notify(deps, tx, event, [
        { kind, userIds: [str(event, p, 'userId')], aggregateId, data: { [aggregateField]: aggregateId } },
      ]);
    };
  bus.on(KYC_APPROVED, NOTIFICATION_CONSUMERS.kycApproved, accountEvent('KYC_APPROVED', 'submissionId'));
  bus.on(KYC_REJECTED, NOTIFICATION_CONSUMERS.kycRejected, accountEvent('KYC_REJECTED', 'submissionId'));
  bus.on(
    REFUND_COMPLETED,
    NOTIFICATION_CONSUMERS.refundCompleted,
    accountEvent('REFUND_COMPLETED', 'paymentId'),
  );

  bus.on(REPORT_FILED, NOTIFICATION_CONSUMERS.reportFiled, async (event, tx) => {
    const p = payloadOf(event);
    const reportId = str(event, p, 'reportId');
    await notify(deps, tx, event, [
      {
        kind: 'REPORT_RECEIVED',
        userIds: [str(event, p, 'reporterId')],
        aggregateId: reportId,
        data: { reportId },
      },
    ]);
  });

  bus.on(REPORT_STATUS_CHANGED, NOTIFICATION_CONSUMERS.reportStatusChanged, async (event, tx) => {
    const p = payloadOf(event);
    const reportId = str(event, p, 'reportId');
    // `ReportStatusChanged` không mang người báo cáo: tra từ thông báo `REPORT_RECEIVED` (consumer `ReportFiled`). Chưa có
    // (event tới trước do mỗi consumer một hàng đợi) → throw để pg-boss thử lại sau.
    const reporterId = await store.findReporterId(tx, reportId);
    if (reporterId === null)
      throw new Error(`${event.type} ${event.eventId}: chưa biết người báo cáo ${reportId}`);
    await notify(deps, tx, event, [
      { kind: 'REPORT_UPDATED', userIds: [reporterId], aggregateId: reportId, data: { reportId } },
    ]);
  });
}
