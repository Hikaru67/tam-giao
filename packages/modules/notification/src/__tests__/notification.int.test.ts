import {
  KYC_APPROVED,
  KYC_REJECTED,
  MATCH_AWAITING_RESPONSE,
  MATCH_DECLINED,
  MATCH_OFFERED,
  MATCH_STARTED_DATING,
  MESSAGE_SENT,
  REFUND_COMPLETED,
  REPORT_FILED,
  REPORT_STATUS_CHANGED,
} from '@tamgiao/contracts';
import { DrizzleUnitOfWork, EventBus, createDatabase, deliverOnce, type Database } from '@tamgiao/db';
import {
  FakeClock,
  addDuration,
  newId,
  ok,
  type DomainEvent,
  type ScheduledJob,
  type Scheduler,
} from '@tamgiao/kernel';
import { resetDatabase, testDatabaseUrl } from '@tamgiao/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SmsMessage } from '../application/ports/sms.js';
import { templateFor, type NotificationKind } from '../domain/templates.js';
import { DrizzleNotificationStore } from '../infrastructure/drizzle-notification-store.js';
import { FakePushSender } from '../infrastructure/fake-push-sender.js';
import {
  DATE_CANCELLED_EVENT,
  DATE_CONFIRMED_EVENT,
  DATE_PROPOSED_EVENT,
  NOTIFICATION_CONSUMERS,
  NOTIFICATION_SEND_QUEUE,
} from '../infrastructure/notification-consumers.js';
import { PushTemporarilyFailedError } from '../infrastructure/send-notification.js';
import { createNotificationWorker, type NotificationWorker } from '../index.js';

const T0 = new Date('2026-06-01T08:00:00.000Z');
const clock = new FakeClock(T0);

let database: Database;
let uow: DrizzleUnitOfWork;
let worker: NotificationWorker;
let bus: EventBus;
let push: FakePushSender;
let scheduled: ScheduledJob[];
let smsSent: SmsMessage[];
const phoneBook = new Map<string, string>();
const store = new DrizzleNotificationStore();

const scheduler: Scheduler = {
  schedule: async (_tx, job) => {
    scheduled.push(job);
  },
};

const sql = (text: string, params: unknown[] = []) => database.pool.query(text, params);

function event(type: string, payload: Record<string, unknown>, occurredAt: Date = T0): DomainEvent {
  return {
    eventId: newId(),
    type,
    aggregateType: 'Test',
    aggregateId: typeof payload.datePlanId === 'string' ? payload.datePlanId : newId(),
    version: 1,
    occurredAt,
    payload,
  };
}

/** Giao event cho mọi consumer notification của loại đó (giống relay: `deliverOnce` + `processed_events`). */
async function deliver(e: DomainEvent): Promise<void> {
  const subs = bus.consumersOf(e.type);
  if (subs.length === 0) throw new Error(`không có consumer cho ${e.type}`);
  for (const s of subs) await deliverOnce(uow, s, e);
}

/** Gọi thẳng handler (bỏ qua `processed_events`) — kiểm tra bản thân handler idempotent (A9). */
async function handleDirectly(e: DomainEvent): Promise<void> {
  for (const s of bus.consumersOf(e.type)) {
    await uow.run(async (tx) => {
      await s.handler(e, tx);
      return ok(undefined);
    });
  }
}

interface DeliveryRow {
  id: string;
  kind: NotificationKind;
  user_id: string;
  aggregate_id: string;
  status: string;
  channel: string | null;
  skip_reason: string | null;
  send_after: Date;
  data: Record<string, string>;
}

async function deliveriesOf(eventId?: string): Promise<DeliveryRow[]> {
  const { rows } = await sql(
    `select id, kind, user_id, aggregate_id, status, channel, skip_reason, send_after, data
       from notification.deliveries ${eventId ? 'where event_id = $1' : ''} order by kind, user_id`,
    eventId ? [eventId] : [],
  );
  return rows as DeliveryRow[];
}

async function registerDevice(userId: string, token: string): Promise<void> {
  await uow.run(async (tx) =>
    ok(await store.upsertDevice(tx, { id: newId(), userId, token, platform: 'ios', now: clock.now() })),
  );
}

async function tokensOf(userId: string): Promise<string[]> {
  const { rows } = await sql('select token from notification.devices where user_id = $1 order by token', [
    userId,
  ]);
  return rows.map((r: { token: string }) => r.token);
}

