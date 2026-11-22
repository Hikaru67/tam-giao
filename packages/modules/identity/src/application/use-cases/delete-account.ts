import { fail, ok, type Clock, type DomainError, type Result, type UnitOfWork } from '@tamgiao/kernel';
import { AccountDeletion, accountDeletionChallengeKey } from '../../domain/account-deletion.js';
import type { UserId } from '../../domain/user.js';
import type { AuditLogger } from '../facade.js';
import type { AccountDeletionRepository, AccountDeletionStep, DataExportRepository } from '../ports/data-rights.js';
import type { OtpChallengeRepository } from '../ports/otp-challenge-repository.js';
import type { OtpSecrets } from '../ports/otp-secrets.js';
import type { SessionRepository } from '../ports/session-repository.js';
import type { UserRepository } from '../ports/user-repository.js';
import type { AccountDeletionView } from '../queries/get-account-deletion-status.js';

export interface DeleteAccountCommand {
  readonly userId: string;
  readonly code: string;
  readonly ip?: string | null;
}

export type DeleteAccountError = DomainError<'OTP_INVALID' | 'OTP_EXPIRED' | 'OTP_LOCKED' | 'UNAUTHENTICATED'>;

export interface DeleteAccountDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly users: UserRepository;
  readonly challenges: OtpChallengeRepository;
  readonly otpSecrets: OtpSecrets;
  readonly sessions: SessionRepository;
  readonly deletions: AccountDeletionRepository;
  readonly dataExports: DataExportRepository;
  readonly auditLogger: AuditLogger;
  /** Các module tự xoá dữ liệu (để trả tiến độ ban đầu). */
  readonly steps: readonly AccountDeletionStep[];
}

/**
 * Bước 2 của xoá tài khoản (BE-S7-06): xác nhận OTP rồi, **một transaction**:
 * 1. ghi yêu cầu `identity.account_deletions` (mỗi người một yêu cầu — unique `user_id`) + `AccountDeletionRequested`
 *    vào outbox → mỗi module tự ẩn danh/xoá dữ liệu của mình (matching đóng match đang mở, messaging xoá nội dung tin,
 *    billing giữ ledger…);
 * 2. ẩn danh tài khoản identity: xoá SĐT mã hoá + blind index (SĐT đăng ký lại = tài khoản mới);
 * 3. thu hồi mọi phiên (`ACCOUNT_DELETED`) — access/refresh token hết hiệu lực ngay;
 * 4. xoá các file xuất dữ liệu của người dùng;
 * 5. audit `identity.account.delete` (actor = chính người dùng, meta không PII). Audit log giữ nguyên (chỉ ghi thêm).
 * Lần nhập sai OTP vẫn được commit (đếm số lần sai) như `VerifyOtp`.
 */
export class DeleteAccount {
  constructor(private readonly deps: DeleteAccountDeps) {}

  async execute(cmd: DeleteAccountCommand): Promise<Result<AccountDeletionView, DeleteAccountError>> {
    const { uow, clock, users, challenges, otpSecrets, sessions, deletions, dataExports } = this.deps;
    const now = clock.now();
    const userId = cmd.userId as UserId;

    const committed = await uow.run<Result<AccountDeletionView, DeleteAccountError>, never>(async (tx) => {
      const challenge = await challenges.findByPhoneForUpdate(tx, accountDeletionChallengeKey(userId));
      if (!challenge) return ok(fail('OTP_INVALID'));
      const attempt = challenge.attempt(otpSecrets.matches(cmd.code, challenge.id, challenge.codeHash), now);
      await challenges.save(tx, challenge);
      if (attempt.isErr()) return ok(fail(attempt.error.code, attempt.error.details));

      const user = await users.findActiveById(tx, userId);
      if (!user) return ok(fail('UNAUTHENTICATED'));

      const deletion = AccountDeletion.request(userId, now);
      await deletions.insert(tx, deletion);
      await users.anonymize(tx, userId, now);
      for (const session of await sessions.listActiveByUser(tx, userId)) {
        session.revoke('ACCOUNT_DELETED', now);
        await sessions.save(tx, session);
      }
      await dataExports.deleteByUser(tx, userId);
      const audited = await this.deps.auditLogger.log(tx, {
        actor: { type: 'user', id: userId },
        action: 'identity.account_delete',
        targetType: 'user',
        targetId: userId,
        ip: cmd.ip ?? null,
        meta: { requestId: deletion.id },
      });
      if (audited.isErr()) throw new Error(`audit identity.account_delete bị từ chối: ${audited.error.code}`);

      return ok(
        ok({
          requestId: deletion.id,
          status: 'PROCESSING' as const,
          requestedAt: now,
          steps: this.deps.steps.map((s) => ({ module: s.module, done: false })),
        }),
      );
    });
    if (committed.isErr()) throw new Error('unreachable: transaction DeleteAccount không trả Err');
    return committed.value;
  }
}
