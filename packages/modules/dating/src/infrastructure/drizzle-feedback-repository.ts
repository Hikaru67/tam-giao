import { asDbTx, type OutboxWriter } from '@tamgiao/db';
import { fail, ok, type Result, type Tx } from '@tamgiao/kernel';
import { and, count, desc, eq, sql } from 'drizzle-orm';
import type {
  AppearanceFlagPage,
  FeedbackAddError,
  FeedbackRepository,
} from '../application/ports/feedback-repository.js';
import {
  DateFeedback,
  FEEDBACK_DECISIONS,
  FEEDBACK_FEELINGS,
  FEEDBACK_PROFILE_MATCHES,
  FEEDBACK_STOP_REASONS,
  type DateFeedbackId,
  type FeedbackDecision,
  type FeedbackFeeling,
  type FeedbackProfileMatch,
  type FeedbackStopReason,
} from '../domain/date-feedback.js';
import type { DatePlanId, DatingMatchId, DatingUserId } from '../domain/date-plan.js';
import { FEEDBACKS_MATCH_AUTHOR_UNIQUE, feedbacks } from './schema.js';

type Row = typeof feedbacks.$inferSelect;

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

const isProfileMatch = (v: string): v is FeedbackProfileMatch =>
  (FEEDBACK_PROFILE_MATCHES as readonly string[]).includes(v);
const isFeeling = (v: string): v is FeedbackFeeling => (FEEDBACK_FEELINGS as readonly string[]).includes(v);
const isDecision = (v: string): v is FeedbackDecision =>
  (FEEDBACK_DECISIONS as readonly string[]).includes(v);
const isStopReason = (v: string): v is FeedbackStopReason =>
  (FEEDBACK_STOP_REASONS as readonly string[]).includes(v);

/** Dòng DB → aggregate. Dữ liệu sai dạng là lỗi dữ liệu/lập trình → throw. */
function toDateFeedback(row: Row): DateFeedback {
  if (!isProfileMatch(row.profileMatch)) {
    throw new Error(`dating.feedbacks ${row.id}: profile_match không hợp lệ`);
  }
  if (!isFeeling(row.feeling)) {
    throw new Error(`dating.feedbacks ${row.id}: feeling không hợp lệ`);
  }
  if (!isDecision(row.decision)) {
    throw new Error(`dating.feedbacks ${row.id}: decision không hợp lệ`);
  }
  if (!Array.isArray(row.stopReasons) || row.stopReasons.some((r) => !isStopReason(r))) {
    throw new Error(`dating.feedbacks ${row.id}: stop_reasons không hợp lệ`);
  }

  return DateFeedback.restore({
    id: row.id as DateFeedbackId,
    matchId: row.matchId,
    datePlanId: row.datePlanId as DatePlanId,
    authorId: row.authorId,
    subjectId: row.subjectId,
    rating: row.rating,
    profileMatch: row.profileMatch,
    feeling: row.feeling,
    decision: row.decision,
    stopReasons: row.stopReasons as FeedbackStopReason[],
    stopNote: row.stopNote,
    submittedAt: row.submittedAt,
  });
}

/**
 * Hiện thực `FeedbackRepository` trên `dating.feedbacks` + outbox, trong `tx` của caller (A5, A6).
 * Đánh giá bất biến sau khi lưu; unique `(match_id, author_id)` chặn đánh giá trùng lặp.
 */
export class DrizzleFeedbackRepository implements FeedbackRepository {
  constructor(private readonly outbox: OutboxWriter) {}

  /**
   * Khoá giao dịch theo match (`pg_advisory_xact_lock`) tới hết `tx` để tuần tự hoá hai người gửi đánh giá cùng lúc.
   */
  async lockMatch(tx: Tx, matchId: DatingMatchId): Promise<void> {
    await asDbTx(tx).execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${'dating.feedback:' + matchId.toLowerCase()}, 0))`,
    );
  }

  /**
   * INSERT đánh giá mới + event chờ (nếu có) vào outbox cùng `tx`.
   * Trùng `(match_id, author_id)` → `FEEDBACK_ALREADY_SUBMITTED`.
   */
  async add(tx: Tx, feedback: DateFeedback): Promise<Result<void, FeedbackAddError>> {
    const events = feedback.pullEvents();
    const s = feedback.toState();
    const db = asDbTx(tx);

    try {
      await db.insert(feedbacks).values({
        id: s.id,
        matchId: s.matchId,
        datePlanId: s.datePlanId,
        authorId: s.authorId,
        subjectId: s.subjectId,
        rating: s.rating,
        profileMatch: s.profileMatch,
        feeling: s.feeling,
        decision: s.decision,
        stopReasons: [...s.stopReasons],
        stopNote: s.stopNote,
        submittedAt: s.submittedAt,
      });
    } catch (error) {
      if (uniqueViolationConstraint(error) === FEEDBACKS_MATCH_AUTHOR_UNIQUE) {
        return fail('FEEDBACK_ALREADY_SUBMITTED', { matchId: s.matchId });
      }
      throw error;
    }

    if (events.length > 0) {
      await this.outbox.append(tx, events);
    }
    return ok();
  }

  async findById(tx: Tx, id: DateFeedbackId): Promise<DateFeedback | null> {
    const [row] = await asDbTx(tx).select().from(feedbacks).where(eq(feedbacks.id, id));
    return row ? toDateFeedback(row) : null;
  }

  async findByMatchAndAuthor(
    tx: Tx,
    matchId: DatingMatchId,
    authorId: DatingUserId,
  ): Promise<DateFeedback | null> {
    const [row] = await asDbTx(tx)
      .select()
      .from(feedbacks)
      .where(
        and(eq(feedbacks.matchId, matchId.toLowerCase()), eq(feedbacks.authorId, authorId.toLowerCase())),
      );
    return row ? toDateFeedback(row) : null;
  }

  async listAppearanceFlags(
    tx: Tx,
    page: { readonly limit: number; readonly offset: number },
  ): Promise<AppearanceFlagPage> {
    const db = asDbTx(tx);
    const condition = eq(feedbacks.profileMatch, 'DIFFERENT');

    const [countResult] = await db.select({ total: count() }).from(feedbacks).where(condition);
    const total = Number(countResult?.total ?? 0);

    const rows = await db
      .select({
        id: feedbacks.id,
        matchId: feedbacks.matchId,
        datePlanId: feedbacks.datePlanId,
        authorId: feedbacks.authorId,
        subjectId: feedbacks.subjectId,
        submittedAt: feedbacks.submittedAt,
      })
      .from(feedbacks)
      .where(condition)
      .orderBy(desc(feedbacks.submittedAt), desc(feedbacks.id))
      .limit(page.limit)
      .offset(page.offset);

    return {
      total,
      items: rows.map((r) => ({
        feedbackId: r.id as DateFeedbackId,
        matchId: r.matchId,
        datePlanId: r.datePlanId,
        authorId: r.authorId,
        subjectId: r.subjectId,
        submittedAt: r.submittedAt,
      })),
    };
  }
}