const send = (deliveryId: string) => worker.sendNotification.execute(deliveryId);

beforeAll(() => {
  database = createDatabase(testDatabaseUrl(), { maxConnections: 5 });
  uow = new DrizzleUnitOfWork(database.pool);
});
beforeEach(async () => {
  await resetDatabase(database.pool);
  clock.set(T0);
  scheduled = [];
  smsSent = [];
  phoneBook.clear();
  push = new FakePushSender();
  worker = createNotificationWorker({
    uow,
    clock,
    scheduler,
    push,
    sms: { send: async (m) => void smsSent.push(m) },
    phones: { findPhoneNumber: async (userId) => phoneBook.get(userId) ?? null },
  });
  bus = new EventBus();
  worker.registerConsumers(bus);
});
afterAll(() => database.close());

describe('consumer event → thông báo (AC1: mỗi event đúng 1 thông báo / người nhận, idempotent)', () => {
  const a = newId();
  const b = newId();
  const matchId = newId();
  const datePlanId = newId();
  const conversationId = newId();
  const reportId = newId();
  const in24h = addDuration(T0, { hours: 24 }).toISOString();

  /** [event, các thông báo gửi ngay mong đợi (kind → người nhận)]. */
  const cases: [string, () => DomainEvent, [NotificationKind, string[]][]][] = [
    [
      'MatchOffered',
      () => event(MATCH_OFFERED, { matchId, participantIds: [a, b], createdBy: newId(), expiresAt: in24h }),
      [
        ['MATCH_OFFERED', [a, b]],
        ['MATCH_OFFER_EXPIRING', [a, b]],
      ],
    ],
    [
      'MatchAwaitingResponse',
      () =>
        event(MATCH_AWAITING_RESPONSE, {
          matchId,
          participantIds: [a, b],
          acceptedBy: a,
          awaitingUserId: b,
          expiresAt: in24h,
        }),
      [
        ['MATCH_AWAITING_RESPONSE', [b]],
        ['MATCH_OFFER_EXPIRING', [b]],
      ],
    ],
    [
      'MatchStartedDating',
      () => event(MATCH_STARTED_DATING, { matchId, participantIds: [a, b], expiresAt: in24h }),
      [['MATCH_STARTED_DATING', [a, b]]],
    ],
    [
      'MessageSent',
      () =>
        event(MESSAGE_SENT, {
          messageId: newId(),
          conversationId,
          senderId: a,
          recipientIds: [b],
          kind: 'TEXT',
          systemCode: null,
          flagged: false,
          sentAt: T0.toISOString(),
        }),
      [['MESSAGE_RECEIVED', [b]]],
    ],
    [
      'DateProposed',
      () => event(DATE_PROPOSED_EVENT, { datePlanId, matchId, participantIds: [a, b], proposedBy: a }),
      [['DATE_PROPOSED', [b]]],
    ],
    [
      'DateConfirmed',
      () =>
        event(DATE_CONFIRMED_EVENT, {
          datePlanId,
          matchId,
          participantIds: [a, b],
          confirmedBy: b,
          startsAt: addDuration(T0, { days: 3 }).toISOString(),
        }),
      [
        ['DATE_CONFIRMED', [a]],
        ['DATE_REMINDER', [a, b]],
      ],
    ],
    ['KycApproved', () => event(KYC_APPROVED, { submissionId: newId(), userId: a }), [['KYC_APPROVED', [a]]]],
    [
      'KycRejected',
      () => event(KYC_REJECTED, { submissionId: newId(), userId: a, reasonCode: 'OTHER' }),
      [['KYC_REJECTED', [a]]],
    ],
    [
      'RefundCompleted',
      () => event(REFUND_COMPLETED, { paymentId: newId(), orderId: 'VP1', userId: a, amountVnd: 299_000 }),
      [['REFUND_COMPLETED', [a]]],
    ],
    [
      'ReportFiled',
      () =>
        event(REPORT_FILED, {
          reportId,
          reporterId: a,
          reportedUserId: b,
          matchId,
          category: 'HARASSMENT',
          severity: 'HIGH',
          urgent: false,
          dueAt: null,
        }),
      [['REPORT_RECEIVED', [a]]],
    ],
  ];

  it.each(cases)('%s', async (_name, make, expected) => {
    const e = make();
    await deliver(e);
    await deliver(e); // relay giao lại
    await handleDirectly(e); // processed_events mất / consumer chạy lại
    const rows = await deliveriesOf(e.eventId);
    const want = expected
      .flatMap(([kind, users]) => users.map((u) => `${kind}:${u}`))
      .sort((x, y) => x.localeCompare(y));
    expect(rows.map((r) => `${r.kind}:${r.user_id}`).sort((x, y) => x.localeCompare(y))).toEqual(want);
    expect(rows.every((r) => r.status === 'PENDING')).toBe(true);
    // Mỗi thông báo đúng một job gửi, key = deliveryId, chạy lúc `send_after`.
    expect(scheduled.map((j) => j.key).sort()).toEqual(rows.map((r) => r.id).sort());
    for (const job of scheduled) {
      const row = rows.find((r) => r.id === job.key);
      expect(job.queue).toBe(NOTIFICATION_SEND_QUEUE);
      expect(job.payload).toEqual({ deliveryId: job.key });
      expect(job.runAt).toEqual(row?.send_after);
    }
  });

  it('ReportStatusChanged → REPORT_UPDATED cho người báo cáo (tra từ ReportFiled); tới trước ReportFiled → throw để retry', async () => {
    const changed = event(REPORT_STATUS_CHANGED, { reportId, fromStatus: 'OPEN', toStatus: 'IN_REVIEW' });
    const [sub] = bus.consumersOf(REPORT_STATUS_CHANGED);
    if (!sub) throw new Error('missing consumer');
    await expect(deliverOnce(uow, sub, changed)).rejects.toThrow('chưa biết người báo cáo');
    expect(await deliveriesOf(changed.eventId)).toEqual([]);

    await deliver(cases.find(([n]) => n === 'ReportFiled')?.[1]() ?? changed);
    await deliver(changed);
    await deliver(changed);
    const rows = await deliveriesOf(changed.eventId);
    expect(rows.map((r) => [r.kind, r.user_id, r.data])).toEqual([['REPORT_UPDATED', a, { reportId }]]);
  });

  it('MessageSent của tin hệ thống / không có người gửi → không thông báo', async () => {
    const base = {
      messageId: newId(),
      conversationId,
      recipientIds: [a, b],
      kind: 'SYSTEM',
      flagged: false,
      sentAt: T0.toISOString(),
    };
    await deliver(event(MESSAGE_SENT, { ...base, senderId: null, systemCode: 'CONVERSATION_OPENED' }));
    await deliver(
      event(MESSAGE_SENT, { ...base, senderId: a, systemCode: 'FRAUD_WARNING', recipientIds: [b] }),
    );
    expect(await deliveriesOf()).toEqual([]);
  });

  it('DateProposed với `inviteeId` (payload dating khác giả định) vẫn tìm đúng người nhận', async () => {
    const e = event(DATE_PROPOSED_EVENT, { inviterId: a, inviteeId: b });
    await deliver(e);
    expect((await deliveriesOf(e.eventId)).map((r) => [r.kind, r.user_id, r.aggregate_id])).toEqual([
      ['DATE_PROPOSED', b, e.aggregateId],
    ]);
  });

  it('payload sai dạng → throw (lỗi lập trình của bên phát, retry → dead-letter)', async () => {
    const [sub] = bus.consumersOf(MATCH_OFFERED);
    if (!sub) throw new Error('missing consumer');
    await expect(deliverOnce(uow, sub, event(MATCH_OFFERED, { matchId }))).rejects.toThrow('participantIds');
  });

  it('đăng ký đủ consumer, tên duy nhất dạng notification.<việc>', () => {
    expect(
      bus
        .list()
        .map((s) => s.consumer)
        .sort(),
    ).toEqual(Object.values(NOTIFICATION_CONSUMERS).sort());
  });
});

