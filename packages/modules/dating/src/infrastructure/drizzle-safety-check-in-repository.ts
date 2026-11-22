import { asDbTx, type OutboxWriter } from '@tamgiao/db';
import { fail, ok, type Result, type Tx } from '@tamgiao/kernel';
import { and, eq } from 'drizzle-orm';
import type { SafetyCheckInRepository } from '../application/ports/safety-check-in-repository.js';
import {
  CHECK_IN_SOURCES,
  type CheckInSource,
  type DatePlanId,
  type DatingUserId,
} from '../domain/date-plan.js';
import {
  SafetyCheckIn,
  type AlreadyCheckedIn,
  type SafetyCheckInId,
} from '../domain/safety-check-in.js';
import { uniqueViolationConstraint } from './drizzle-date-plan-repository.js';
import { SAFETY_CHECK_INS_PLAN_USER_UNIQUE, safetyCheckIns } from './schema.js';

type Row = typeof safetyCheckIns.$inferSelect;

const isSource = (v: string): v is CheckInSource => (CHECK_IN_SOURCES as readonly string[]).includes(v);

/** Dòng DB → aggregate `SafetyCheckIn`. Dữ liệu sai dạng là lỗi dữ liệu/lập trình → throw. */
function toSafetyCheckIn(row: Row): SafetyCheckIn {
  if (!isSource(row.source)) throw new Error(`dating.safety_check_ins ${row.id}: source không hợp lệ`);
  return SafetyCheckIn.restore({
    id: row.id as SafetyCheckInId,
    datePlanId: row.datePlanId as DatePlanId,
    matchId: row.matchId,
    userId: row.userId,
    partnerId: row.partnerId,
    source: row.source,
    checkedInAt: row.checkedInAt,
    dateEndsAt: row.dateEndsAt,
    overdueAt: row.overdueAt,
    checkedOutAt: row.checkedOutAt,
    overdueAlertedAt: row.overdueAlertedAt,
    locationShared: row.locationShared,
    updatedAt: row.updatedAt,
    version: row.version,
  });
}

/**
 * Hiện thực `SafetyCheckInRepository` trên `dating.safety_check_ins` + outbox, trong `tx` của caller.
 * Version lạc quan: previousVersion = version − số event chờ; 0 → INSERT (vi phạm unique
 * `safety_check_ins_plan_user_uq` → `DATE_ALREADY_CHECKED_IN`), khác → UPDATE có điều kiện version, lệch → throw.
 */
export class DrizzleSafetyCheckInRepository implements SafetyCheckInRepository {
  constructor(private readonly outbox: OutboxWriter) {}

  async save(tx: Tx, checkIn: SafetyCheckIn): Promise<Result<void, AlreadyCheckedIn>> {
    const events = checkIn.pullEvents();
    if (events.length === 0) return ok();
    const s = checkIn.toState();
    const previousVersion = s.version - events.length;
    const db = asDbTx(tx);

    if (previousVersion === 0) {
      try {
        await db.insert(safetyCheckIns).values({
          id: s.id,
          datePlanId: s.datePlanId,
          matchId: s.matchId,
          userId: s.userId,
          partnerId: s.partnerId,
          source: s.source,
          checkedInAt: s.checkedInAt,
          dateEndsAt: s.dateEndsAt,
          overdueAt: s.overdueAt,
          checkedOutAt: s.checkedOutAt,
          overdueAlertedAt: s.overdueAlertedAt,
          locationShared: s.locationShared,
          updatedAt: s.updatedAt,
          version: s.version,
        });
      } catch (error) {
        if (uniqueViolationConstraint(error) === SAFETY_CHECK_INS_PLAN_USER_UNIQUE) {
          return fail('DATE_ALREADY_CHECKED_IN', { datePlanId: s.datePlanId });
        }
        throw error;
      }
    } else {
      const updated = await db
        .update(safetyCheckIns)
        .set({
          checkedOutAt: s.checkedOutAt,
          overdueAlertedAt: s.overdueAlertedAt,
          updatedAt: s.updatedAt,
          version: s.version,
        })
        .where(and(eq(safetyCheckIns.id, s.id), eq(safetyCheckIns.version, previousVersion)))
        .returning({ id: safetyCheckIns.id });
      if (updated.length !== 1) {
        throw new Error(`dating.safety_check_ins ${s.id}: xung đột version (mong đợi ${previousVersion})`);
      }
    }
    await this.outbox.append(tx, events);
    return ok();
  }

  async findByPlanAndUser(tx: Tx, datePlanId: DatePlanId, userId: DatingUserId): Promise<SafetyCheckIn | null> {
    const [row] = await asDbTx(tx)
      .select()
      .from(safetyCheckIns)
      .where(and(eq(safetyCheckIns.datePlanId, datePlanId), eq(safetyCheckIns.userId, userId.toLowerCase())));
    return row ? toSafetyCheckIn(row) : null;
  }

  async findByPlanAndUserForUpdate(
    tx: Tx,
    datePlanId: DatePlanId,
    userId: DatingUserId,
  ): Promise<SafetyCheckIn | null> {
    const [row] = await asDbTx(tx)
      .select()
      .from(safetyCheckIns)
      .where(and(eq(safetyCheckIns.datePlanId, datePlanId), eq(safetyCheckIns.userId, userId.toLowerCase())))
      .for('update');
    return row ? toSafetyCheckIn(row) : null;
  }

  async findByIdForUpdate(tx: Tx, id: SafetyCheckInId): Promise<SafetyCheckIn | null> {
    const [row] = await asDbTx(tx)
      .select()
      .from(safetyCheckIns)
      .where(eq(safetyCheckIns.id, id))
      .for('update');
    return row ? toSafetyCheckIn(row) : null;
  }
}
