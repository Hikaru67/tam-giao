import { fail, ok, parseId, type DomainError, type Result, type UnitOfWork } from '@tamgiao/kernel';
import type { AuditLogger } from '@tamgiao/module-identity/facade';
import type { AppearanceFlagPage, FeedbackRepository } from './ports/feedback-repository.js';
import type { FeedbackView } from './submit-feedback.js';

export const APPEARANCE_FLAG_PAGE_DEFAULT = 20;
export const APPEARANCE_FLAG_PAGE_MAX = 100;

/** `target_type` / action audit của module dating (BE-S7-03). */
export const DATING_AUDIT_TARGET_FEEDBACK = 'dating_feedback';
export const DATING_AUDIT_ACTION_VIEW_FEEDBACK = 'dating.feedback.view_detail';

/** Admin đang thao tác (từ guard `requireAdmin`). */
export interface DatingAdminActor {
  readonly adminId: string;
  /** IP client; `null` = không rõ. */
  readonly ip: string | null;
}

/**
 * Hàng chờ cờ "Có khác biệt so với eKYC" (BE-S7-03): đánh giá có `profileMatch = DIFFERENT`, mới nhất trước. Danh sách
 * chỉ có id + mốc thời gian, không nội dung đánh giá → không ghi audit (xem chi tiết mới ghi, như hàng chờ safety).
 */
export class ListAppearanceFlags {
  constructor(private readonly deps: { readonly uow: UnitOfWork; readonly feedbacks: FeedbackRepository }) {}

  async execute(query: {
    readonly limit?: number;
    readonly offset?: number;
  }): Promise<Result<AppearanceFlagPage, never>> {
    const limit = Math.min(Math.max(query.limit ?? APPEARANCE_FLAG_PAGE_DEFAULT, 1), APPEARANCE_FLAG_PAGE_MAX);
    const offset = Math.max(query.offset ?? 0, 0);
    return this.deps.uow.run(async (tx) => ok(await this.deps.feedbacks.listAppearanceFlags(tx, { limit, offset })));
  }
}

/**
 * Chuyên viên xem toàn bộ một đánh giá kín (kể cả lý do dừng) — `GET /admin/dating/feedbacks/:id`. Ghi audit
 * `dating.feedback.view_detail` **cùng transaction** trước khi trả dữ liệu; audit bị từ chối → throw (không trả dữ liệu
 * khi không ghi được vết, AGENTS.md mục 5). Meta chỉ id, không nội dung.
 */
export class GetFeedbackDetail {
  constructor(
    private readonly deps: {
      readonly uow: UnitOfWork;
      readonly feedbacks: FeedbackRepository;
      readonly auditLogger: AuditLogger;
    },
  ) {}

  async execute(query: {
    readonly feedbackId: string;
    readonly actor: DatingAdminActor;
  }): Promise<Result<FeedbackView, DomainError<'INVALID_ID' | 'FEEDBACK_NOT_FOUND'>>> {
    const id = parseId<'DateFeedback'>(query.feedbackId);
    if (id.isErr()) return fail('INVALID_ID', { field: 'feedbackId' });
    return this.deps.uow.run(async (tx): Promise<Result<FeedbackView, DomainError<'FEEDBACK_NOT_FOUND'>>> => {
      const feedback = await this.deps.feedbacks.findById(tx, id.value);
      if (feedback === null) return fail('FEEDBACK_NOT_FOUND');
      const state = feedback.toState();
      const audited = await this.deps.auditLogger.log(tx, {
        actor: { type: 'admin', id: query.actor.adminId },
        action: DATING_AUDIT_ACTION_VIEW_FEEDBACK,
        targetType: DATING_AUDIT_TARGET_FEEDBACK,
        targetId: state.id,
        ip: query.actor.ip,
        meta: { matchId: state.matchId, authorId: state.authorId, subjectId: state.subjectId },
      });
      if (audited.isErr()) {
        throw new Error(`audit log ${DATING_AUDIT_ACTION_VIEW_FEEDBACK} rejected: ${audited.error.code}`);
      }
      return ok(state);
    });
  }
}
