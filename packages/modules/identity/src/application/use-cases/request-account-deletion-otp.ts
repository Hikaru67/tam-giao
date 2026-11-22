import { OTP_TTL_SECONDS } from '@tamgiao/contracts/constants';
import {
  err,
  fail,
  newId,
  ok,
  type BlindIndexer,
  type Clock,
  type DomainError,
  type Result,
  type UnitOfWork,
} from '@tamgiao/kernel';
import { accountDeletionChallengeKey } from '../../domain/account-deletion.js';
import { OtpChallenge } from '../../domain/otp-challenge.js';
import { OTP_REQUEST_LIMITS, OTP_RESEND_AFTER_SECONDS } from '../../domain/otp-policy.js';
import type { PhoneNumber } from '../../domain/phone-number.js';
import type { UserId } from '../../domain/user.js';
import { IP_INDEX_PURPOSE, PHONE_INDEX_PURPOSE } from '../index-purposes.js';
import type { OtpChallengeRepository } from '../ports/otp-challenge-repository.js';
import type { OtpSecrets } from '../ports/otp-secrets.js';
import type { RateLimiter } from '../ports/rate-limiter.js';
import type { SmsSender } from '../ports/sms-sender.js';
import type { UserRepository } from '../ports/user-repository.js';

export interface RequestAccountDeletionOtpCommand {
  readonly userId: string;
  readonly ip: string;
}

export interface RequestAccountDeletionOtpResult {
  readonly expiresInSeconds: number;
  readonly resendAfterSeconds: number;
}

export type RequestAccountDeletionOtpError = DomainError<'UNAUTHENTICATED' | 'RATE_LIMITED'>;

export interface RequestAccountDeletionOtpDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly users: UserRepository;
  readonly challenges: OtpChallengeRepository;
  readonly rateLimiter: RateLimiter;
  readonly otpSecrets: OtpSecrets;
  readonly sms: SmsSender;
  readonly blindIndexer: BlindIndexer;
}

/**
 * Bước 1 của xoá tài khoản (BE-S7-06): gửi OTP xác nhận tới SĐT của chính tài khoản đang đăng nhập. Challenge riêng
 * (`accountDeletionChallengeKey`) — mã đăng nhập không dùng để xoá được. Dùng chung hạn mức gửi OTP với đăng nhập
 * (theo SĐT + IP) để không thành kênh spam SMS.
 */
export class RequestAccountDeletionOtp {
  constructor(private readonly deps: RequestAccountDeletionOtpDeps) {}

  async execute(
    cmd: RequestAccountDeletionOtpCommand,
  ): Promise<Result<RequestAccountDeletionOtpResult, RequestAccountDeletionOtpError>> {
    const { uow, clock, users, challenges, rateLimiter, otpSecrets, sms, blindIndexer } = this.deps;
    const now = clock.now();
    const code = otpSecrets.generate();

    const issued = await uow.run<PhoneNumber, RequestAccountDeletionOtpError>(async (tx) => {
      const user = await users.findActiveById(tx, cmd.userId as UserId);
      if (!user) return fail('UNAUTHENTICATED');
      const phoneIndex = blindIndexer.index(user.phone.e164, PHONE_INDEX_PURPOSE);
      const limitKeys = [`otp:phone:${phoneIndex}`, `otp:ip:${blindIndexer.index(cmd.ip, IP_INDEX_PURPOSE)}`];
      for (const key of limitKeys) {
        const decision = await rateLimiter.consume(tx, key, OTP_REQUEST_LIMITS, now);
        if (!decision.allowed) {
          return fail('RATE_LIMITED', { retryAfterSeconds: decision.retryAfterSeconds });
        }
      }
      const id = newId<'OtpChallenge'>();
      await challenges.save(
        tx,
        OtpChallenge.issue(
          { id, phoneIndex: accountDeletionChallengeKey(user.id), codeHash: otpSecrets.hash(code, id) },
          now,
        ),
      );
      return ok(user.phone);
    });
    if (issued.isErr()) return err(issued.error);

    await sms.send({
      to: issued.value.e164,
      text: `Ma xac nhan XOA TAI KHOAN Tam Giao: ${code}. Hieu luc ${Math.round(OTP_TTL_SECONDS / 60)} phut. Neu khong phai ban yeu cau, hay bo qua tin nhan nay.`,
    });
    return ok({ expiresInSeconds: OTP_TTL_SECONDS, resendAfterSeconds: OTP_RESEND_AFTER_SECONDS });
  }
}
