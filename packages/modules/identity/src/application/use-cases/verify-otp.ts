import {
  fail,
  ok,
  type BlindIndexer,
  type Clock,
  type DomainError,
  type Result,
  type UnitOfWork,
} from '@tamgiao/kernel';
import { PhoneNumber } from '../../domain/phone-number.js';
import { User } from '../../domain/user.js';
import { PHONE_INDEX_PURPOSE } from '../index-purposes.js';
import type { OtpChallengeRepository } from '../ports/otp-challenge-repository.js';
import type { OtpSecrets } from '../ports/otp-secrets.js';
import type { UserRepository } from '../ports/user-repository.js';

export interface VerifyOtpCommand {
  readonly phone: string;
  readonly code: string;
}

export interface VerifyOtpResult {
  readonly userId: string;
  readonly isNewUser: boolean;
}

export type VerifyOtpError = DomainError<'PHONE_INVALID' | 'OTP_INVALID' | 'OTP_EXPIRED' | 'OTP_LOCKED'>;

export interface VerifyOtpDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly challenges: OtpChallengeRepository;
  readonly users: UserRepository;
  readonly otpSecrets: OtpSecrets;
  readonly blindIndexer: BlindIndexer;
}

/** Xác thực OTP; lần đầu thành công của một SĐT thì tạo `User` (phát `UserRegistered`). */
export class VerifyOtp {
  constructor(private readonly deps: VerifyOtpDeps) {}

  async execute(cmd: VerifyOtpCommand): Promise<Result<VerifyOtpResult, VerifyOtpError>> {
    const parsed = PhoneNumber.parse(cmd.phone);
    if (parsed.isErr()) return fail('PHONE_INVALID');
    const phone = parsed.value;

    const { uow, clock, challenges, users, otpSecrets, blindIndexer } = this.deps;
    const now = clock.now();
    const phoneIndex = blindIndexer.index(phone.e164, PHONE_INDEX_PURPOSE);

    // Lần nhập sai phải được **commit** (đếm số lần sai) nên transaction trả `ok(<kết quả nghiệp vụ>)`
    // thay vì `Err` — UnitOfWork rollback khi nhận `Err`.
    const committed = await uow.run<Result<VerifyOtpResult, VerifyOtpError>, never>(async (tx) => {
      const challenge = await challenges.findByPhoneForUpdate(tx, phoneIndex);
      if (!challenge) return ok(fail('OTP_INVALID'));

      const attempt = challenge.attempt(otpSecrets.matches(cmd.code, challenge.id, challenge.codeHash), now);
      await challenges.save(tx, challenge);
      if (attempt.isErr()) return ok(fail(attempt.error.code, attempt.error.details));

      const existing = await users.findByPhone(tx, phone);
      if (existing) return ok(ok({ userId: existing.id, isNewUser: false }));

      const user = User.register(phone, now);
      await users.save(tx, user);
      return ok(ok({ userId: user.id, isNewUser: true }));
    });
    if (committed.isErr()) throw new Error('unreachable: transaction VerifyOtp không trả Err');
    return committed.value;
  }
}
