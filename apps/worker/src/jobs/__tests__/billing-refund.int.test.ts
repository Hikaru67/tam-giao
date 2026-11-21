import { KYC_REJECTED } from '@tamgiao/contracts';
import { DEPOSIT_VND, VOUCHER_VND } from '@tamgiao/contracts/constants';
import {
  createDatabase,
  deliverOnce,
  DrizzleUnitOfWork,
  EventBus,
  type Database,
  type JobLogger,
} from '@tamgiao/db';
import { FakeClock, newId } from '@tamgiao/kernel';
import { createBillingWorker, FakePaymentGateway } from '@tamgiao/module-billing';
import { resetDatabase, testDatabaseUrl } from '@tamgiao/testing';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BILLING_REFUND_DISPATCH_QUEUE,
  BILLING_REFUND_SLA_QUEUE,
  registerBillingRefundJobs,
} from '../billing-refund.js';

const T0 = new Date('2026-11-18T01:00:00.000Z');
const errors: Record<string, unknown>[] = [];
const logger: JobLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: (obj) => void errors.push(obj as Record<string, unknown>),
};

async function waitFor(check: () => Promise<boolean>, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 200));
  }
}

describe('registerBillingRefundJobs (pg-boss + Postgres)', () => {
  let database: Database;
  let boss: PgBoss;
  const clock = new FakeClock(T0);
  const gateway = new FakePaymentGateway({ secret: 'worker-int-secret', clock, acceptUnknownRefunds: true });

  beforeAll(async () => {
    database = createDatabase(testDatabaseUrl(), { maxConnections: 5 });
    await resetDatabase(database.pool);
    // `schedule: false`: cron không tự gửi job trong lúc test; test gửi job điều phối thủ công.
    boss = new PgBoss({ connectionString: testDatabaseUrl(), schedule: false });
    boss.on('error', () => undefined);
    await boss.start();
  });

  afterAll(async () => {
    await boss.stop({ graceful: false, timeout: 2_000 });
    await database.close();
  });

  it('KycRejected → điều phối → job hoàn tiền retry khi cổng lỗi tạm thời → REFUNDED, gọi cổng thành công đúng 1 lần', async () => {
    const uow = new DrizzleUnitOfWork(database.pool);
    const billing = createBillingWorker({ uow, clock, paymentGateway: gateway });
    const bus = new EventBus();
    billing.registerConsumers(bus);

    // Seed: khoản SUCCEEDED + voucher RESERVED (như sau webhook thành công).
    const userId = newId();
    const paymentId = newId();
    await database.pool.query(
      `insert into billing.payments (id, order_id, user_id, amount, status, gateway_txn_id, idempotency_key,
                                     created_at, succeeded_at, updated_at, version)
       values ($1, $2, $3, $4, 'SUCCEEDED', $5, 'k1', $6, $6, $6, 1)`,
      [paymentId, `VP${paymentId.replaceAll('-', '')}`, userId, DEPOSIT_VND, `txn_${paymentId}`, T0],
    );
    await database.pool.query(
      `insert into billing.vouchers (id, user_id, payment_id, value, status, issued_at, updated_at, version)
       values ($1, $2, $3, $4, 'RESERVED', $5, $5, 1)`,
      [newId(), userId, paymentId, VOUCHER_VND, T0],
    );

    const [sub] = bus.consumersOf(KYC_REJECTED);
    if (sub === undefined) throw new Error('consumer missing');
    await deliverOnce(uow, sub, {
      eventId: newId(),
      type: KYC_REJECTED,
      aggregateType: 'KycSubmission',
      aggregateId: newId(),
      version: 2,
      occurredAt: T0,
      payload: { submissionId: newId(), userId, reasonCode: 'OTHER' },
    });

    gateway.failNextRefunds(2, 'TIMEOUT');
    await registerBillingRefundJobs({
      boss,
      logger,
      billing,
      refundRetry: { retryLimit: 4, retryDelay: 1, retryBackoff: false },
      pollingIntervalSeconds: 0.5,
    });
    expect(await boss.getSchedule(BILLING_REFUND_DISPATCH_QUEUE)).toMatchObject({ cron: '* * * * *' });
    expect(await boss.getSchedule(BILLING_REFUND_SLA_QUEUE)).toMatchObject({ cron: '*/15 * * * *' });

    // Điều phối 2 lần (như cron mỗi phút) → id job xác định nên chỉ một job hoàn tiền.
    await boss.send(BILLING_REFUND_DISPATCH_QUEUE, {});
    await boss.send(BILLING_REFUND_DISPATCH_QUEUE, {});

    const status = async () =>
      (
        await database.pool.query<{ status: string }>('select status from billing.payments where id = $1', [
          paymentId,
        ])
      ).rows[0]?.status;
    await waitFor(async () => (await status()) === 'REFUNDED');

    const calls = gateway.refundCalls.filter((c) => c.gatewayTxnId === `txn_${paymentId}`);
    expect(calls.map((c) => c.succeeded)).toEqual([false, false, true]);
    const { rows } = await database.pool.query<{ n: number }>(
      `select count(*)::int as n from billing.ledger_entries where payment_id = $1 and type = 'REFUND'`,
      [paymentId],
    );
    expect(rows[0]?.n).toBe(1);
    expect(errors).toEqual([]);
  });
});
