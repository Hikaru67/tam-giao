import { registerJob, type JobLogger, type RetryPolicy } from '@tamgiao/db';
import type { Tx, UnitOfWork } from '@tamgiao/kernel';
import {
  MATCH_EXPIRY_QUEUE,
  type ExpireMatchOutcome,
  type MatchExpiryPayload,
} from '@tamgiao/module-matching';
import type { PgBoss } from 'pg-boss';

export interface MatchExpirer {
  executeIn(tx: Tx, payload: MatchExpiryPayload): Promise<ExpireMatchOutcome>;
}

/** Payload job do `matchExpiryJob` tạo: `{matchId}`. Sai dạng → lỗi lập trình (throw → retry → dead-letter). */
export function parseMatchExpiryPayload(payload: Readonly<Record<string, unknown>>): MatchExpiryPayload {
  const { matchId } = payload;
  if (typeof matchId !== 'string') throw new Error(`${MATCH_EXPIRY_QUEUE}: payload thiếu matchId`);
  return { matchId };
}

/** Một job: gọi `ExpireMatch` trong `tx` của `registerJob`, log kết quả (chỉ matchId + trạng thái, không PII). */
export async function runMatchExpiry(
  expirer: MatchExpirer,
  tx: Tx,
  payload: Readonly<Record<string, unknown>>,
  logger: JobLogger,
): Promise<ExpireMatchOutcome> {
  const parsed = parseMatchExpiryPayload(payload);
  const outcome = await expirer.executeIn(tx, parsed);
  if (outcome.kind === 'NOT_FOUND') {
    logger.warn({ job: MATCH_EXPIRY_QUEUE, matchId: parsed.matchId }, 'match not found, job skipped');
  } else {
    logger.info({ job: MATCH_EXPIRY_QUEUE, matchId: parsed.matchId, ...outcome }, 'match expiry handled');
  }
  return outcome;
}

/**
 * Đăng ký worker cho hàng đợi `matching.expire-match` (BE-S5-05). Job được API hẹn cùng transaction với thay đổi
 * match (`PgBossScheduler`, `runAt = expiresAt`); handler idempotent nên retry an toàn (`DEFAULT_RETRY_POLICY`).
 */
export async function registerMatchExpiryJob(options: {
  readonly boss: PgBoss;
  readonly uow: UnitOfWork;
  readonly logger: JobLogger;
  readonly expirer: MatchExpirer;
  readonly retry?: RetryPolicy;
  readonly pollingIntervalSeconds?: number;
}): Promise<void> {
  const { boss, uow, logger, expirer } = options;
  await registerJob({
    boss,
    uow,
    logger,
    queue: MATCH_EXPIRY_QUEUE,
    handler: async (payload, tx) => {
      await runMatchExpiry(expirer, tx, payload, logger);
    },
    ...(options.retry === undefined ? {} : { retry: options.retry }),
    ...(options.pollingIntervalSeconds === undefined
      ? {}
      : { pollingIntervalSeconds: options.pollingIntervalSeconds }),
  });
}
