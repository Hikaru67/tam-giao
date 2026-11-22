import { KYC_APPROVED } from '@tamgiao/contracts';
import {
  DrizzleUnitOfWork,
  EventBus,
  PgBossScheduler,
  createDatabase,
  deliverOnce,
  type Database,
  type JobLogger,
} from '@tamgiao/db';
import { SystemClock, newId } from '@tamgiao/kernel';
import {
  FakePushSender,
  NOTIFICATION_SEND_QUEUE,
  createNotificationWorker,
} from '@tamgiao/module-notification';
import { resetDatabase, testDatabaseUrl } from '@tamgiao/testing';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerNotificationSendJob } from '../notification-send.js';

const silent: JobLogger = { info: () => undefined, warn: () => undefined, error: () => undefined };

describe('notification: consumer → job pg-boss notification.send → FakePushSender', () => {
  let database: Database;
  let boss: PgBoss;

  beforeAll(async () => {
    database = createDatabase(testDatabaseUrl(), { maxConnections: 4 });
    await resetDatabase(database.pool);
    boss = new PgBoss({ connectionString: testDatabaseUrl(), schedule: false });
    boss.on('error', () => undefined);
    await boss.start();
    await database.pool.query('delete from pgboss.job where name = $1', [NOTIFICATION_SEND_QUEUE]);
  });

  afterAll(async () => {
    await boss.stop({ graceful: false, timeout: 2_000 });
    await database.close();
  });

  it('KycApproved → job hẹn cùng transaction consumer → push tới thiết bị đúng 1 lần', async () => {
    const uow = new DrizzleUnitOfWork(database.pool);
    const push = new FakePushSender();
    const worker = createNotificationWorker({
      uow,
      clock: new SystemClock(),
      scheduler: new PgBossScheduler(boss),
      push,
    });
    const bus = new EventBus();
    worker.registerConsumers(bus);
    await registerNotificationSendJob({
      boss,
      logger: silent,
      sender: worker.sendNotification,
      pollingIntervalSeconds: 0.5,
    });
    expect(await boss.getQueue(`${NOTIFICATION_SEND_QUEUE}.dead`)).not.toBeNull();

    const userId = newId();
    await database.pool.query(
      `insert into notification.devices (id, user_id, token, platform, created_at, last_seen_at)
       values ($1, $2, 'ExponentPushToken[int]', 'android', now(), now())`,
      [newId(), userId],
    );
    const [sub] = bus.consumersOf(KYC_APPROVED);
    if (!sub) throw new Error('missing consumer');
    const event = {
      eventId: newId(),
      type: KYC_APPROVED,
      aggregateType: 'KycSubmission',
      aggregateId: newId(),
      version: 2,
      occurredAt: new Date(),
      payload: { submissionId: newId(), userId },
    };
    await deliverOnce(uow, sub, event);
    await deliverOnce(uow, sub, event);

    const deadline = Date.now() + 15_000;
    while (push.sent.length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
    // Đợi thêm một nhịp poll để chắc không có push trùng.
    await new Promise((r) => setTimeout(r, 1_200));
    expect(push.sent.map((m) => [m.token, m.data.kind])).toEqual([
      ['ExponentPushToken[int]', 'KYC_APPROVED'],
    ]);
    const { rows } = await database.pool.query('select status, channel from notification.deliveries');
    expect(rows).toEqual([{ status: 'SENT', channel: 'PUSH' }]);
  });
});
