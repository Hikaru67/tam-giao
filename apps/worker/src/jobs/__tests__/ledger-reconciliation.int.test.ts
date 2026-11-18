import type { JobLogger } from '@tamgiao/db';
import { Money, ok } from '@tamgiao/kernel';
import { testDatabaseUrl } from '@tamgiao/testing';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LEDGER_RECONCILIATION_QUEUE, registerLedgerReconciliationJob } from '../ledger-reconciliation.js';

const silent: JobLogger = { info: () => undefined, warn: () => undefined, error: () => undefined };

describe('registerLedgerReconciliationJob (pg-boss)', () => {
  let boss: PgBoss;
  let runs = 0;
  const reconciler = {
    execute: async () => {
      runs++;
      return ok({
        kind: 'CREATED' as const,
        report: {
          id: '019a0000-0000-7000-8000-000000000001',
          reportDate: '2026-11-19',
          runAt: new Date('2026-11-18T19:30:00.000Z'),
          status: 'MATCHED' as const,
          totals: {
            ledgerChargeTotal: Money.ZERO,
            ledgerRefundTotal: Money.ZERO,
            heldPaymentTotal: Money.ZERO,
            heldPaymentCount: 0,
            voucherIssueEntries: 0,
            voucherRedeemEntries: 0,
            voucherVoidEntries: 0,
            vouchersByStatus: { RESERVED: 0, ACTIVE: 0, REDEEMED: 0, VOID: 0, EXPIRED: 0 },
          },
          mismatches: [],
        },
      });
    },
  };

  beforeAll(async () => {
    // `schedule: false`: không để cron pass tự gửi job trong lúc test; lịch vẫn được lưu.
    boss = new PgBoss({ connectionString: testDatabaseUrl(), schedule: false });
    boss.on('error', () => undefined);
    await boss.start();
  });

  afterAll(async () => {
    await boss.stop({ graceful: false, timeout: 2_000 });
  });

  it('lưu lịch cron cấu hình được và worker chạy use case khi có job', async () => {
    await registerLedgerReconciliationJob({
      boss,
      logger: silent,
      reconciler,
      cron: '30 2 * * *',
      tz: 'Asia/Ho_Chi_Minh',
    });

    const schedule = await boss.getSchedule(LEDGER_RECONCILIATION_QUEUE);
    expect(schedule).toMatchObject({ name: LEDGER_RECONCILIATION_QUEUE, cron: '30 2 * * *' });
    expect(schedule?.timezone).toBe('Asia/Ho_Chi_Minh');

    await boss.send(LEDGER_RECONCILIATION_QUEUE, {});
    const deadline = Date.now() + 15_000;
    while (runs === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
    expect(runs).toBe(1);
  });
});
