import { AggregateRoot, err, fail, ok, type DomainError, type Id, type Result } from '@tamgiao/kernel';
import type { DatePlanId, DatePlanStatus, DatingMatchId, DatingUserId } from './date-plan.js';

export type DateFeedbackId = Id<'DateFeedback'>;

/**
 * Tên event (bản sao của `@tamgiao/contracts` `dating/events.ts` — domain không import contracts ngoài `constants`, A1;
 * `dating-contracts.test.ts` đối chiếu).
 */
export const FEEDBACK_SUBMITTED = 'FeedbackSubmitted';

export const FEEDBACK_RATING_MIN = 1;
export const FEEDBACK_RATING_MAX = 5;
/** Độ dài tối đa ghi chú kín (code point, sau trim). */
export const FEEDBACK_NOTE_MAX_LENGTH = 1000;

/** Ngoại hình & phong thái so với hồ sơ eKYC. `DIFFERENT` ("Có khác biệt") → cờ cho chuyên viên đối soát. */
export const FEEDBACK_PROFILE_MATCHES = ['FULL_MATCH', 'MOSTLY_MATCH', 'DIFFERENT'] as const;
export type FeedbackProfileMatch = (typeof FEEDBACK_PROFILE_MATCHES)[number];

export const FEEDBACK_FEELINGS = ['DEEP_INTEREST', 'NEED_MORE_TIME', 'NOT_A_FIT'] as const;
export type FeedbackFeeling = (typeof FEEDBACK_FEELINGS)[number];

/** `A_COMMIT`: tiến tới cam kết gắn kết; `B_STOP`: dừng tìm hiểu. */
export const FEEDBACK_DECISIONS = ['A_COMMIT', 'B_STOP'] as const;
export type FeedbackDecision = (typeof FEEDBACK_DECISIONS)[number];

export const FEEDBACK_STOP_REASONS = [
  'LIFESTYLE_DIFFERENCE',
  'NO_SPARK',
  'FINANCE_FAMILY_PLAN_DIFFERENCE',
] as const;
export type FeedbackStopReason = (typeof FEEDBACK_STOP_REASONS)[number];

/** Kết quả quyết định của cặp — khớp `MatchCloseOutcome` của matching. */
export type FeedbackOutcome = 'SUCCESS' | 'STOPPED';

/** Lịch hẹn ở các trạng thái này (và đã tới giờ bắt đầu) mới được đánh giá — tức buổi gặp đã diễn ra. */
export const FEEDBACK_ELIGIBLE_DATE_STATUSES = [
  'CONFIRMED',
  'CHECKED_IN',
  'COMPLETED',
] as const satisfies readonly DatePlanStatus[];

export type FeedbackInvalid = DomainError<'FEEDBACK_INVALID'>;
export type FeedbackSubmitError =
  | FeedbackInvalid
  | DomainError<'NOT_PARTICIPANT' | 'FEEDBACK_NOT_ALLOWED' | 'FEEDBACK_ALREADY_SUBMITTED'>;

/** Câu trả lời khảo sát người dùng gửi (đã qua kiểm tra dạng ở presentation; domain kiểm tra lại luật). */
export interface FeedbackAnswers {
  readonly rating: number;
  readonly profileMatch: FeedbackProfileMatch;
  readonly feeling: FeedbackFeeling;
  readonly decision: FeedbackDecision;
  readonly stopReasons: readonly FeedbackStopReason[];
  /** Văn bản tự do — có thể chứa PII: KHÔNG log, KHÔNG đưa vào event/audit. */
  readonly stopNote: string | null;
}

/** Ảnh chụp lịch hẹn được đánh giá (dating tự sở hữu `DatePlan`, truyền vào để aggregate kiểm tra luật). */
export interface FeedbackDateContext {
  readonly datePlanId: DatePlanId;
  readonly matchId: DatingMatchId;
  readonly inviterId: DatingUserId;
  readonly inviteeId: DatingUserId;
  readonly status: DatePlanStatus;
  readonly startsAt: Date;
}

export interface DateFeedbackState extends FeedbackAnswers {
  readonly id: DateFeedbackId;
  readonly matchId: DatingMatchId;
  readonly datePlanId: DatePlanId;
  readonly authorId: DatingUserId;
  /** Người còn lại của cặp — người được đánh giá. */
  readonly subjectId: DatingUserId;
  readonly submittedAt: Date;
}

/**
 * Quyết định của cặp từ các đánh giá đã có: có `B_STOP` → `STOPPED`; đủ hai đánh giá (đều `A_COMMIT`) → `SUCCESS`;
 * còn lại (0–1 đánh giá `A_COMMIT`) → `null` (chưa chốt).
 */
export function decideFeedbackOutcome(decisions: readonly FeedbackDecision[]): FeedbackOutcome | null {
  if (decisions.includes('B_STOP')) return 'STOPPED';
  return decisions.length >= 2 ? 'SUCCESS' : null;
}

const invalid = (reason: string): Result<never, FeedbackInvalid> => fail('FEEDBACK_INVALID', { reason });

const isOneOf = <T extends string>(list: readonly T[], value: string): value is T =>
  (list as readonly string[]).includes(value);

