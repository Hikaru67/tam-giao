import {
  err,
  fail,
  newId,
  ok,
  parseId,
  type Clock,
  type DomainError,
  type Id,
  type Result,
  type UnitOfWork,
} from '@tamgiao/kernel';
import type { AuditLogger } from '@tamgiao/module-identity/facade';
import { UserBan, type UserBanError } from '../../domain/user-ban.js';
import type { ReportRepository } from '../ports/report-repository.js';
import type { UserBanRepository } from '../ports/user-ban-repository.js';
import {
  SAFETY_AUDIT_ACTION,
  SAFETY_AUDIT_TARGET,
  auditModeration,
  type ModerationActor,
} from './moderation-audit.js';

export interface BanUserDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly bans: UserBanRepository;
  readonly reports: ReportRepository;
  readonly auditLogger: AuditLogger;
}

export interface BanUserCommand {
  readonly userId: string;
  /** Lý do bắt buộc — văn bản tự do (PII), chỉ lưu ở `safety.user_bans`, không log/event/audit. */
  readonly reason: string;
  /** Báo cáo dẫn tới quyết định (tuỳ chọn) — phải là báo cáo về chính người này. */
  readonly reportId?: string | null;
  readonly actor: ModerationActor;
}

export interface UserBanView {
  readonly banId: string;
  readonly userId: string;
  readonly reportId: string | null;
  readonly bannedBy: string;
  readonly bannedAt: Date;
}

export type BanUserError =
  UserBanError | DomainError<'USER_ALREADY_BANNED' | 'REPORT_NOT_FOUND' | 'VALIDATION_FAILED'>;

/**
 * Khoá vĩnh viễn một người dùng (BE-S6-06, permission `safety:ban`). Thứ tự:
 * 1. `userId` sai dạng → `VALIDATION_FAILED`; domain `UserBan.ban` (lý do rỗng / quá dài → `BAN_REASON_INVALID`).
 * 2. **Một transaction**: có `reportId` → báo cáo phải tồn tại và về đúng người này, ngược lại `REPORT_NOT_FOUND`;
 *    `bans.insert` (PK `user_id`, A10) — đã bị khoá → `USER_ALREADY_BANNED`; `UserBanned` vào outbox cùng `tx` (A6);
 *    audit `safety.user.ban` (`meta`: `banId`, `reportId` — không kèm lý do).
 * Hiệu ứng ở module khác chạy bất đồng bộ qua consumer `UserBanned`: identity thu hồi phiên + chặn đăng nhập, matching
 * loại khỏi ứng viên + khoá match đang mở (messaging đóng hội thoại qua `MatchLocked`).
 */
export class BanUser {
  constructor(private readonly deps: BanUserDeps) {}

  async execute(cmd: BanUserCommand): Promise<Result<UserBanView, BanUserError>> {
    const userId = parseId(cmd.userId);
    if (userId.isErr()) return fail('VALIDATION_FAILED', { field: 'userId' });
    let reportId: Id<'Report'> | null = null;
    if (cmd.reportId !== undefined && cmd.reportId !== null) {
      const parsed = parseId<'Report'>(cmd.reportId);
      if (parsed.isErr()) return fail('REPORT_NOT_FOUND');
      reportId = parsed.value;
    }

    const banned = UserBan.ban(
      {
        id: newId<'UserBan'>(),
        userId: userId.value,
        reason: cmd.reason,
        reportId,
        bannedBy: cmd.actor.adminId,
      },
      this.deps.clock.now(),
    );
    if (banned.isErr()) return err(banned.error);
    const ban = banned.value;

    return this.deps.uow.run(async (tx): Promise<Result<UserBanView, BanUserError>> => {
      if (reportId !== null) {
        const report = await this.deps.reports.findById(tx, reportId);
        if (report === null || report.toState().reportedUserId.toLowerCase() !== userId.value.toLowerCase()) {
          return fail('REPORT_NOT_FOUND');
        }
      }
      if (!(await this.deps.bans.insert(tx, ban))) return fail('USER_ALREADY_BANNED');
      const s = ban.toState();
      await auditModeration(this.deps.auditLogger, tx, cmd.actor, {
        action: SAFETY_AUDIT_ACTION.banUser,
        targetType: SAFETY_AUDIT_TARGET.user,
        targetId: s.userId,
        meta: { banId: s.id, reportId: s.reportId },
      });
      return ok({
        banId: s.id,
        userId: s.userId,
        reportId: s.reportId,
        bannedBy: s.bannedBy,
        bannedAt: s.bannedAt,
      });
    });
  }
}
