import { asDbTx, type OutboxWriter } from '@tamgiao/db';
import { fail, ok, type Result, type Tx } from '@tamgiao/kernel';
import { and, desc, eq, gte, inArray, lte, or } from 'drizzle-orm';
import type { DatePlanRepository, DatePlanSaveError } from '../application/ports/date-plan-repository.js';
import {
  DATE_PLAN_STATUSES,
  DatePlan,
  OPEN_DATE_PLAN_STATUSES,
  type DatePlanId,
  type DatePlanStatus,
  type DatingMatchId,
  type DatingPartnerId,
  type DatingUserId,
} from '../domain/date-plan.js';
import { DATE_PLANS_OPEN_PER_MATCH_UNIQUE, datePlans } from './schema.js';

type Row = typeof datePlans.$inferSelect;

const PG_UNIQUE_VIOLATION = '23505';

/** Lỗi pg nằm trong chuỗi `cause` (Drizzle bọc lỗi driver trong `DrizzleQueryError`). */
export function uniqueViolationConstraint(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth++) {
    const e = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (e.code === PG_UNIQUE_VIOLATION && typeof e.constraint === 'string') return e.constraint;
    current = e.cause;
  }
  return null;
}

const isStatus = (v: string): v is DatePlanStatus => (DATE_PLAN_STATUSES as readonly string[]).includes(v);

/** Dòng DB → aggregate. Dữ liệu sai dạng là lỗi dữ liệu/lập trình → throw. */
function toDatePlan(row: Row): DatePlan {
  if (!isStatus(row.status)) throw new Error(`dating.date_plans ${row.id}: status không hợp lệ`);
  return DatePlan.restore({
    id: row.id as DatePlanId,
    matchId: row.matchId,
    inviterId: row.inviterId,
    inviteeId: row.inviteeId,
    partnerId: row.partnerId,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    staffBookingRequested: row.staffBookingRequested,
    status: row.status,
    proposedAt: row.proposedAt,
    expiresAt: row.expiresAt,
    respondedAt: row.respondedAt,
    cancelledAt: row.cancelledAt,
    cancelledBy: row.cancelledBy,
    updatedAt: row.updatedAt,
    version: row.version,
  });
}

/**
 * Hiện thực `DatePlanRepository` trên `dating.date_plans` + outbox, trong `tx` của caller. Kiểm tra version lạc quan
 * như `DrizzleConversationRepository`: version trước = version − số event chờ; `0` → INSERT (vi phạm
 * `date_plans_open_per_match_uq` → `DATE_ALREADY_OPEN`), khác → UPDATE có điều kiện version, lệch → throw.
 */
export class DrizzleDatePlanRepository implements DatePlanRepository {
  constructor(private readonly outbox: OutboxWriter) {}

  async save(tx: Tx, plan: DatePlan): Promise<Result<void, DatePlanSaveError>> {
    const events = plan.pullEvents();
    if (events.length === 0) return ok();
    const s = plan.toState();
    const previousVersion = s.version - events.length;
    const db = asDbTx(tx);
    const values = {
      status: s.status,
      respondedAt: s.respondedAt,
      cancelledAt: s.cancelledAt,
      cancelledBy: s.cancelledBy,
      updatedAt: s.updatedAt,
      version: s.version,
    };

    if (previousVersion === 0) {
      try {
        await db.insert(datePlans).values({
          id: s.id,
          matchId: s.matchId,
          inviterId: s.inviterId,
          inviteeId: s.inviteeId,
          partnerId: s.partnerId,
          startsAt: s.startsAt,
          endsAt: s.endsAt,
          staffBookingRequested: s.staffBookingRequested,
          proposedAt: s.proposedAt,
          expiresAt: s.expiresAt,
          ...values,
        });
      } catch (error) {
        // Transaction đã hỏng sau lỗi unique — caller trả `Err` để UnitOfWork rollback.
        if (uniqueViolationConstraint(error) === DATE_PLANS_OPEN_PER_MATCH_UNIQUE) {
          return fail('DATE_ALREADY_OPEN', { matchId: s.matchId });
        }
        throw error;
      }
    } else {
      const updated = await db
        .update(datePlans)
        .set(values)
        .where(and(eq(datePlans.id, s.id), eq(datePlans.version, previousVersion)))
        .returning({ id: datePlans.id });
      if (updated.length !== 1) {
        throw new Error(`dating.date_plans ${s.id}: xung đột version (mong đợi ${previousVersion})`);
      }
    }
    await this.outbox.append(tx, events);
    return ok();
  }

  async findById(tx: Tx, id: DatePlanId): Promise<DatePlan | null> {
    const [row] = await asDbTx(tx).select().from(datePlans).where(eq(datePlans.id, id));
    return row ? toDatePlan(row) : null;
  }

  async findByIdForUpdate(tx: Tx, id: DatePlanId): Promise<DatePlan | null> {
    const [row] = await asDbTx(tx).select().from(datePlans).where(eq(datePlans.id, id)).for('update');
    return row ? toDatePlan(row) : null;
  }

  async findOpenByMatch(tx: Tx, matchId: DatingMatchId): Promise<DatePlan | null> {
    const [row] = await asDbTx(tx)
      .select()
      .from(datePlans)
      .where(
        and(eq(datePlans.matchId, matchId.toLowerCase()), inArray(datePlans.status, [...OPEN_DATE_PLAN_STATUSES])),
      );
    return row ? toDatePlan(row) : null;
  }

  async findLatestByMatch(tx: Tx, matchId: DatingMatchId): Promise<DatePlan | null> {
    const [row] = await asDbTx(tx)
      .select()
      .from(datePlans)
      .where(eq(datePlans.matchId, matchId.toLowerCase()))
      .orderBy(desc(datePlans.proposedAt), desc(datePlans.id))
      .limit(1);
    return row ? toDatePlan(row) : null;
  }

  async findForVoucherCheckInForUpdate(
    tx: Tx,
    input: { readonly userId: DatingUserId; readonly partnerId: DatingPartnerId; readonly at: Date },
  ): Promise<DatePlan | null> {
    const userId = input.userId.toLowerCase();
    const partnerId = input.partnerId.toLowerCase();
    const [row] = await asDbTx(tx)
      .select()
      .from(datePlans)
      .where(
        and(
          or(eq(datePlans.inviterId, userId), eq(datePlans.inviteeId, userId)),
          eq(datePlans.partnerId, partnerId),
          inArray(datePlans.status, ['CONFIRMED', 'CHECKED_IN']),
          lte(datePlans.startsAt, input.at),
          gte(datePlans.endsAt, input.at),
        ),
      )
      .orderBy(desc(datePlans.startsAt))
      .limit(1)
      .for('update');
    return row ? toDatePlan(row) : null;
  }
}