describe('nhắc nhở hẹn giờ (còn 2h trước hết hạn gợi ý, trước giờ hẹn 2h)', () => {
  const a = newId();
  const b = newId();

  it('MatchOffered: nhắc lúc expiresAt − 2h, chưa tới giờ thì không gửi; tới giờ thì gửi', async () => {
    const matchId = newId();
    const expiresAt = addDuration(T0, { hours: 24 });
    await deliver(
      event(MATCH_OFFERED, {
        matchId,
        participantIds: [a, b],
        createdBy: newId(),
        expiresAt: expiresAt.toISOString(),
      }),
    );
    const reminders = (await deliveriesOf()).filter((r) => r.kind === 'MATCH_OFFER_EXPIRING');
    expect(reminders.map((r) => r.send_after)).toEqual([
      addDuration(T0, { hours: 22 }),
      addDuration(T0, { hours: 22 }),
    ]);
    await registerDevice(a, 'ExponentPushToken[a1]');
    const [first] = reminders.filter((r) => r.user_id === a);
    if (!first) throw new Error('missing reminder');
    expect(await send(first.id)).toEqual({ kind: 'NOT_DUE', sendAfter: addDuration(T0, { hours: 22 }) });
    expect(push.sent).toHaveLength(0);
    clock.set(addDuration(T0, { hours: 22 }));
    expect(await send(first.id)).toMatchObject({ kind: 'SENT', channel: 'PUSH' });
    expect(push.sent.map((m) => m.title)).toEqual([templateFor('MATCH_OFFER_EXPIRING').title]);
  });

  it('MatchAwaitingResponse huỷ nhắc cũ, nhắc lại theo hạn mới cho người còn phải phản hồi; MatchDeclined huỷ hết', async () => {
    const matchId = newId();
    await deliver(
      event(MATCH_OFFERED, {
        matchId,
        participantIds: [a, b],
        createdBy: newId(),
        expiresAt: addDuration(T0, { hours: 24 }).toISOString(),
      }),
    );
    const acceptedAt = addDuration(T0, { hours: 5 });
    clock.set(acceptedAt);
    await deliver(
      event(
        MATCH_AWAITING_RESPONSE,
        {
          matchId,
          participantIds: [a, b],
          acceptedBy: a,
          awaitingUserId: b,
          expiresAt: addDuration(acceptedAt, { hours: 24 }).toISOString(),
        },
        acceptedAt,
      ),
    );
    const reminders = (await deliveriesOf()).filter((r) => r.kind === 'MATCH_OFFER_EXPIRING');
    expect(reminders.map((r) => [r.user_id, r.status, r.send_after.toISOString()]).sort()).toEqual(
      [
        [a, 'CANCELLED', addDuration(T0, { hours: 22 }).toISOString()],
        [b, 'CANCELLED', addDuration(T0, { hours: 22 }).toISOString()],
        [b, 'PENDING', addDuration(acceptedAt, { hours: 22 }).toISOString()],
      ].sort(),
    );

    // Nhắc đã huỷ không được gửi.
    await registerDevice(a, 'ExponentPushToken[a1]');
    clock.set(addDuration(T0, { hours: 23 }));
    const cancelled = reminders.find((r) => r.user_id === a);
    if (!cancelled) throw new Error('missing');
    expect(await send(cancelled.id)).toEqual({ kind: 'ALREADY_DONE', status: 'CANCELLED' });
    expect(push.sent).toHaveLength(0);

    await deliver(
      event(MATCH_DECLINED, {
        matchId,
        participantIds: [a, b],
        declinedBy: b,
        fromStatus: 'AWAITING_RESPONSE',
        withdrawn: false,
      }),
    );
    const after = (await deliveriesOf()).filter((r) => r.kind === 'MATCH_OFFER_EXPIRING');
    expect(after.every((r) => r.status === 'CANCELLED')).toBe(true);
  });

  it('MatchStartedDating huỷ nhắc hết hạn gợi ý', async () => {
    const matchId = newId();
    await deliver(
      event(MATCH_OFFERED, {
        matchId,
        participantIds: [a, b],
        createdBy: newId(),
        expiresAt: addDuration(T0, { hours: 24 }).toISOString(),
      }),
    );
    await deliver(
      event(MATCH_STARTED_DATING, { matchId, participantIds: [a, b], expiresAt: T0.toISOString() }),
    );
    const reminders = (await deliveriesOf()).filter((r) => r.kind === 'MATCH_OFFER_EXPIRING');
    expect(reminders.map((r) => r.status)).toEqual(['CANCELLED', 'CANCELLED']);
  });

  it('DateConfirmed: nhắc trước giờ hẹn 2h cho cả hai; DateCancelled huỷ nhắc', async () => {
    const datePlanId = newId();
    const startsAt = addDuration(T0, { days: 2 });
    await deliver(
      event(DATE_CONFIRMED_EVENT, { datePlanId, participantIds: [a, b], startsAt: startsAt.toISOString() }),
    );
    const reminders = (await deliveriesOf()).filter((r) => r.kind === 'DATE_REMINDER');
    expect(reminders.map((r) => [r.status, r.send_after])).toEqual([
      ['PENDING', addDuration(startsAt, { hours: -2 })],
      ['PENDING', addDuration(startsAt, { hours: -2 })],
    ]);
    await deliver(event(DATE_CANCELLED_EVENT, { datePlanId, participantIds: [a, b] }));
    const after = (await deliveriesOf()).filter((r) => r.kind === 'DATE_REMINDER');
    expect(after.map((r) => r.status)).toEqual(['CANCELLED', 'CANCELLED']);
    // DATE_CONFIRMED đã gửi/đang chờ không bị đụng tới.
    expect((await deliveriesOf()).filter((r) => r.kind === 'DATE_CONFIRMED').map((r) => r.status)).toEqual([
      'PENDING',
      'PENDING',
    ]);
  });

  it('DateConfirmed sát giờ (< 2h) hoặc thiếu giờ hẹn → không tạo nhắc', async () => {
    await deliver(
      event(DATE_CONFIRMED_EVENT, {
        datePlanId: newId(),
        participantIds: [a, b],
        startsAt: addDuration(T0, { hours: 1 }).toISOString(),
      }),
    );
    await deliver(event(DATE_CONFIRMED_EVENT, { datePlanId: newId(), participantIds: [a, b] }));
    expect((await deliveriesOf()).filter((r) => r.kind === 'DATE_REMINDER')).toEqual([]);
  });
});

