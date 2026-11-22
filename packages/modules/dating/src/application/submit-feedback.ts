import {
  err,
  fail,
  newId,
  ok,
  parseId,
  type Clock,
  type DomainError,
  type Result,
  type UnitOfWork,
} from '@tamgiao/kernel';
import {
  DateFeedback,
  type DateFeedbackState,
  type FeedbackAnswers,
  type FeedbackSubmitError,
} from '../domain/date-feedback.js';
import type { DatePlanId } from '../domain/date-plan.js';
import type { DatePlanRepository } from './ports/date-plan-repository.js';
import type { FeedbackRepository } from './ports/feedback-repository.js';

/** Đánh giá trả cho presentation. Chứa câu trả lời kín — chỉ trả cho chính tác giả hoặc chuyên viên. */
export type FeedbackView = DateFeedbackState;

export interface SubmitFeedbackCommand {
  readonly userId: string;
  readonly datePlanId: string;
  readonly answers: FeedbackAnswers;
}

export type SubmitFeedbackError = FeedbackSubmitError | DomainError<'INVALID_ID' | 'NOT_FOUND'>;

export interface FeedbackUseCaseDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly datePlans: DatePlanRepository;
  readonly feedbacks: FeedbackRepository;
}

export function parseDatePlanId(raw: string): Result<DatePlanId, DomainError<'INVALID_ID'>> {
  const id = parseId<'DatePlan'>(raw);
  return id.isErr() ? fail('INVALID_ID', { field: 'datePlanId' }) : ok(id.value);
}

/**
 * Gửi đánh giá kín sau buổi gặp (BE-S7-03, `POST /me/dates/:id/feedback`). **Một transaction**:
 * tải và khoá dòng lịch `FOR UPDATE` (không có → `NOT_FOUND`) → người ngoài cặp → `NOT_PARTICIPANT` (trước mọi kiểm tra
 * khác) → khoá theo match (tuần tự hoá với người còn lại gửi cùng lúc) → đã gửi → `FEEDBACK_ALREADY_SUBMITTED` →
 * đọc đánh giá của người còn lại → domain `DateFeedback.submit` (lịch chưa diễn ra → `FEEDBACK_NOT_ALLOWED`, câu trả lời
 * sai → `FEEDBACK_INVALID`; chốt quyết định của cặp → `FeedbackSubmitted` vào outbox) → INSERT (unique `(match_id, author_id)`
 * là chốt chặn cuối, A10) → đánh giá đầu tiên của match (`CONFIRMED | CHECKED_IN`) chuyển lịch sang `COMPLETED`, phát
 * `DateCompleted` qua outbox (BE-S7-04, matching tiêu thụ để chuyển `DATING → MET`). Matching tiêu thụ `FeedbackSubmitted`
 * để đóng match — use case không gọi matching trực tiếp (A6).
 *
 * Không kiểm tra trạng thái match qua facade: đánh giá vẫn được lưu cho chuyên viên khi match đã đóng (vd người còn lại
 * gửi sau một `B_STOP`); matching tự bỏ qua event nếu match không còn mở.
 */
export class SubmitFeedback {
  constructor(private readonly deps: FeedbackUseCaseDeps) {}

  async execute(cmd: SubmitFeedbackCommand): Promise<Result<FeedbackView, SubmitFeedbackError>> {
    const id = parseDatePlanId(cmd.datePlanId);
    if (id.isErr()) return err(id.error);
    const userId = cmd.userId.toLowerCase();

    return this.deps.uow.run(async (tx): Promise<Result<FeedbackView, SubmitFeedbackError>> => {
      const plan = await this.deps.datePlans.findByIdForUpdate(tx, id.value);
      if (plan === null) return fail('NOT_FOUND');
      if (!plan.isParticipant(userId)) return fail('NOT_PARTICIPANT');

      await this.deps.feedbacks.lockMatch(tx, plan.matchId);
      const mine = await this.deps.feedbacks.findByMatchAndAuthor(tx, plan.matchId, userId);
      if (mine !== null) return fail('FEEDBACK_ALREADY_SUBMITTED');
      const counterpartId = userId === plan.inviterId ? plan.inviteeId : plan.inviterId;
      const counterpart = await this.deps.feedbacks.findByMatchAndAuthor(tx, plan.matchId, counterpartId);

      const now = this.deps.clock.now();
      const submitted = DateFeedback.submit(
        {
          id: newId<'DateFeedback'>(),
          date: {
            datePlanId: plan.id,
            matchId: plan.matchId,
            inviterId: plan.inviterId,
            inviteeId: plan.inviteeId,
            status: plan.status,
            startsAt: plan.startsAt,
          },
          authorId: userId,
          answers: cmd.answers,
        },
        counterpart,
        now,
      );
      if (submitted.isErr()) return err(submitted.error);
      const feedback = submitted.value;

      const added = await this.deps.feedbacks.add(tx, feedback);
      if (added.isErr()) return err(added.error);

      if (plan.status === 'CONFIRMED' || plan.status === 'CHECKED_IN') {
        const completed = plan.markCompleted(now);
        if (completed.isErr()) {
          throw new Error(`dating.date_plans ${plan.id}: ${completed.error.code} khi markCompleted`);
        }
        const saved = await this.deps.datePlans.save(tx, plan);
        if (saved.isErr()) {
          throw new Error(`dating.date_plans ${plan.id}: ${saved.error.code} khi cập nhật`);
        }
      }

      return ok(feedback.toState());
    });
  }
}

export interface GetMyFeedbackDeps {
  readonly uow: UnitOfWork;
  readonly datePlans: DatePlanRepository;
  readonly feedbacks: FeedbackRepository;
}

/**
 * `GET /me/dates/:id/feedback` (BE-S7-03): đánh giá **của chính người xem** cho match của lịch; chưa gửi → `null`.
 * Không bao giờ trả đánh giá (hay việc đã gửi hay chưa) của đối phương. Người ngoài cặp → `NOT_PARTICIPANT`.
 */
export class GetMyFeedback {
  constructor(private readonly deps: GetMyFeedbackDeps) {}

  async execute(query: {
    readonly userId: string;
    readonly datePlanId: string;
  }): Promise<Result<FeedbackView | null, DomainError<'INVALID_ID' | 'NOT_FOUND' | 'NOT_PARTICIPANT'>>> {
    const id = parseDatePlanId(query.datePlanId);
    if (id.isErr()) return err(id.error);
    const userId = query.userId.toLowerCase();
    return this.deps.uow.run(
      async (tx): Promise<Result<FeedbackView | null, DomainError<'NOT_FOUND' | 'NOT_PARTICIPANT'>>> => {
        const plan = await this.deps.datePlans.findById(tx, id.value);
        if (plan === null) return fail('NOT_FOUND');
        if (!plan.isParticipant(userId)) return fail('NOT_PARTICIPANT');
        const mine = await this.deps.feedbacks.findByMatchAndAuthor(tx, plan.matchId, userId);
        return ok(mine === null ? null : mine.toState());
      },
    );
  }
}
