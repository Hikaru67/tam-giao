import { MATCH_STARTED_DATING } from '@tamgiao/contracts';
import {
  DATING_DAYS,
  DATING_FINAL_REMINDER_DAY,
  DATING_FIRST_REMINDER_DAY,
} from '@tamgiao/contracts/constants';
import {
  DrizzleUnitOfWork,
  EventBus,
  createDatabase,
  deliverOnce,
  type Database,
} from '@tamgiao/db';
import {
  FakeClock,
  addDuration,
  newId,
  type DomainEvent,
  type ScheduledJob,
  type Scheduler,
} from '@tamgiao/kernel';
import {
  DATE_COMPLETED_EVENT,
  createExpireMatchJob,
  createMatchingWorker,
} from '@tamgiao/module-matching';
import { createMessagingWorker } from '@tamgiao/module-messaging';
import {
  FakePushSender,
  NOTIFICATION_SEND_QUEUE,
  createNotificationWorker,
  type NotificationWorker,
} from '@tamgiao/module-notification';
import { resetDatabase, testDatabaseUrl } from '@tamgiao/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const NOW = new Date('2026-03-02T03:00:00.000Z');
const clock = new FakeClock(NOW);
const jobs: ScheduledJob[] = [];
const scheduler: Scheduler = {
  schedule: async (_tx, job) => {
    jobs.push(job);
  },
};

let database: Database;
let uow: DrizzleUnitOfWork;
let bus: EventBus;
let push: FakePushSender;
let notificationWorker: NotificationWorker;

beforeAll(() => {
  database = createDatabase(testDatabaseUrl(), { maxConnections: 5 });
  uow = new DrizzleUnitOfWork(database.pool);
});

beforeEach(async () => {
  await resetDatabase(database.pool);
  jobs.length = 0;
  clock.set(NOW);
  push = new FakePushSender();
  bus = new EventBus();
  createMatchingWorker({ clock, profiles: { getMatchingProfile: async () => null }, scheduler }).registerConsumers(
    bus,
  );
  createMessagingWorker({ clock }).registerConsumers(bus);
  notificationWorker = createNotificationWorker({ uow, clock, scheduler, push });
  notificationWorker.registerConsumers(bus);
});

afterAll(async () => {
  await database.close();
});

async function publish(event: DomainEvent): Promise<void> {
  for (const sub of bus.consumersOf(event.type)) {
    await deliverOnce(uow, sub, event);
  }
}

interface OutboxRow {
  id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  aggregate_version: number;
  payload: Record<string, unknown>;
  occurred_at: Date;
}

async function relayFromOutbox(eventType: string, aggregateId: string): Promise<DomainEvent[]> {
  const { rows } = await database.pool.query<OutboxRow>(
    `select id, event_type, aggregate_type, aggregate_id, aggregate_version, payload, occurred_at
       from platform.outbox
      where event_type = $1 and aggregate_id = $2
      order by created_at, id`,
    [eventType, aggregateId],
  );
  const events: DomainEvent[] = rows.map((r) => ({
    eventId: r.id,
    type: r.event_type,
    aggregateType: r.aggregate_type,
    aggregateId: r.aggregate_id,
    version: r.aggregate_version,
    occurredAt: r.occurred_at,
    payload: r.payload,
  }));
  for (const e of events) {
    await publish(e);
  }
  return events;
}

async function seedDating(a: string, b: string): Promise<string> {
  const matchId = newId();
  await database.pool.query(
    `insert into matching.matches
       (id, user_a, user_b, created_by, status, accepted_by, offered_at, expires_at, dating_started_at, updated_at, version)
     values ($1, $2, $3, $4, 'DATING', $5, $6, $7, $6, $6, 3)`,
    [matchId, a, b, newId(), [a, b], NOW, addDuration(NOW, { days: DATING_DAYS })],
  );
  await database.pool.query(
    `insert into matching.active_slots (user_id, match_id, claimed_at) values ($1, $3, $4), ($2, $3, $4)`,
    [a, b, matchId, NOW],
  );
  await database.pool.query(
    `insert into notification.devices (id, user_id, token, platform, created_at, last_seen_at)
     values ($1, $2, 'ExponentPushToken[a]', 'ios', $3, $3),
            ($4, $5, 'ExponentPushToken[b]', 'ios', $3, $3)`,
    [newId(), a, NOW, newId(), b],
  );
  return matchId;
}

function makeMatchStartedDating(matchId: string, a: string, b: string): DomainEvent {
  return {
    eventId: newId(),
    type: MATCH_STARTED_DATING,
    aggregateType: 'Match',
    aggregateId: matchId,
    version: 3,
    occurredAt: NOW,
    payload: {
      matchId,
      participantIds: [a, b],
      expiresAt: addDuration(NOW, { days: DATING_DAYS }).toISOString(),
    },
  };
}

