import type { Result } from '@tamgiao/kernel';
import {
  EkycProviderError,
  type EkycImageRef,
  type EkycOperation,
  type EkycProvider,
  type EkycRejection,
  type FaceMatchResult,
  type IdCardOcrResult,
  type LivenessResult,
} from '../../application/ports/ekyc-provider.js';

/**
 * Chờ `ms` mili-giây; phải resolve sớm (không treo timer) khi `signal` bị abort.
 * Inject được để test timeout/retry không phải chờ thời gian thật.
 */
export type Delay = (ms: number, signal: AbortSignal) => Promise<void>;

export const setTimeoutDelay: Delay = (ms, signal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });

export interface ResilientEkycOptions {
  /** Thời gian chờ tối đa cho **mỗi** lần gọi (ms). */
  readonly timeoutMs: number;
  /** Tổng số lần gọi tối đa (lần đầu + retry), ≥ 1. */
  readonly maxAttempts: number;
  /** Chờ trước retry thứ n = `backoffMs * n` (ms). Mặc định 0. */
  readonly backoffMs?: number;
}

/**
 * Decorator bọc một `EkycProvider` bất kỳ: timeout từng lần gọi + retry lỗi hạ tầng tạm thời.
 * - Chỉ retry `EkycProviderError` có `retryable` (`TIMEOUT`, `UNAVAILABLE`). Từ chối nghiệp vụ (`Err`) không retry.
 * - Lỗi lạ (không phải `EkycProviderError`) được bọc thành `UNEXPECTED`, không retry — để use case luôn chỉ
 *   phải bắt một loại lỗi và chuyển hồ sơ sang duyệt tay.
 * - Hết lượt → throw `EkycProviderError` của lần cuối, kèm `attempts`.
 * Thông số timeout/retry là cấu hình hạ tầng (không phải hằng số nghiệp vụ), truyền từ composition root.
 */
export class ResilientEkycProvider implements EkycProvider {
  private readonly backoffMs: number;

  constructor(
    private readonly inner: EkycProvider,
    private readonly options: ResilientEkycOptions,
    private readonly delay: Delay = setTimeoutDelay,
  ) {
    if (!Number.isInteger(options.maxAttempts) || options.maxAttempts < 1) {
      throw new Error('ResilientEkycProvider: maxAttempts phải là số nguyên ≥ 1');
    }
    if (!(options.timeoutMs > 0)) {
      throw new Error('ResilientEkycProvider: timeoutMs phải > 0');
    }
    this.backoffMs = options.backoffMs ?? 0;
  }

  ocrIdCard(front: EkycImageRef, back: EkycImageRef): Promise<Result<IdCardOcrResult, EkycRejection>> {
    return this.call('ocrIdCard', () => this.inner.ocrIdCard(front, back));
  }

  checkLiveness(selfie: EkycImageRef): Promise<Result<LivenessResult, EkycRejection>> {
    return this.call('checkLiveness', () => this.inner.checkLiveness(selfie));
  }

  matchFace(idPortrait: EkycImageRef, selfie: EkycImageRef): Promise<Result<FaceMatchResult, EkycRejection>> {
    return this.call('matchFace', () => this.inner.matchFace(idPortrait, selfie));
  }

  private async call<T>(operation: EkycOperation, fn: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.withTimeout(operation, fn);
      } catch (e) {
        const error = classify(e, operation);
        if (!error.retryable || attempt >= this.options.maxAttempts) {
          throw new EkycProviderError(error.kind, operation, { cause: error.cause ?? e, attempts: attempt });
        }
        if (this.backoffMs > 0) await this.delay(this.backoffMs * attempt, new AbortController().signal);
      }
    }
  }

  private async withTimeout<T>(operation: EkycOperation, fn: () => Promise<T>): Promise<T> {
    const timer = new AbortController();
    const pending = Promise.resolve().then(fn);
    // Lời gọi bị bỏ rơi sau timeout có thể reject muộn → nuốt để không thành unhandled rejection.
    pending.catch(() => undefined);
    const timeout = this.delay(this.options.timeoutMs, timer.signal).then(() => {
      throw new EkycProviderError('TIMEOUT', operation);
    });
    timeout.catch(() => undefined);
    try {
      return await Promise.race([pending, timeout]);
    } finally {
      timer.abort();
    }
  }
}

function classify(e: unknown, operation: EkycOperation): EkycProviderError {
  if (e instanceof EkycProviderError) return e;
  return new EkycProviderError('UNEXPECTED', operation, { cause: e });
}
