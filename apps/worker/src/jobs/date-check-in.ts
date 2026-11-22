import { registerJob, type JobLogger, type RetryPolicy } from '@tamgiao/db';
import type { Tx, UnitOfWork } from '@tamgiao/kernel';
import {
  CHECK_IN_LOCATION_PURGE_QUEUE,
  CHECK_IN_OVERDUE_QUEUE,
  type CheckInOverduePayload,
  type MarkCheckInOverdueOutcome,
  type PurgeCheckInLocationsOutcome,
} from '@tamgiao/module-dating';
import type { PgBoss } from 'pg-boss';

export interface CheckInOverdueMarker {
  executeIn(tx: Tx, payload: CheckInOverduePayload): Promise<MarkCheckInOverdueOutcome>;
}

/** Payload job do `checkInOverdueJob` tạo: `{checkInId}`. Sai dạng → lỗi lập trình (throw → retry → dead-letter). */
export function parseCheckInOverduePayload(payload: Readonly<Record<string, unknown>>): CheckInOverduePayload {
  const { checkInId } = payload;
  if (typeof checkInId !== 'string') throw new Error(`${CHECK_IN_OVERDUE_QUEUE}: payload thiếu checkInId`);
  return { checkInId };
}

/** Một job: gọi `MarkCheckInOverdue` trong `tx` của `registerJob`, log kết quả (chỉ id + outcome, không PII). */
export async function runCheckInOverdue(
  marker: CheckInOverdueMarker,
  tx: Tx,
  payload: Readonly<Record<string, unknown>>,
  logger: JobLogger,
): Promise<MarkCheckInOverdueOutcome> {
  const parsed = parseCheckInOverduePayload(payload);
  const outcome = await marker.executeIn(tx, parsed);
  if (outcome.kind === 'NOT_FOUND') {
    logger.warn({ job: CHECK_IN_OVERDUE_QUEUE, checkInId: parsed.checkInId }, 'check-in not found, job skipped');
  } else {
    logger.info({ job: CHECK_IN_OVERDUE_QUEUE, checkInId: parsed.checkInId, ...outcome }, 'check-in overdue handled');
  }
  return outcome;
}

/**
 * Đăng ký worker cho hàng đợi `dating.check-in-overdue` (BE-S7-02, AC2). Job được hẹn lúc `overdueAt` của check-in;
 * handler idempotent nên retry an toàn (`DEFAULT_RETRY_POLICY`).
 */
export async function registerCheckInOverdueJob(options: {
  readonly boss: PgBoss;
  readonly uow: UnitOfWork;
  readonly logger: JobLogger;
  readonly marker: CheckInOverdueMarker;
  readonly retry?: RetryPolicy;
  readonly pollingIntervalSeconds?: number;
}): Promise<void> {
  const { boss, uow, logger, marker } = options;
  await registerJob({
    boss,
    uow,
    logger,
    queue: CHECK_IN_OVERDUE_QUEUE,
    handler: async (payload, tx) => {
      await runCheckInOverdue(marker, tx, payload, logger);
    },
    ...(options.retry === undefined ? {} : { retry: options.retry }),
    ...(options.pollingIntervalSeconds === undefined
      ? {}
      : { pollingIntervalSeconds: options.pollingIntervalSeconds }),
  });
}

export interface CheckInLocationPurger {
  executeIn(tx: Tx): Promise<PurgeCheckInLocationsOutcome>;
}

/** Một job: gọi `PurgeCheckInLocations` trong `tx` của `registerJob`, log số dòng đã xoá. */
export async function runCheckInLocationPurge(
  purger: CheckInLocationPurger,
  tx: Tx,
  logger: JobLogger,
): Promise<PurgeCheckInLocationsOutcome> {
  const outcome = await purger.executeIn(tx);
  logger.info({ job: CHECK_IN_LOCATION_PURGE_QUEUE, purged: outcome.purged }, 'check-in locations purged');
  return outcome;
}

/**
 * Đăng ký worker cho hàng đợi `dating.purge-check-in-locations` (BE-S7-02, AC1).
 * Handler quét xoá mọi vị trí hết hạn lưu (`purge_after <= now`).
 */
export async function registerCheckInLocationPurgeJob(options: {
  readonly boss: PgBoss;
  readonly uow: UnitOfWork;
  readonly logger: JobLogger;
  readonly purger: CheckInLocationPurger;
  readonly retry?: RetryPolicy;
  readonly pollingIntervalSeconds?: number;
}): Promise<void> {
  const { boss, uow, logger, purger } = options;
  await registerJob({
    boss,
    uow,
    logger,
    queue: CHECK_IN_LOCATION_PURGE_QUEUE,
    handler: async (_payload, tx) => {
      await runCheckInLocationPurge(purger, tx, logger);
    },
    ...(options.retry === undefined ? {} : { retry: options.retry }),
    ...(options.pollingIntervalSeconds === undefined
      ? {}
      : { pollingIntervalSeconds: options.pollingIntervalSeconds }),
  });
}
