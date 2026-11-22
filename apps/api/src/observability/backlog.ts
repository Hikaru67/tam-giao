/**
 * Truy vấn trạng thái hàng đợi để xuất metric (BE-S7-08): outbox chưa publish và độ dài hàng đợi pg-boss.
 * Chỉ đọc số đếm — không đọc payload (có thể chứa dữ liệu nghiệp vụ).
 */
export interface Queryable {
  query<R extends object>(sql: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

export interface OutboxBacklog {
  /** Số event chưa publish. */
  readonly unpublished: number;
  /** Tuổi (giây) của event chưa publish lâu nhất; 0 khi không tồn đọng. */
  readonly oldestAgeSeconds: number;
}

export async function readOutboxBacklog(db: Queryable): Promise<OutboxBacklog> {
  // Dùng partial index `outbox_unpublished_idx` (created_at where published_at is null).
  const { rows } = await db.query<{ unpublished: number; oldest_age_seconds: number | null }>(
    `select count(*)::int as unpublished,
            extract(epoch from (now() - min(created_at)))::float8 as oldest_age_seconds
       from platform.outbox
      where published_at is null`,
  );
  const row = rows[0];
  return { unpublished: row?.unpublished ?? 0, oldestAgeSeconds: Math.max(0, row?.oldest_age_seconds ?? 0) };
}

export interface QueueDepth {
  readonly queue: string;
  /** Trạng thái job pg-boss: `created` (chờ chạy), `retry`, `active`. */
  readonly state: string;
  readonly count: number;
}

/** Số job đang chờ/chạy theo hàng đợi pg-boss. Schema `pgboss` chưa có (DB mới) → rỗng. */
export async function readQueueDepths(db: Queryable): Promise<QueueDepth[]> {
  const { rows: exists } = await db.query<{ ok: boolean }>(
    `select to_regclass('pgboss.job') is not null as ok`,
  );
  if (!exists[0]?.ok) return [];
  const { rows } = await db.query<{ name: string; state: string; count: number }>(
    `select name, state::text as state, count(*)::int as count
       from pgboss.job
      where state in ('created', 'retry', 'active')
      group by name, state`,
  );
  return rows.map((r) => ({ queue: r.name, state: r.state, count: r.count }));
}