/** Chuẩn hoá + kiểm tra câu trả lời. Ghi chú trim, rỗng → `null`; lý do bỏ trùng, giữ thứ tự gửi. */
function normalizeAnswers(a: FeedbackAnswers): Result<FeedbackAnswers, FeedbackInvalid> {
  if (!Number.isInteger(a.rating) || a.rating < FEEDBACK_RATING_MIN || a.rating > FEEDBACK_RATING_MAX) {
    return invalid('RATING_OUT_OF_RANGE');
  }
  if (!isOneOf(FEEDBACK_PROFILE_MATCHES, a.profileMatch)) return invalid('PROFILE_MATCH_INVALID');
  if (!isOneOf(FEEDBACK_FEELINGS, a.feeling)) return invalid('FEELING_INVALID');
  if (!isOneOf(FEEDBACK_DECISIONS, a.decision)) return invalid('DECISION_INVALID');
  if (a.stopReasons.some((r) => !isOneOf(FEEDBACK_STOP_REASONS, r))) return invalid('STOP_REASON_INVALID');
  const stopReasons = [...new Set(a.stopReasons)];
  const trimmed = a.stopNote?.trim() ?? '';
  const stopNote = trimmed.length === 0 ? null : trimmed;
  if (stopNote !== null && [...stopNote].length > FEEDBACK_NOTE_MAX_LENGTH) return invalid('NOTE_TOO_LONG');
  if (a.decision === 'A_COMMIT' && (stopReasons.length > 0 || stopNote !== null)) {
    return invalid('STOP_DETAILS_WITHOUT_STOP');
  }
  return ok({ ...a, stopReasons, stopNote });
}

/**
 * Aggregate `DateFeedback` — đánh giá kín của **một** người sau buổi gặp (BE-S7-03). Bất biến sau khi gửi; mỗi người
 * tối đa một đánh giá / match (unique `(match_id, author_id)` ở DB, A10). Nội dung chỉ chuyên viên đọc được.
 *
 * `submit` kiểm tra theo thứ tự: người ngoài cặp → `NOT_PARTICIPANT` (trước mọi kiểm tra khác, không lộ trạng thái) →
 * lịch chưa diễn ra (không ở `CONFIRMED | CHECKED_IN | COMPLETED` hoặc `now < startsAt`) → `FEEDBACK_NOT_ALLOWED` →
 * câu trả lời sai luật → `FEEDBACK_INVALID`.
 *
 * Event: phát `FeedbackSubmitted{outcome}` đúng một lần cho mỗi match — khi đánh giá này làm quyết định của cặp chuyển
 * từ "chưa chốt" sang chốt (`decideFeedbackOutcome`): người đầu tiên chọn `B_STOP` (không chờ người kia), hoặc người
 * thứ hai khi cả hai `A_COMMIT`. Đánh giá gửi sau khi đã chốt (vd người còn lại gửi sau một `B_STOP`) chỉ được lưu.
 * Caller phải tuần tự hoá các lần gửi của cùng match (khoá theo match) để `counterpart` là dữ liệu mới nhất.
 */
export class DateFeedback extends AggregateRoot<DateFeedbackId> {
  protected readonly aggregateType = 'DateFeedback';

  private constructor(
    private readonly state: DateFeedbackState,
    version: number,
  ) {
    super(state.id, version);
  }

  static submit(
    input: {
      readonly id: DateFeedbackId;
      readonly date: FeedbackDateContext;
      readonly authorId: DatingUserId;
      readonly answers: FeedbackAnswers;
    },
    /** Đánh giá của người còn lại (nếu đã gửi). */
    counterpart: DateFeedback | null,
    now: Date,
  ): Result<DateFeedback, FeedbackSubmitError> {
    const { date } = input;
    const authorId = input.authorId.toLowerCase();
    const inviterId = date.inviterId.toLowerCase();
    const inviteeId = date.inviteeId.toLowerCase();
    if (authorId !== inviterId && authorId !== inviteeId) return fail('NOT_PARTICIPANT');
    const subjectId = authorId === inviterId ? inviteeId : inviterId;
    const matchId = date.matchId.toLowerCase();

    const eligible = (FEEDBACK_ELIGIBLE_DATE_STATUSES as readonly DatePlanStatus[]).includes(date.status);
    if (!eligible || now.getTime() < date.startsAt.getTime()) {
      return fail('FEEDBACK_NOT_ALLOWED', { reason: 'DATE_NOT_HAPPENED', status: date.status });
    }
    if (counterpart !== null && (counterpart.matchId !== matchId || counterpart.authorId !== subjectId)) {
      throw new Error('DateFeedback.submit: counterpart không phải đánh giá của người còn lại trong cùng match');
    }

    const answers = normalizeAnswers(input.answers);
    if (answers.isErr()) return err(answers.error);

    const feedback = new DateFeedback(
      {
        ...answers.value,
        id: input.id,
        matchId,
        datePlanId: date.datePlanId,
        authorId,
        subjectId,
        submittedAt: new Date(now.getTime()),
      },
      0,
    );

    const before = decideFeedbackOutcome(counterpart === null ? [] : [counterpart.decision]);
    const after = decideFeedbackOutcome(
      counterpart === null ? [feedback.decision] : [counterpart.decision, feedback.decision],
    );
    if (before === null && after !== null) {
      feedback.record(
        FEEDBACK_SUBMITTED,
        {
          matchId,
          datePlanId: date.datePlanId,
          participantIds: [inviterId, inviteeId],
          outcome: after,
        },
        now,
      );
    }
    return ok(feedback);
  }

  static restore(state: DateFeedbackState): DateFeedback {
    return new DateFeedback({ ...state, stopReasons: [...state.stopReasons] }, 0);
  }

  get matchId(): DatingMatchId {
    return this.state.matchId;
  }

  get authorId(): DatingUserId {
    return this.state.authorId;
  }

  get subjectId(): DatingUserId {
    return this.state.subjectId;
  }

  get decision(): FeedbackDecision {
    return this.state.decision;
  }

  /** "Có khác biệt" so với hồ sơ eKYC — chuyên viên cần đối soát người được đánh giá. */
  get flagsAppearanceMismatch(): boolean {
    return this.state.profileMatch === 'DIFFERENT';
  }

  toState(): DateFeedbackState {
    return { ...this.state, stopReasons: [...this.state.stopReasons] };
  }
}
