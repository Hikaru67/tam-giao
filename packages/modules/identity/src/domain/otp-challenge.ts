import { OTP_MAX_ATTEMPTS, OTP_TTL_SECONDS } from '@tamgiao/contracts/constants';
import { Entity, addDuration, fail, ok, type DomainError, type Id, type Result } from '@tamgiao/kernel';

export type OtpChallengeId = Id<'OtpChallenge'>;

export type OtpAttemptError = DomainError<'OTP_INVALID' | 'OTP_EXPIRED' | 'OTP_LOCKED'>;

export interface OtpChallengeState {
  readonly id: OtpChallengeId;
  /** Blind index của SĐT — challenge không giữ SĐT thô. */
  readonly phoneIndex: string;
  readonly codeHash: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly failedAttempts: number;
  readonly consumedAt: Date | null;
}

/**
 * Một lần thử thách OTP cho một SĐT. Mỗi SĐT chỉ có một challenge hiệu lực (yêu cầu mới thay thế cái cũ).
 * Chỉ giữ hash của mã; việc so khớp mã do application làm qua port `OtpSecrets` rồi báo kết quả vào `attempt`.
 */
export class OtpChallenge extends Entity<OtpChallengeId> {
  private constructor(private state: OtpChallengeState) {
    super(state.id);
  }

  static issue(input: Pick<OtpChallengeState, 'id' | 'phoneIndex' | 'codeHash'>, now: Date): OtpChallenge {
    return new OtpChallenge({
      ...input,
      createdAt: now,
      expiresAt: addDuration(now, { seconds: OTP_TTL_SECONDS }),
      failedAttempts: 0,
      consumedAt: null,
    });
  }

  static restore(state: OtpChallengeState): OtpChallenge {
    return new OtpChallenge(state);
  }

  get codeHash(): string {
    return this.state.codeHash;
  }

  get isLocked(): boolean {
    return this.state.failedAttempts >= OTP_MAX_ATTEMPTS;
  }

  /**
   * Ghi nhận một lần nhập mã. Thứ tự kiểm tra: đã dùng → khoá → hết hạn → đúng/sai.
   * Lần sai thứ `OTP_MAX_ATTEMPTS` khoá challenge; sau đó kể cả mã đúng cũng bị từ chối.
   * Lưu ý cho use case: kết quả `Err` vẫn làm thay đổi state (đếm lần sai) → vẫn phải lưu challenge.
   */
  attempt(codeMatches: boolean, now: Date): Result<void, OtpAttemptError> {
    if (this.state.consumedAt !== null) return fail('OTP_INVALID');
    if (this.isLocked) return fail('OTP_LOCKED');
    if (now.getTime() >= this.state.expiresAt.getTime()) return fail('OTP_EXPIRED');

    if (!codeMatches) {
      this.state = { ...this.state, failedAttempts: this.state.failedAttempts + 1 };
      if (this.isLocked) return fail('OTP_LOCKED');
      return fail('OTP_INVALID', { remainingAttempts: OTP_MAX_ATTEMPTS - this.state.failedAttempts });
    }

    this.state = { ...this.state, consumedAt: now };
    return ok();
  }

  toState(): OtpChallengeState {
    return this.state;
  }
}
