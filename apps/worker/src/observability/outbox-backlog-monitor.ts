import type { Clock } from '@tamgiao/kernel';
import type { ErrorReporter } from './error-reporter.js';

/**
 * Cảnh báo outbox tồn đọng (BE-S7-08, AC2): định kỳ đếm event chưa relay; vượt ngưỡng (số lượng hoặc tuổi event
 * cũ nhất) → log error + gửi cảnh báo qua `ErrorReporter` (Sentry). Đang tồn đọng thì nhắc lại sau mỗi
 * `realertAfterMs`, hết tồn đọng thì log "recovered" một lần.
 */
export interface OutboxBacklog {
  readonly unpublished: number;
  readonly oldestAgeSeconds: number;
}

export interface Queryable {
  query<R extends object>(sql: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

/** Cùng câu truy vấn với metric `outbox_*` của API (`apps/api/src/observability/backlog.ts`). */
export async function readOutboxBacklog(db: Queryable): Promise<OutboxBacklog> {
  const { rows } = await db.query<{ unpublished: number; oldest_age_seconds: number | null }>(
    `select count(*)::int as unpublished,
            extract(epoch from (now() - min(created_at)))::float8 as oldest_age_seconds
       from platform.outbox
      where published_at is null`,
  );
  const row = rows[0];
  return { unpublished: row?.unpublished ?? 0, oldestAgeSeconds: Math.max(0, row?.oldest_age_seconds ?? 0) };
}

export interface OutboxBacklogThresholds {
  /** Cảnh báo khi số event chưa relay **lớn hơn** giá trị này. */
  readonly maxUnpublished: number;
  /** Cảnh báo khi event chưa relay cũ nhất **lớn hơn** số giây này. */
  readonly maxAgeSeconds: number;
}

export interface MonitorLogger {
  error(obj: object, msg: string): void;
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

export interface OutboxBacklogMonitorDeps {
  readonly read: () => Promise<OutboxBacklog>;
  readonly thresholds: OutboxBacklogThresholds;
  readonly reporter: ErrorReporter;
  readonly logger: MonitorLogger;
  readonly clock: Clock;
  /** Đang tồn đọng thì nhắc lại sau bao lâu (ms). */
  readonly realertAfterMs?: number;
}

export type BacklogCheckResult =
  | { readonly status: 'ok'; readonly backlog: OutboxBacklog }
  | { readonly status: 'alert'; readonly backlog: OutboxBacklog; readonly notified: boolean }
  | { readonly status: 'recovered'; readonly backlog: OutboxBacklog }
  | { readonly status: 'error' };

const DEFAULT_REALERT_MS = 15 * 60_000;

export function isBacklogged(backlog: OutboxBacklog, thresholds: OutboxBacklogThresholds): boolean {
  return (
    backlog.unpublished > thresholds.maxUnpublished || backlog.oldestAgeSeconds > thresholds.maxAgeSeconds
  );
}

export class OutboxBacklogMonitor {
  private alertingSince: Date | undefined;
  private lastNotifiedAt: Date | undefined;
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly deps: OutboxBacklogMonitorDeps) {}

  /** Một lượt kiểm tra (gọi trực tiếp trong test). Không bao giờ throw. */
  async check(): Promise<BacklogCheckResult> {
    const { thresholds, reporter, logger, clock } = this.deps;
    let backlog: OutboxBacklog;
    try {
      backlog = await this.deps.read();
    } catch (error) {
      logger.warn({ err: error }, 'outbox backlog check failed');
      return { status: 'error' };
    }
    const now = clock.now();
    const context = {
      unpublished: backlog.unpublished,
      oldestAgeSeconds: Math.round(backlog.oldestAgeSeconds),
      maxUnpublished: thresholds.maxUnpublished,
      maxAgeSeconds: thresholds.maxAgeSeconds,
    };

    if (!isBacklogged(backlog, thresholds)) {
      if (this.alertingSince === undefined) return { status: 'ok', backlog };
      logger.info(
        { ...context, alertingForSeconds: Math.round((now.getTime() - this.alertingSince.getTime()) / 1000) },
        'outbox backlog recovered',
      );
      this.alertingSince = undefined;
      this.lastNotifiedAt = undefined;
      return { status: 'recovered', backlog };
    }

    this.alertingSince ??= now;
    const realertAfterMs = this.deps.realertAfterMs ?? DEFAULT_REALERT_MS;
    const due =
      this.lastNotifiedAt === undefined || now.getTime() - this.lastNotifiedAt.getTime() >= realertAfterMs;
    if (!due) return { status: 'alert', backlog, notified: false };

    this.lastNotifiedAt = now;
    logger.error(context, 'outbox backlog above threshold');
    reporter.captureMessage('outbox backlog above threshold', 'warning', context);
    return { status: 'alert', backlog, notified: true };
  }

  start(intervalMs: number): void {
    const tick = async () => {
      await this.check();
      if (this.timer !== undefined) this.timer = setTimeout(() => void tick(), intervalMs);
    };
    this.timer = setTimeout(() => void tick(), intervalMs);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
}
