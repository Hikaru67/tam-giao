import { registerJob, type JobLogger, type RetryPolicy } from '@tamgiao/db';
import type { Tx, UnitOfWork } from '@tamgiao/kernel';
import {
  DATE_PLAN_EXPIRY_QUEUE,
  type DatePlanExpiryPayload,
  type ExpireDatePlanOutcome,
} from '@tamgiao/module-dating';
import type { PgBoss } from 'pg-boss';

export interface DatePlanExpirer {
  executeIn(tx: Tx, payload: DatePlanExpiryPayload): Promise<ExpireDatePlanOutcome>;
}

/** Payload job do `datePlanExpiryJob` tạo: `{datePlanId}`. Sai dạng → lỗi lập trình (throw → retry → dead-letter). */
export function parseDatePlanExpiryPayload(
  payload: Readonly<Record<string, unknown>>,
): DatePlanExpiryPayload {
  const { datePlanId } = payload;
  if (typeof datePlanId !== 'string') throw new Error(`${DATE_PLAN_EXPIRY_QUEUE}: payload thiếu datePlanId`);
  return { datePlanId };
}

/** Một job: gọi `ExpireDatePlan` trong `tx` của `registerJob`, log kết quả (chỉ id + trạng thái, không PII). */
export async function runDatePlanExpiry(
  expirer: DatePlanExpirer,
  tx: Tx,
  payload: Readonly<Record<string, unknown>>,
  logger: JobLogger,
): Promise<ExpireDatePlanOutcome> {
  const parsed = parseDatePlanExpiryPayload(payload);
  const outcome = await expirer.executeIn(tx, parsed);
  if (outcome.kind === 'NOT_FOUND') {
    logger.warn(
      { job: DATE_PLAN_EXPIRY_QUEUE, datePlanId: parsed.datePlanId },
      'date plan not found, job skipped',
    );
  } else {
    logger.info(
      { job: DATE_PLAN_EXPIRY_QUEUE, datePlanId: parsed.datePlanId, ...outcome },
      'date plan expiry handled',
    );
  }
  return outcome;
}

/**
 * Đăng ký worker cho hàng đợi `dating.expire-date-plan` (BE-S7-01). Job được API hẹn cùng transaction với lịch vừa đề
 * xuất (`runAt = expiresAt`); handler idempotent nên retry an toàn (`DEFAULT_RETRY_POLICY`).
 */
export async function registerDatePlanExpiryJob(options: {
  readonly boss: PgBoss;
  readonly uow: UnitOfWork;
  readonly logger: JobLogger;
  readonly expirer: DatePlanExpirer;
  readonly retry?: RetryPolicy;
  readonly pollingIntervalSeconds?: number;
}): Promise<void> {
  const { boss, uow, logger, expirer } = options;
  await registerJob({
    boss,
    uow,
    logger,
    queue: DATE_PLAN_EXPIRY_QUEUE,
    handler: async (payload, tx) => {
      await runDatePlanExpiry(expirer, tx, payload, logger);
    },
    ...(options.retry === undefined ? {} : { retry: options.retry }),
    ...(options.pollingIntervalSeconds === undefined
      ? {}
      : { pollingIntervalSeconds: options.pollingIntervalSeconds }),
  });
}