describe('gửi thông báo (job notification.send) với FakePushSender', () => {
  const a = newId();

  async function pendingFor(e: DomainEvent, kind: NotificationKind): Promise<DeliveryRow> {
    await deliver(e);
    const row = (await deliveriesOf(e.eventId)).find((r) => r.kind === kind);
    if (!row) throw new Error(`missing ${kind}`);
    return row;
  }
  const kycApproved = () => event(KYC_APPROVED, { submissionId: newId(), userId: a });
  const messageTo = (userId: string) =>
    event(MESSAGE_SENT, {
      messageId: newId(),
      conversationId: newId(),
      senderId: newId(),
      recipientIds: [userId],
      kind: 'TEXT',
      systemCode: null,
      flagged: false,
      sentAt: T0.toISOString(),
    });

  it('push tới mọi thiết bị: nội dung đúng template, không PII, data chỉ có id; gửi lại không push trùng', async () => {
    await registerDevice(a, 'ExponentPushToken[a1]');
    await registerDevice(a, 'ExponentPushToken[a2]');
    const row = await pendingFor(messageTo(a), 'MESSAGE_RECEIVED');
    expect(await send(row.id)).toEqual({
      kind: 'SENT',
      channel: 'PUSH',
      pushedDevices: 2,
      removedDevices: 0,
    });
    const t = templateFor('MESSAGE_RECEIVED');
    expect(push.sent.map((m) => m.token).sort()).toEqual(['ExponentPushToken[a1]', 'ExponentPushToken[a2]']);
    for (const m of push.sent) {
      expect(m.title).toBe(t.title);
      expect(m.body).toBe(t.body);
      expect(m.data).toEqual({
        kind: 'MESSAGE_RECEIVED',
        deliveryId: row.id,
        conversationId: row.aggregate_id,
      });
    }
    expect((await deliveriesOf(undefined)).map((r) => [r.status, r.channel])).toEqual([['SENT', 'PUSH']]);

    expect(await send(row.id)).toEqual({ kind: 'ALREADY_DONE', status: 'SENT' });
    expect(push.sent).toHaveLength(2);
  });

  it('AC2: token Expo báo không hợp lệ → tự xoá thiết bị đó, thiết bị khác vẫn nhận', async () => {
    await registerDevice(a, 'ExponentPushToken[dead]');
    await registerDevice(a, 'ExponentPushToken[live]');
    push.invalidTokens.add('ExponentPushToken[dead]');
    const row = await pendingFor(messageTo(a), 'MESSAGE_RECEIVED');
    expect(await send(row.id)).toEqual({
      kind: 'SENT',
      channel: 'PUSH',
      pushedDevices: 1,
      removedDevices: 1,
    });
    expect(await tokensOf(a)).toEqual(['ExponentPushToken[live]']);
  });

  it('AC2: mọi token hỏng → xoá hết; thông báo thường → SKIPPED NO_DEVICE', async () => {
    await registerDevice(a, 'ExponentPushToken[dead]');
    push.invalidTokens.add('ExponentPushToken[dead]');
    const row = await pendingFor(messageTo(a), 'MESSAGE_RECEIVED');
    expect(await send(row.id)).toEqual({ kind: 'SKIPPED', reason: 'NO_DEVICE', removedDevices: 1 });
    expect(await tokensOf(a)).toEqual([]);
    expect(smsSent).toEqual([]);
  });

  it('thông báo giao dịch không push được → SMS thay thế (SĐT tra qua PhoneDirectory)', async () => {
    phoneBook.set(a, '+84901234567');
    const row = await pendingFor(kycApproved(), 'KYC_APPROVED');
    expect(await send(row.id)).toEqual({ kind: 'SENT', channel: 'SMS', pushedDevices: 0, removedDevices: 0 });
    const t = templateFor('KYC_APPROVED');
    expect(smsSent).toEqual([{ to: '+84901234567', text: `Tam Giao: ${t.title}. ${t.body}` }]);
    expect(await send(row.id)).toEqual({ kind: 'ALREADY_DONE', status: 'SENT' });
    expect(smsSent).toHaveLength(1);
  });

  it('thông báo giao dịch, không thiết bị, không SĐT → SKIPPED NO_DEVICE', async () => {
    const row = await pendingFor(kycApproved(), 'KYC_APPROVED');
    expect(await send(row.id)).toEqual({ kind: 'SKIPPED', reason: 'NO_DEVICE', removedDevices: 0 });
  });

  it('lỗi push tạm thời ở mọi thiết bị → throw để retry, thông báo giữ PENDING; lần sau thành công', async () => {
    await registerDevice(a, 'ExponentPushToken[a1]');
    push.failWith = { retryable: true, code: 'MessageRateExceeded' };
    const row = await pendingFor(messageTo(a), 'MESSAGE_RECEIVED');
    await expect(send(row.id)).rejects.toBeInstanceOf(PushTemporarilyFailedError);
    expect((await deliveriesOf()).map((r) => r.status)).toEqual(['PENDING']);
    push.failWith = null;
    expect(await send(row.id)).toMatchObject({ kind: 'SENT', channel: 'PUSH' });
  });

  it('bị từ chối vĩnh viễn → FAILED PUSH_REJECTED (giữ thiết bị)', async () => {
    await registerDevice(a, 'ExponentPushToken[a1]');
    push.failWith = { retryable: false, code: 'MessageTooBig' };
    const row = await pendingFor(messageTo(a), 'MESSAGE_RECEIVED');
    expect(await send(row.id)).toEqual({ kind: 'FAILED', reason: 'PUSH_REJECTED', removedDevices: 0 });
    expect(await tokensOf(a)).toEqual(['ExponentPushToken[a1]']);
  });

  it('người dùng tắt nhóm MESSAGE → SKIPPED OPTED_OUT; thông báo ACCOUNT vẫn gửi', async () => {
    await registerDevice(a, 'ExponentPushToken[a1]');
    await uow.run(async (tx) => {
      await store.savePreferences(tx, a, { matches: true, messages: false, dates: true }, clock.now());
      return ok(undefined);
    });
    const msg = await pendingFor(messageTo(a), 'MESSAGE_RECEIVED');
    expect(await send(msg.id)).toEqual({ kind: 'SKIPPED', reason: 'OPTED_OUT', removedDevices: 0 });
    const kyc = await pendingFor(kycApproved(), 'KYC_APPROVED');
    expect(await send(kyc.id)).toMatchObject({ kind: 'SENT', channel: 'PUSH' });
    expect(push.sent.map((m) => m.data.kind)).toEqual(['KYC_APPROVED']);
  });

  it('không tồn tại → NOT_FOUND', async () => {
    expect(await send(newId())).toEqual({ kind: 'NOT_FOUND' });
  });

  it('token chuyển sang người khác (đăng nhập tài khoản khác trên cùng máy) → người cũ không còn nhận', async () => {
    const other = newId();
    await registerDevice(a, 'ExponentPushToken[shared]');
    await registerDevice(other, 'ExponentPushToken[shared]');
    expect(await tokensOf(a)).toEqual([]);
    expect(await tokensOf(other)).toEqual(['ExponentPushToken[shared]']);
  });
});
