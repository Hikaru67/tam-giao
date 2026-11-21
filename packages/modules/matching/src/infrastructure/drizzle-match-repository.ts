import { asDbTx, type OutboxWriter } from '@tamgiao/db';
import type { Tx } from '@tamgiao/kernel';
import { and, desc, eq, inArray, or } from 'drizzle-orm';
import type { MatchRepository } from '../application/ports/match-repository.js';
import {
  MATCH_CLOSE_OUTCOMES,
  MATCH_STATUSES,
  Match,
  OPEN_MATCH_STATUSES,
  type MatchCloseOutcome,
  type MatchId,
  type MatchScoreSnapshot,
  type MatchStatus,
} from '../domain/match.js';
import { matchEvents, matches } from './schema-matches.js';

type MatchRow = typeof matches.$inferSelect;

const isStatus = (v: string): v is MatchStatus => (MATCH_STATUSES as readonly string[]).includes(v);
const isOutcome = (v: string): v is MatchCloseOutcome =>
  (MATCH_CLOSE_OUTCOMES as readonly string[]).includes(v);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

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

/** Dòng DB → aggregate. Dữ liệu sai dạng là lỗi dữ liệu/lập trình → throw. */
function toMatch(row: MatchRow): Match {
  if (!isStatus(row.status)) throw new Error(`matching.matches ${row.id}: status không hợp lệ`);
  const { closeOutcome } = row;
  if (closeOutcome !== null && !isOutcome(closeOutcome)) {
    throw new Error(`matching.matches ${row.id}: close_outcome không hợp lệ`);
  }
  return Match.restore({
    id: row.id as MatchId,
    participants: [row.userA, row.userB],
    createdBy: row.createdBy,
    scoreSnapshot: toScoreSnapshot(row.id, row.scoreSnapshot),
    staffNote: row.staffNote,
    status: row.status,
    acceptedBy: row.acceptedBy,
    expiresAt: row.expiresAt,
    offeredAt: row.offeredAt,
    datingStartedAt: row.datingStartedAt,
    metAt: row.metAt,
    closedAt: row.closedAt,
    declinedBy: row.declinedBy,
    declineReason: row.declineReason,
    withdrawn: row.withdrawn,
    closeOutcome,
    lockReason: row.lockReason,
    updatedAt: row.updatedAt,
    version: row.version,
  });
}

/**
 * Hiện thực `MatchRepository` trên `matching.matches` + `matching.match_events` (append-only) + outbox, tất cả trong
 * `tx` của caller. Kiểm tra version lạc quan: version trước = version hiện tại − số event chờ phát; `0` → INSERT
 * (match mới), ngược lại `UPDATE … WHERE version = <trước>` — không khớp dòng nào → throw (ghi đè đồng thời).
 */
export class DrizzleMatchRepository implements MatchRepository {
  constructor(private readonly outbox: OutboxWriter) {}

  async save(tx: Tx, match: Match): Promise<void> {
    const events = match.pullEvents();
    if (events.length === 0) return;
    const s = match.toState();
    const previousVersion = s.version - events.length;
    const db = asDbTx(tx);
    const values = {
      status: s.status,
      acceptedBy: [...s.acceptedBy],
      scoreSnapshot: s.scoreSnapshot,
      staffNote: s.staffNote,
      expiresAt: s.expiresAt,
      datingStartedAt: s.datingStartedAt,
      metAt: s.metAt,
      closedAt: s.closedAt,
      declinedBy: s.declinedBy,
      declineReason: s.declineReason,
      withdrawn: s.withdrawn,
      closeOutcome: s.closeOutcome,
      lockReason: s.lockReason,
      updatedAt: s.updatedAt,
      version: s.version,
    };

    if (previousVersion === 0) {
      await db.insert(matches).values({
        id: s.id,
        userA: s.participants[0],
        userB: s.participants[1],
        createdBy: s.createdBy,
        offeredAt: s.offeredAt,
        ...values,
      });
    } else {
      const updated = await db
        .update(matches)
        .set(values)
        .where(and(eq(matches.id, s.id), eq(matches.version, previousVersion)))
        .returning({ id: matches.id });
      if (updated.length !== 1) {
        throw new Error(`matching.matches ${s.id}: xung đột version (mong đợi ${previousVersion})`);
      }
    }

    await db.insert(matchEvents).values(
      events.map((e) => ({
        id: e.eventId,
        matchId: s.id,
        eventType: e.type,
        payload: e.payload,
        occurredAt: e.occurredAt,
        version: e.version,
      })),
    );
    await this.outbox.append(tx, events);
  }

  async findById(tx: Tx, id: MatchId): Promise<Match | null> {
    const [row] = await asDbTx(tx).select().from(matches).where(eq(matches.id, id));
    return row ? toMatch(row) : null;
  }

  async findByIdForUpdate(tx: Tx, id: MatchId): Promise<Match | null> {
    const [row] = await asDbTx(tx).select().from(matches).where(eq(matches.id, id)).for('update');
    return row ? toMatch(row) : null;
  }

  async findOpenByUser(tx: Tx, userId: string): Promise<Match | null> {
    const id = userId.toLowerCase();
    const [row] = await asDbTx(tx)
      .select()
      .from(matches)
      .where(
        and(
          or(eq(matches.userA, id), eq(matches.userB, id)),
          inArray(matches.status, [...OPEN_MATCH_STATUSES]),
        ),
      )
      .orderBy(desc(matches.offeredAt), desc(matches.id))
      .limit(1);
    return row ? toMatch(row) : null;
  }
}
