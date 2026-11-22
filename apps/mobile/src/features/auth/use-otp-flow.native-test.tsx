import { ApiError } from '@tamgiao/api-client';
import { act, renderHook } from '@testing-library/react-native';
import { useResendTimer } from './resend-timer.js';
import { otpErrorView } from './use-otp-flow.js';

describe('otpErrorView', () => {
  it('khoá ô nhập khi gặp OTP_LOCKED', () => {
    const error = new ApiError({
      code: 'OTP_LOCKED',
      status: 429,
      message: 'OTP locked',
      meta: { retryAfterSeconds: 300 },
    });

    const result = otpErrorView(error);
    expect(result.lockInput).toBe(true);
    expect(result.banned).toBe(false);
    expect(result.message).toContain('quá số lần cho phép');
  });

  it('khoá ô nhập khi gặp OTP_INVALID và remainingAttempts = 0', () => {
    const error = new ApiError({
      code: 'OTP_INVALID',
      status: 400,
      message: 'OTP invalid',
      meta: { remainingAttempts: 0 },
    });

    const result = otpErrorView(error);
    expect(result.lockInput).toBe(true);
    expect(result.banned).toBe(false);
  });

  it('không khoá ô nhập khi gặp OTP_INVALID và remainingAttempts > 0', () => {
    const error = new ApiError({
      code: 'OTP_INVALID',
      status: 400,
      message: 'OTP invalid',
      meta: { remainingAttempts: 2 },
    });

    const result = otpErrorView(error);
    expect(result.lockInput).toBe(false);
    expect(result.banned).toBe(false);
    expect(result.message).toContain('Mã xác thực không chính xác');
  });

  it('đánh dấu banned khi gặp ACCOUNT_BANNED', () => {
    const error = new ApiError({
      code: 'ACCOUNT_BANNED',
      status: 403,
      message: 'Banned',
    });

    const result = otpErrorView(error);
    expect(result.banned).toBe(true);
    expect(result.lockInput).toBe(false);
  });

  it('chèn retryAfterSeconds vào action khi gặp RATE_LIMITED', () => {
    const error = new ApiError({
      code: 'RATE_LIMITED',
      status: 429,
      message: 'Too fast',
      meta: { retryAfterSeconds: 60 },
    });

    const result = otpErrorView(error);
    expect(result.action).toContain('60');
  });

  it('trả về thông điệp NETWORK_ERROR cho các lỗi không phải ApiError', () => {
    const error = new Error('Network failed');
    const result = otpErrorView(error);

    expect(result.message).toContain('kết nối');
    expect(result.lockInput).toBe(false);
    expect(result.banned).toBe(false);
  });
});

describe('useResendTimer', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('đếm ngược thời gian và cho phép restart', async () => {
    const { result } = await renderHook(() => useResendTimer(10));

    expect(result.current.secondsLeft).toBeGreaterThanOrEqual(9);
    expect(result.current.canResend).toBe(false);

    await act(async () => {
      jest.advanceTimersByTime(11000);
    });

    expect(result.current.secondsLeft).toBe(0);
    expect(result.current.canResend).toBe(true);

    await act(async () => {
      result.current.restart(5);
    });

    expect(result.current.secondsLeft).toBeGreaterThanOrEqual(4);
    expect(result.current.canResend).toBe(false);
  });
});
