import { asDbTx } from '@tamgiao/db';
import type { Tx } from '@tamgiao/kernel';
import { and, asc, gt, inArray, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';
import type {
  MatchBoardCursor,
  MatchBoardFilter,
  MatchBoardQuery,
  MatchBoardRow,
} from '../application/ports/match-board-query.js';
import { MATCH_STATUSES, type MatchScoreSnapshot, type MatchStatus } from '../domain/match.js';
import { matches } from './schema-matches.js';

const isStatus = (v: string): v is MatchStatus => (MATCH_STATUSES as readonly string[]).includes(v);
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** jsonb `score_snapshot` → snapshot (cùng định dạng `DrizzleMatchRepository` ghi). Sai dạng là lỗi dữ liệu → throw. */
function toScoreSnapshot(id: string, raw: unknown): MatchScoreSnapshot | null {
  if (raw === null) return null;
  if (!isRecord(raw) || typeof raw['total'] !== 'number' || !isRecord(raw['pillars'])) {
    throw new Error(`matching.matches ${id}: score_snapshot không hợp lệ`);
  }
  const pillars: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw['pillars'])) {
    if (typeof value !== 'number') throw new Error(`matching.matches ${id}: score_snapshot không hợp lệ`);
    pillars[key] = value;
  }
  return { total: raw['total'], pillars };
}

/**
 * Keyset sau `cursor` theo thứ tự `expires_at ASC NULLS LAST, id ASC`:
 * - cursor có hạn: dòng có hạn lớn hơn (hoặc bằng hạn, id lớn hơn) **hoặc** mọi dòng không hạn (đứng cuối);
 * - cursor không hạn: chỉ dòng không hạn có id lớn hơn.
 */
function afterCursor(cursor: MatchBoardCursor): SQL | undefined {
  if (cursor.expiresAt === null) return and(isNull(matches.expiresAt), gt(matches.id, cursor.id));
  return or(
    and(
      isNotNull(matches.expiresAt),
      sql`(${matches.expiresAt}, ${matches.id}) > (${cursor.expiresAt.toISOString()}::timestamptz, ${cursor.id}::uuid)`,
    ),
    isNull(matches.expiresAt),
  );
}

/** Hiện thực `MatchBoardQuery` trên `matching.matches` (một câu SELECT, không dựng aggregate). */
export class DrizzleMatchBoardQuery implements MatchBoardQuery {
  async list(
    tx: Tx,
    filter: MatchBoardFilter,
    cursor: MatchBoardCursor | null,
    limit: number,
  ): Promise<readonly MatchBoardRow[]> {
    if (filter.statuses.length === 0) return [];
    const rows = await asDbTx(tx)
      .select({
        id: matches.id,
        userA: matches.userA,
        userB: matches.userB,
        status: matches.status,
        acceptedBy: matches.acceptedBy,
        scoreSnapshot: matches.scoreSnapshot,
        expiresAt: matches.expiresAt,
        offeredAt: matches.offeredAt,
        updatedAt: matches.updatedAt,
        createdBy: matches.createdBy,
      })
      .from(matches)
      .where(
        and(inArray(matches.status, [...filter.statuses]), cursor === null ? undefined : afterCursor(cursor)),
      )
      .orderBy(sql`${matches.expiresAt} asc nulls last`, asc(matches.id))
      .limit(limit);

    return rows.map((r): MatchBoardRow => {
      if (!isStatus(r.status)) throw new Error(`matching.matches ${r.id}: status không hợp lệ`);
      return {
        id: r.id,
        participants: [r.userA, r.userB],
        status: r.status,
        acceptedBy: r.acceptedBy,
        scoreSnapshot: toScoreSnapshot(r.id, r.scoreSnapshot),
        expiresAt: r.expiresAt,
        offeredAt: r.offeredAt,
        updatedAt: r.updatedAt,
        createdBy: r.createdBy,
      };
    });
  }
}
