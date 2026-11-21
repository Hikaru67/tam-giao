import { REFUND_SLA_HOURS } from '@tamgiao/contracts';
import { ensureQueue, jobIdFor, type JobLogger, type RetryPolicy } from '@tamgiao/db';
import {
  PaymentGatewayError,
  type BillingWorker,
  type OverdueRefund,
  type PendingRefund,
  type RefundVerificationPaymentOutcome,
} from '@tamgiao/module-billing';
import type { DomainError, Result } from '@tamgiao/kernel';
import type { PgBoss } from 'pg-boss';

/** Hàng đợi gọi cổng hoàn tiền cho **một** khoản `REFUND_PENDING` (BE-S4-04). Id job = f(paymentId). */
export const BILLING_REFUND_PAYMENT_QUEUE = 'billing.refund-payment';
/** Job định kỳ: quét `REFUND_PENDING` → đẩy mỗi khoản thành một job `billing.refund-payment`. */
export const BILLING_REFUND_DISPATCH_QUEUE = 'billing.refund-dispatch';
/** Job định kỳ: cảnh báo khoản `REFUND_PENDING` quá `REFUND_SLA_HOURS`. */
export const BILLING_REFUND_SLA_QUEUE = 'billing.refund-sla-check';

/**
 * Retry khi cổng lỗi tạm thời (`PaymentGatewayError.retryable`): pg-boss backoff luỹ thừa có jitter —
 * lần thứ n chờ ≈ 30s × 2ⁿ × (1..2), 10 lần ≈ 8,5–17 giờ tổng, vẫn nằm trong `REFUND_SLA_HOURS` (48h).
 * Hết lượt → dead-letter (log error), khoản giữ `REFUND_PENDING` và job cảnh báo SLA tiếp tục báo.
 */
export const REFUND_PAYMENT_RETRY: RetryPolicy = { retryLimit: 10, retryDelay: 30, retryBackoff: true };
/** Job quét/cảnh báo chạy lại theo lịch — không cần retry riêng. */
const SWEEP_RETRY: RetryPolicy = { retryLimit: 0, retryDelay: 0, retryBackoff: false };

export const DEFAULT_REFUND_DISPATCH_CRON = '* * * * *';
export const DEFAULT_REFUND_SLA_CRON = '*/15 * * * *';

export interface RefundPaymentRunner {
  execute(cmd: {
    readonly paymentId: string;
  }): Promise<Result<RefundVerificationPaymentOutcome, DomainError>>;
}

/**
 * Chạy một job hoàn tiền. Lỗi tạm thời của cổng → log warn + throw để pg-boss retry backoff. Cổng từ chối vĩnh
 * viễn → log **error** (chỉ paymentId + phân loại lỗi, không PII), job kết thúc, khoản giữ `REFUND_PENDING` cho
 * vận hành (không retry vô ích). `Err` nghiệp vụ (trạng thái bất thường) → throw.
 */
export async function runRefundPayment(
  refund: RefundPaymentRunner,
  paymentId: string,
  logger: JobLogger,
): Promise<RefundVerificationPaymentOutcome> {
  let result: Result<RefundVerificationPaymentOutcome, DomainError>;
  try {
    result = await refund.execute({ paymentId });
  } catch (error) {
    if (error instanceof PaymentGatewayError && error.retryable) {
      logger.warn(
        { job: BILLING_REFUND_PAYMENT_QUEUE, paymentId, gatewayErrorKind: error.kind },
        'refund gateway call failed, will retry',
      );
    }
    throw error;
  }
  if (result.isErr()) {
    logger.error({ job: BILLING_REFUND_PAYMENT_QUEUE, paymentId, code: result.error.code }, 'refund failed');
    throw new Error(`refund ${paymentId}: ${result.error.code}`);
  }
  const outcome = result.value;
  switch (outcome.kind) {
    case 'REFUNDED':
      logger.info({ job: BILLING_REFUND_PAYMENT_QUEUE, paymentId }, 'payment refunded');
      break;
    case 'SKIPPED':
      logger.info({ job: BILLING_REFUND_PAYMENT_QUEUE, paymentId, status: outcome.status }, 'refund skipped');
      break;
    case 'GATEWAY_REJECTED':
      logger.error(
        { job: BILLING_REFUND_PAYMENT_QUEUE, paymentId, gatewayErrorKind: outcome.gatewayErrorKind },
        'refund rejected by gateway, payment left REFUND_PENDING for operations',
      );
      break;
  }
  return outcome;
}