describe('dating timeout & nhắc nhở tìm hiểu (BE-S7-04)', () => {
  it('AC1: tua 14 ngày → CLOSED_STOPPED lý do TIMEOUT, không cooldown, hội thoại đóng, nhắc còn chờ bị huỷ', async () => {
    const a = newId();
    const b = newId();
    const matchId = await seedDating(a, b);

    const datingEvent = makeMatchStartedDating(matchId, a, b);
    await publish(datingEvent);

    const { rows: openConversations } = await database.pool.query<{ status: string }>(
      'select status from messaging.conversations where match_id = $1',
      [matchId],
    );
    expect(openConversations).toHaveLength(1);
    expect(openConversations[0]?.status).toBe('OPEN');

    interface DeliveryRow {
      id: string;
      kind: string;
      user_id: string;
      status: string;
      send_after: Date;
    }
    const { rows: reminders } = await database.pool.query<DeliveryRow>(
      `select id, kind, user_id, status, send_after
         from notification.deliveries
        where kind in ('DATING_REMINDER_FIRST', 'DATING_REMINDER_FINAL')
        order by send_after, user_id`,
    );
    expect(reminders).toHaveLength(4);
    expect(reminders.every((r) => r.status === 'PENDING')).toBe(true);

    const firstReminders = reminders.filter((r) => r.kind === 'DATING_REMINDER_FIRST');
    expect(firstReminders).toHaveLength(2);
    expect(firstReminders.map((r) => r.send_after)).toEqual([
      addDuration(NOW, { days: DATING_FIRST_REMINDER_DAY }),
      addDuration(NOW, { days: DATING_FIRST_REMINDER_DAY }),
    ]);

    const finalReminders = reminders.filter((r) => r.kind === 'DATING_REMINDER_FINAL');
    expect(finalReminders).toHaveLength(2);
    expect(finalReminders.map((r) => r.send_after)).toEqual([
      addDuration(NOW, { days: DATING_FINAL_REMINDER_DAY }),
      addDuration(NOW, { days: DATING_FINAL_REMINDER_DAY }),
    ]);

    clock.set(addDuration(NOW, { days: DATING_FIRST_REMINDER_DAY }));
    for (const row of firstReminders) {
      const result = await notificationWorker.sendNotification.execute(row.id);
      expect(result).toMatchObject({ kind: 'SENT', channel: 'PUSH' });
    }

    const { rows: sentReminders } = await database.pool.query<{ status: string }>(
      `select status from notification.deliveries where kind = 'DATING_REMINDER_FIRST'`,
    );
    expect(sentReminders.every((r) => r.status === 'SENT')).toBe(true);

    expect(push.sent).toHaveLength(2);
    for (const msg of push.sent) {
      expect(msg.body).toContain('Mục tiêu: gặp mặt trước ngày 14');
    }

    for (const row of firstReminders) {
      const result = await notificationWorker.sendNotification.execute(row.id);
      expect(result).toEqual({ kind: 'ALREADY_DONE', status: 'SENT' });
    }
    expect(push.sent).toHaveLength(2);

    clock.set(addDuration(NOW, { days: DATING_DAYS }));
    const expirer = createExpireMatchJob({ uow, clock, scheduler });
    expect(await expirer.execute({ matchId })).toEqual({ kind: 'CLOSED_STOPPED', fromStatus: 'DATING' });

    interface MatchRow {
      status: string;
      close_reason: string | null;
      close_outcome: string | null;
    }
    const { rows: matchRows } = await database.pool.query<MatchRow>(
      `select status, close_reason, close_outcome from matching.matches where id = $1`,
      [matchId],
    );
    expect(matchRows).toEqual([
      { status: 'CLOSED_STOPPED', close_reason: 'TIMEOUT', close_outcome: 'STOPPED' },
    ]);

    const { rows: cooldownRows } = await database.pool.query<{ user_id: string }>(
      `select user_id from matching.cooldowns where user_id in ($1, $2)`,
      [a, b],
    );
    expect(cooldownRows).toEqual([]);

    const { rows: slotRows } = await database.pool.query<{ user_id: string }>(
      `select user_id from matching.active_slots where match_id = $1`,
      [matchId],
    );
    expect(slotRows).toEqual([]);

    const closedEvents = await relayFromOutbox('MatchClosed', matchId);
    expect(closedEvents).toHaveLength(1);
    expect((closedEvents[0]?.payload as { trigger?: string })?.trigger).toBe('DATING_PERIOD_ENDED');

    interface ConversationRow {
      status: string;
      close_reason: string | null;
    }
    const { rows: convRows } = await database.pool.query<ConversationRow>(
      `select status, close_reason from messaging.conversations where match_id = $1`,
      [matchId],
    );
    expect(convRows).toEqual([{ status: 'CLOSED', close_reason: 'MATCH_CLOSED' }]);

    const { rows: finalDeliveryRows } = await database.pool.query<{ kind: string; status: string }>(
      `select kind, status
         from notification.deliveries
        where kind in ('DATING_REMINDER_FIRST', 'DATING_REMINDER_FINAL')
        order by kind, user_id`,
    );
    expect(finalDeliveryRows).toEqual([
      { kind: 'DATING_REMINDER_FINAL', status: 'CANCELLED' },
      { kind: 'DATING_REMINDER_FINAL', status: 'CANCELLED' },
      { kind: 'DATING_REMINDER_FIRST', status: 'SENT' },
      { kind: 'DATING_REMINDER_FIRST', status: 'SENT' },
    ]);

    expect(await expirer.execute({ matchId })).toEqual({
      kind: 'ALREADY_CLOSED',
      status: 'CLOSED_STOPPED',
    });
    const { rows: outboxRows } = await database.pool.query<{ id: string }>(
      `select id from platform.outbox where event_type = 'MatchClosed' and aggregate_id = $1`,
      [matchId],
    );
    expect(outboxRows).toHaveLength(1);
  });

  it('AC2: MatchStartedDating giao lại → mỗi mốc nhắc chỉ 1 thông báo / người, 1 job', async () => {
    const a = newId();
    const b = newId();
    const matchId = await seedDating(a, b);

    const datingEvent = makeMatchStartedDating(matchId, a, b);
    await publish(datingEvent);

    interface DeliveryIdRow {
      id: string;
    }
    const { rows: firstPass } = await database.pool.query<DeliveryIdRow>(
      `select id from notification.deliveries where kind in ('DATING_REMINDER_FIRST', 'DATING_REMINDER_FINAL')`,
    );
    expect(firstPass).toHaveLength(4);
    const reminderDeliveryIds = new Set(firstPass.map((r) => r.id));

    const reminderJobs = jobs.filter(
      (j) =>
        j.queue === NOTIFICATION_SEND_QUEUE &&
        typeof j.payload === 'object' &&
        j.payload !== null &&
        reminderDeliveryIds.has((j.payload as { deliveryId?: string }).deliveryId ?? ''),
    );
    expect(reminderJobs).toHaveLength(4);

    await publish(datingEvent);

    const { rows: secondPass } = await database.pool.query<DeliveryIdRow>(
      `select id from notification.deliveries where kind in ('DATING_REMINDER_FIRST', 'DATING_REMINDER_FINAL')`,
    );
    expect(secondPass).toHaveLength(4);

    const reminderJobsAfter = jobs.filter(
      (j) =>
        j.queue === NOTIFICATION_SEND_QUEUE &&
        typeof j.payload === 'object' &&
        j.payload !== null &&
        reminderDeliveryIds.has((j.payload as { deliveryId?: string }).deliveryId ?? ''),
    );
    expect(reminderJobsAfter).toHaveLength(4);

    for (const job of reminderJobsAfter) {
      const deliveryId = (job.payload as { deliveryId: string }).deliveryId;
      expect(job.key).toBe(deliveryId);
    }
    const uniqueKeys = new Set(reminderJobsAfter.map((j) => j.key));
    expect(uniqueKeys.size).toBe(4);
  });

  it('đã gặp (DateCompleted) trước hạn → MET, không bị đóng khi tới ngày 14, nhắc còn chờ bị huỷ', async () => {
    const a = newId();
    const b = newId();
    const matchId = await seedDating(a, b);

    const datingEvent = makeMatchStartedDating(matchId, a, b);
    await publish(datingEvent);

    clock.set(addDuration(NOW, { days: 5 }));
    const datePlanId = newId();
    const dateCompletedEvent: DomainEvent = {
      eventId: newId(),
      type: DATE_COMPLETED_EVENT,
      aggregateType: 'DatePlan',
      aggregateId: newId(),
      version: 1,
      occurredAt: clock.now(),
      payload: { datePlanId, matchId, inviterId: a, inviteeId: b },
    };
    await publish(dateCompletedEvent);

    const { rows: matchRows } = await database.pool.query<{ status: string }>(
      'select status from matching.matches where id = $1',
      [matchId],
    );
    expect(matchRows).toEqual([{ status: 'MET' }]);

    const metEvents = await relayFromOutbox('MatchMet', matchId);
    expect(metEvents).toHaveLength(1);

    const { rows: reminderDeliveries } = await database.pool.query<{ status: string }>(
      `select status from notification.deliveries where kind in ('DATING_REMINDER_FIRST', 'DATING_REMINDER_FINAL')`,
    );
    expect(reminderDeliveries).toHaveLength(4);
    expect(reminderDeliveries.every((r) => r.status === 'CANCELLED')).toBe(true);

    const { rows: convRows } = await database.pool.query<{ status: string }>(
      'select status from messaging.conversations where match_id = $1',
      [matchId],
    );
    expect(convRows).toEqual([{ status: 'OPEN' }]);

    clock.set(addDuration(NOW, { days: DATING_DAYS }));
    const expirer = createExpireMatchJob({ uow, clock, scheduler });
    expect(await expirer.execute({ matchId })).toEqual({ kind: 'ALREADY_CLOSED', status: 'MET' });

    const { rows: finalMatchRows } = await database.pool.query<{ status: string }>(
      'select status from matching.matches where id = $1',
      [matchId],
    );
    expect(finalMatchRows).toEqual([{ status: 'MET' }]);
  });
});
