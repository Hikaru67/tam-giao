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
import { OtpChallenge } from '../../domain/otp-challenge.js';
import { OTP_REQUEST_LIMITS, OTP_RESEND_AFTER_SECONDS } from '../../domain/otp-policy.js';
import { PhoneNumber } from '../../domain/phone-number.js';
import { IP_INDEX_PURPOSE, PHONE_INDEX_PURPOSE } from '../index-purposes.js';
import type { OtpChallengeRepository } from '../ports/otp-challenge-repository.js';
import type { OtpSecrets } from '../ports/otp-secrets.js';
import type { RateLimiter } from '../ports/rate-limiter.js';
import type { SmsSender } from '../ports/sms-sender.js';

export interface RequestOtpCommand {
  readonly phone: string;
  readonly ip: string;
}

export interface RequestOtpResult {
  readonly expiresInSeconds: number;
  readonly resendAfterSeconds: number;
}

export type RequestOtpError = DomainError<'PHONE_INVALID' | 'RATE_LIMITED'>;

export interface RequestOtpDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly challenges: OtpChallengeRepository;
  readonly rateLimiter: RateLimiter;
  readonly otpSecrets: OtpSecrets;
  readonly sms: SmsSender;
  readonly blindIndexer: BlindIndexer;
}

/** Gửi OTP tới SĐT (đăng nhập và đăng ký dùng chung một luồng — không tiết lộ SĐT đã có tài khoản hay chưa). */
export class RequestOtp {
  constructor(private readonly deps: RequestOtpDeps) {}

  async execute(cmd: RequestOtpCommand): Promise<Result<RequestOtpResult, RequestOtpError>> {
    const phone = PhoneNumber.parse(cmd.phone);
    if (phone.isErr()) return fail('PHONE_INVALID');

    const { uow, clock, challenges, rateLimiter, otpSecrets, sms, blindIndexer } = this.deps;
    const now = clock.now();
    const phoneIndex = blindIndexer.index(phone.value.e164, PHONE_INDEX_PURPOSE);
    // Luôn khoá theo thứ tự SĐT → IP để hai request không chờ chéo nhau.
    const limitKeys = [`otp:phone:${phoneIndex}`, `otp:ip:${blindIndexer.index(cmd.ip, IP_INDEX_PURPOSE)}`];
    const code = otpSecrets.generate();

    const issued = await uow.run<void, RequestOtpError>(async (tx) => {
      for (const key of limitKeys) {
        const decision = await rateLimiter.consume(tx, key, OTP_REQUEST_LIMITS, now);
        if (!decision.allowed) {
          return fail('RATE_LIMITED', { retryAfterSeconds: decision.retryAfterSeconds });
        }
      }
      const id = newId<'OtpChallenge'>();
      await challenges.save(
        tx,
        OtpChallenge.issue({ id, phoneIndex, codeHash: otpSecrets.hash(code, id) }, now),
      );
      return ok();
    });
    if (issued.isErr()) return err(issued.error);

    // Gửi sau khi commit: không giữ transaction trong lúc gọi nhà mạng. Gửi lỗi → throw, người dùng thử lại sau thời gian chờ.
    await sms.send({
      to: phone.value.e164,
      text: `Ma xac thuc Tam Giao: ${code}. Hieu luc ${Math.round(OTP_TTL_SECONDS / 60)} phut. Khong chia se ma nay cho bat ky ai.`,
    });
    return ok({ expiresInSeconds: OTP_TTL_SECONDS, resendAfterSeconds: OTP_RESEND_AFTER_SECONDS });
  }
}
