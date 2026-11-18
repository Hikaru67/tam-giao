import { OTP_MAX_ATTEMPTS, OTP_TTL_SECONDS } from '@tamgiao/contracts/constants';
import { addDuration, newId } from '@tamgiao/kernel';
import { describe, expect, it } from 'vitest';
import { OtpChallenge } from '../domain/otp-challenge.js';

const T0 = new Date('2026-11-16T08:00:00.000Z');
const at = (seconds: number) => addDuration(T0, { seconds });
const issue = () =>
  OtpChallenge.issue({ id: newId<'OtpChallenge'>(), phoneIndex: 'idx', codeHash: 'hash' }, T0);
const code = (r: ReturnType<OtpChallenge['attempt']>) => (r.isErr() ? r.error.code : 'OK');

describe('OtpChallenge', () => {
  it('hết hạn sau đúng OTP_TTL_SECONDS', () => {
    expect(issue().toState().expiresAt).toEqual(at(OTP_TTL_SECONDS));
  });

  it('mã đúng trong TTL → thành công và bị vô hiệu sau khi dùng (AC1)', () => {
    const challenge = issue();
    expect(code(challenge.attempt(true, at(OTP_TTL_SECONDS - 1)))).toBe('OK');
    expect(challenge.toState().consumedAt).toEqual(at(OTP_TTL_SECONDS - 1));
    expect(code(challenge.attempt(true, at(OTP_TTL_SECONDS - 1)))).toBe('OTP_INVALID');
  });

  it('đúng tại/ sau thời điểm hết hạn → OTP_EXPIRED, không tính là lần sai (AC2)', () => {
    const challenge = issue();
    expect(code(challenge.attempt(true, at(OTP_TTL_SECONDS)))).toBe('OTP_EXPIRED');
    expect(code(challenge.attempt(false, at(OTP_TTL_SECONDS + 60)))).toBe('OTP_EXPIRED');
    expect(challenge.toState().failedAttempts).toBe(0);
  });

  it('mã sai → OTP_INVALID kèm số lần còn lại; lần sai thứ OTP_MAX_ATTEMPTS → OTP_LOCKED (AC2)', () => {
    const challenge = issue();
    for (let i = 1; i < OTP_MAX_ATTEMPTS; i++) {
      const result = challenge.attempt(false, at(i));
      expect(result.isErr() && result.error).toEqual({
        code: 'OTP_INVALID',
        details: { remainingAttempts: OTP_MAX_ATTEMPTS - i },
      });
    }
    expect(code(challenge.attempt(false, at(10)))).toBe('OTP_LOCKED');
    expect(challenge.isLocked).toBe(true);
  });

  it('đã khoá → mã đúng cũng bị từ chối, kể cả sau khi hết hạn vẫn báo OTP_LOCKED', () => {
    const challenge = issue();
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) challenge.attempt(false, at(i));
    expect(code(challenge.attempt(true, at(20)))).toBe('OTP_LOCKED');
    expect(code(challenge.attempt(true, at(OTP_TTL_SECONDS + 1)))).toBe('OTP_LOCKED');
    expect(challenge.toState().failedAttempts).toBe(OTP_MAX_ATTEMPTS);
    expect(challenge.toState().consumedAt).toBeNull();
  });

  it('sai vài lần rồi đúng (chưa tới giới hạn) → thành công', () => {
    const challenge = issue();
    challenge.attempt(false, at(1));
    challenge.attempt(false, at(2));
    expect(code(challenge.attempt(true, at(3)))).toBe('OK');
  });

  it('restore giữ nguyên state', () => {
    const challenge = issue();
    challenge.attempt(false, at(1));
    const restored = OtpChallenge.restore(challenge.toState());
    expect(restored.toState()).toEqual(challenge.toState());
    expect(restored.equals(challenge)).toBe(true);
  });
});