/** Đẩy mỗi khoản `REFUND_PENDING` thành job hoàn tiền; `enqueue` chống trùng theo paymentId. Trả số khoản đã đẩy. */
export async function dispatchPendingRefunds(
  list: { execute(): Promise<PendingRefund[]> },
  enqueue: (paymentId: string) => Promise<void>,
): Promise<number> {
  const pending = await list.execute();
  for (const p of pending) await enqueue(p.paymentId);
  return pending.length;
}

/**
 * Cảnh báo SLA (AC3): mỗi khoản `REFUND_PENDING` quá `REFUND_SLA_HOURS` → một dòng log mức **error**
 * (`alert: 'refund_sla_breached'`, chỉ paymentId + mốc thời gian — không PII) để gắn alert. Trả số khoản quá hạn.
 */
export async function checkRefundSla(
  find: { execute(): Promise<OverdueRefund[]> },
  logger: JobLogger,
): Promise<number> {
  const overdue = await find.execute();
  for (const o of overdue) {
    logger.error(
      {
        job: BILLING_REFUND_SLA_QUEUE,
        alert: 'refund_sla_breached',
        paymentId: o.paymentId,
        refundRequestedAt: o.refundRequestedAt.toISOString(),
        hoursPending: o.hoursPending,
        slaHours: REFUND_SLA_HOURS,
      },
      'refund pending beyond SLA',
    );
  }
  return overdue.length;
}

/** Id job hoàn tiền xác định theo payment: điều phối chạy mỗi phút vẫn chỉ có một job cho mỗi khoản. */
export const refundPaymentJobId = (paymentId: string): string =>
  jobIdFor(`${BILLING_REFUND_PAYMENT_QUEUE}:${paymentId}`);

/**
 * Đăng ký 3 hàng đợi hoàn tiền: job hoàn tiền từng khoản (retry backoff), điều phối định kỳ và cảnh báo SLA định kỳ
 * (pg-boss `schedule`, idempotent theo tên hàng đợi).
 */
export async function registerBillingRefundJobs(options: {
  readonly boss: PgBoss;
  readonly logger: JobLogger;
  readonly billing: Pick<BillingWorker, 'refundPayment' | 'listPendingRefunds' | 'findOverdueRefunds'>;
  readonly dispatchCron?: string;
  readonly slaCron?: string;
  readonly refundRetry?: RetryPolicy;
  readonly pollingIntervalSeconds?: number;
}): Promise<void> {
  const { boss, logger, billing } = options;
  const polling = options.pollingIntervalSeconds ?? 2;

  await ensureQueue(
    boss,
    BILLING_REFUND_PAYMENT_QUEUE,
    options.refundRetry ?? REFUND_PAYMENT_RETRY,
    logger,
    polling,
  );
  await boss.work<{ paymentId?: unknown }>(
    BILLING_REFUND_PAYMENT_QUEUE,
    { batchSize: 1, pollingIntervalSeconds: polling },
    async (jobs) => {
      for (const job of jobs) {
        const paymentId = job.data.paymentId;
        if (typeof paymentId !== 'string') {
          logger.error({ job: BILLING_REFUND_PAYMENT_QUEUE, jobId: job.id }, 'refund job without paymentId');
          continue;
        }
        await runRefundPayment(billing.refundPayment, paymentId, logger);
      }
    },
  );

  await ensureQueue(boss, BILLING_REFUND_DISPATCH_QUEUE, SWEEP_RETRY, logger, polling);
  await boss.schedule(BILLING_REFUND_DISPATCH_QUEUE, options.dispatchCron ?? DEFAULT_REFUND_DISPATCH_CRON);
  await boss.work(
    BILLING_REFUND_DISPATCH_QUEUE,
    { batchSize: 1, pollingIntervalSeconds: polling },
    async () => {
      const count = await dispatchPendingRefunds(billing.listPendingRefunds, async (paymentId) => {
        await boss.send(BILLING_REFUND_PAYMENT_QUEUE, { paymentId }, { id: refundPaymentJobId(paymentId) });
      });
      if (count > 0) logger.info({ job: BILLING_REFUND_DISPATCH_QUEUE, count }, 'refund jobs dispatched');
    },
  );

  await ensureQueue(boss, BILLING_REFUND_SLA_QUEUE, SWEEP_RETRY, logger, polling);
  await boss.schedule(BILLING_REFUND_SLA_QUEUE, options.slaCron ?? DEFAULT_REFUND_SLA_CRON);
  await boss.work(BILLING_REFUND_SLA_QUEUE, { batchSize: 1, pollingIntervalSeconds: polling }, async () => {
    await checkRefundSla(billing.findOverdueRefunds, logger);
  });
}
