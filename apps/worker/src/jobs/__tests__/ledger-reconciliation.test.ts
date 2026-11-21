import { ConfigError } from '@tamgiao/config';
import type { JobLogger } from '@tamgiao/db';
import { Money, ok } from '@tamgiao/kernel';
import type { ReconcileLedgerOutcome, ReconciliationReportView } from '@tamgiao/module-billing';
import { describe, expect, it } from 'vitest';
import { parseWorkerConfig } from '../../config.js';
import { runLedgerReconciliation } from '../ledger-reconciliation.js';

const KEY = Buffer.alloc(32, 1).toString('base64');
const ENV = {
  DATABASE_URL: 'postgres://tamgiao@localhost:5433/tamgiao',
  NODE_ENV: 'test',
  S3_ENDPOINT: 'http://localhost:8333',
  S3_ACCESS_KEY_ID: 'tamgiao',
  S3_SECRET_ACCESS_KEY: 'secret',
  DATA_MASTER_KEYS: `1:${KEY}`,
  BLIND_INDEX_KEY: KEY,
  AUTH_SECRET: KEY,
  PAYMENT_WEBHOOK_SECRET: 'worker-test-payment-secret',
};

class RecordingLogger implements JobLogger {
  lines: { level: string; obj: Record<string, unknown>; msg: string }[] = [];
  info(obj: Record<string, unknown>, msg: string): void {
    this.lines.push({ level: 'info', obj, msg });
  }
  warn(obj: Record<string, unknown>, msg: string): void {
    this.lines.push({ level: 'warn', obj, msg });
  }
  error(obj: Record<string, unknown>, msg: string): void {
    this.lines.push({ level: 'error', obj, msg });
  }
}

const report = (over: Partial<ReconciliationReportView> = {}): ReconciliationReportView => ({
  id: '019a0000-0000-7000-8000-000000000001',
  reportDate: '2026-11-19',
  runAt: new Date('2026-11-18T19:30:00.000Z'),
  status: 'MATCHED',
  totals: {
    ledgerChargeTotal: Money.ofTrusted(598_000),
    ledgerRefundTotal: Money.ZERO,
    heldPaymentTotal: Money.ofTrusted(598_000),
    heldPaymentCount: 2,
    voucherIssueEntries: 2,
    voucherRedeemEntries: 0,
    voucherVoidEntries: 0,
    vouchersByStatus: { RESERVED: 1, ACTIVE: 1, REDEEMED: 0, VOID: 0, EXPIRED: 0 },
  },
  mismatches: [],
  ...over,
});

const reconciler = (outcome: ReconcileLedgerOutcome) => ({ execute: async () => ok(outcome) });

describe('runLedgerReconciliation', () => {
  it('khớp → log info số liệu tổng', async () => {
    const logger = new RecordingLogger();
    await runLedgerReconciliation(reconciler({ kind: 'CREATED', report: report() }), logger);
    expect(logger.lines).toHaveLength(1);
    expect(logger.lines[0]).toMatchObject({
      level: 'info',
      msg: 'ledger reconciliation matched',
      obj: { job: 'billing.ledger-reconciliation', status: 'MATCHED', ledgerChargeTotal: '598000' },
    });
  });

  it('lệch → log error kèm alert + chi tiết (bigint dạng chuỗi), không PII', async () => {
    const logger = new RecordingLogger();
    const mismatched = report({
      status: 'MISMATCH',
      mismatches: [{ check: 'MONEY_BALANCE', ledger: 897_000n, state: 598_000n, difference: 299_000n }],
    });
    await runLedgerReconciliation(reconciler({ kind: 'CREATED', report: mismatched }), logger);
    expect(logger.lines).toHaveLength(1);
    const [line] = logger.lines;
    expect(line).toMatchObject({
      level: 'error',
      msg: 'ledger reconciliation mismatch',
      obj: {
        alert: 'ledger_reconciliation_mismatch',
        reportDate: '2026-11-19',
        mismatches: [{ check: 'MONEY_BALANCE', ledger: '897000', state: '598000', difference: '299000' }],
      },
    });
    // Log được tuần tự hoá JSON (không còn bigint).
    expect(() => JSON.stringify(line?.obj)).not.toThrow();
  });

  it('ngày đã có báo cáo → info bỏ qua, không log error lại', async () => {
    const logger = new RecordingLogger();
    const existing = report({ status: 'MISMATCH' });
    await runLedgerReconciliation(reconciler({ kind: 'ALREADY_REPORTED', report: existing }), logger);
    expect(logger.lines.map((l) => l.level)).toEqual(['info']);
  });

  it('lỗi hạ tầng → throw để pg-boss thử lại', async () => {
    const failing = {
      execute: async () => {
        throw new Error('db down');
      },
    };
    await expect(runLedgerReconciliation(failing, new RecordingLogger())).rejects.toThrow('db down');
  });
});

describe('worker config — job đối soát ledger', () => {
  it('mặc định 02:30 hằng ngày giờ Việt Nam; cấu hình được', () => {
    expect(parseWorkerConfig(ENV).jobs.ledgerReconciliation).toEqual({
      cron: '30 2 * * *',
      tz: 'Asia/Ho_Chi_Minh',
    });
    expect(
      parseWorkerConfig({ ...ENV, LEDGER_RECONCILIATION_CRON: '0 1 * * *', LEDGER_RECONCILIATION_TZ: 'UTC' })
        .jobs.ledgerReconciliation,
    ).toEqual({ cron: '0 1 * * *', tz: 'UTC' });
  });

  it('cron sai số trường → ConfigError', () => {
    expect(() => parseWorkerConfig({ ...ENV, LEDGER_RECONCILIATION_CRON: '0 1' })).toThrow(ConfigError);
  });
});
