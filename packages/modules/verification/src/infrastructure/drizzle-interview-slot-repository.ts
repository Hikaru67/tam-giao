import { asDbTx } from '@tamgiao/db';
import { fail, ok, type Result, type Tx } from '@tamgiao/kernel';
import { and, asc, desc, eq, gt, gte, lt, sql, type SQL } from 'drizzle-orm';
import type {
  InterviewSlotListFilter,
  InterviewSlotRepository,
  InterviewSlotSaveError,
} from '../application/ports/interview-slot-repository.js';
import {
  INTERVIEW_OUTCOMES,
  INTERVIEW_SLOT_STATUSES,
  InterviewSlot,
  type InterviewOutcome,
  type InterviewSlotId,
  type InterviewSlotStatus,
} from '../domain/interview-slot.js';
import {
  INTERVIEW_ACTIVE_BOOKING_UNIQUE,
  INTERVIEW_INTERVIEWER_START_UNIQUE,
  interviewSlots,
} from './schema.js';

type Row = typeof interviewSlots.$inferSelect;

const PG_UNIQUE_VIOLATION = '23505';

/** Lỗi pg nằm trong chuỗi `cause` (Drizzle bọc lỗi driver trong `DrizzleQueryError`). */
function uniqueViolationConstraint(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth++) {
    const e = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (e.code === PG_UNIQUE_VIOLATION && typeof e.constraint === 'string') return e.constraint;
    current = e.cause;
  }
  return null;
}

const includes = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === 'string' && (list as readonly string[]).includes(v);

function toDomain(row: Row): InterviewSlot {
  if (!includes<InterviewSlotStatus>(INTERVIEW_SLOT_STATUSES, row.status)) {
    throw new Error(`verification.interview_slots ${row.id}: status trong DB không hợp lệ`);
  }
  let outcome: InterviewOutcome | null = null;
  if (row.outcome !== null) {
    if (!includes<InterviewOutcome>(INTERVIEW_OUTCOMES, row.outcome)) {
      throw new Error(`verification.interview_slots ${row.id}: outcome trong DB không hợp lệ`);
    }
    outcome = row.outcome;
  }
  return InterviewSlot.restore({
    id: row.id as InterviewSlotId,
    interviewerId: row.interviewerId,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    meetingUrl: row.meetingUrl,
    status: row.status,
    bookedBy: row.bookedBy,
    bookedAt: row.bookedAt,
    outcome,
    notes: row.notes,
    recordedBy: row.recordedBy,
    recordedAt: row.recordedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

/** Hiện thực `InterviewSlotRepository` bằng Drizzle + PostgreSQL. */
export class DrizzleInterviewSlotRepository implements InterviewSlotRepository {
  async findById(tx: Tx, id: InterviewSlotId): Promise<InterviewSlot | null> {
    const [row] = await asDbTx(tx).select().from(interviewSlots).where(eq(interviewSlots.id, id));
    return row ? toDomain(row) : null;
  }

  async findByIdForUpdate(tx: Tx, id: InterviewSlotId): Promise<InterviewSlot | null> {
    const [row] = await asDbTx(tx)
      .select()
      .from(interviewSlots)
      .where(eq(interviewSlots.id, id))
      .for('update');
    return row ? toDomain(row) : null;
  }

  async findActiveByUser(tx: Tx, userId: string): Promise<InterviewSlot | null> {
    const [row] = await asDbTx(tx).select().from(interviewSlots).where(this.activeOf(userId));
    return row ? toDomain(row) : null;
  }

  async findActiveByUserForUpdate(tx: Tx, userId: string): Promise<InterviewSlot | null> {
    const [row] = await asDbTx(tx).select().from(interviewSlots).where(this.activeOf(userId)).for('update');
    return row ? toDomain(row) : null;
  }

  async hasOverlapForUpdate(tx: Tx, interviewerId: string, startsAt: Date, endsAt: Date): Promise<boolean> {
    await asDbTx(tx).execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`verification.interview_slots:${interviewerId}`}, 0))`,
    );
    const rows = await asDbTx(tx)
      .select({ id: interviewSlots.id })
      .from(interviewSlots)
      .where(
        and(
          eq(interviewSlots.interviewerId, interviewerId),
          lt(interviewSlots.startsAt, endsAt),
          gt(interviewSlots.endsAt, startsAt),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async listOpen(tx: Tx, input: { readonly from: Date; readonly limit: number }): Promise<InterviewSlot[]> {
    const rows = await asDbTx(tx)
      .select()
      .from(interviewSlots)
      .where(and(eq(interviewSlots.status, 'OPEN'), gt(interviewSlots.startsAt, input.from)))
      .orderBy(asc(interviewSlots.startsAt), asc(interviewSlots.id))
      .limit(input.limit);
    return rows.map(toDomain);
  }

  async list(tx: Tx, filter: InterviewSlotListFilter): Promise<InterviewSlot[]> {
    const conditions: SQL[] = [];
    if (filter.status !== undefined) conditions.push(eq(interviewSlots.status, filter.status));
    if (filter.from !== undefined) conditions.push(gte(interviewSlots.startsAt, filter.from));
    if (filter.to !== undefined) conditions.push(lt(interviewSlots.startsAt, filter.to));
    const rows = await asDbTx(tx)
      .select()
      .from(interviewSlots)
      .where(and(...conditions))
      .orderBy(desc(interviewSlots.startsAt), desc(interviewSlots.id))
      .limit(filter.limit);
    return rows.map(toDomain);
  }

  async save(tx: Tx, slot: InterviewSlot): Promise<Result<void, InterviewSlotSaveError>> {
    const s = slot.toState();
    const values = { ...s };
    const { id: _id, interviewerId: _i, createdAt: _c, ...updatable } = values;
    try {
      await asDbTx(tx)
        .insert(interviewSlots)
        .values(values)
        .onConflictDoUpdate({ target: interviewSlots.id, set: updatable });
    } catch (error) {
      const constraint = uniqueViolationConstraint(error);
      if (constraint === INTERVIEW_ACTIVE_BOOKING_UNIQUE) return fail('INTERVIEW_ALREADY_BOOKED');
      if (constraint === INTERVIEW_INTERVIEWER_START_UNIQUE) return fail('INTERVIEW_SLOT_OVERLAP');
      throw error;
    }
    return ok();
  }

  private activeOf(userId: string): SQL | undefined {
    return and(eq(interviewSlots.bookedBy, userId), eq(interviewSlots.status, 'BOOKED'));
  }
}
