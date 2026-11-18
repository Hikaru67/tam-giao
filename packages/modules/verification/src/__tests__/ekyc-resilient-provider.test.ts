import { ok, type Result } from '@tamgiao/kernel';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EkycProviderError,
  type EkycProvider,
  type EkycRejection,
  type FaceMatchResult,
  type IdCardOcrResult,
  type LivenessResult,
} from '../application/ports/ekyc-provider.js';
import { FAKE_EKYC_ID_CARD, FakeEkycProvider } from '../infrastructure/ekyc/fake-ekyc-provider.js';
import {
  ResilientEkycProvider,
  setTimeoutDelay,
  type Delay,
} from '../infrastructure/ekyc/resilient-ekyc-provider.js';

const front = { key: 'kyc/u1/front.jpg' };
const back = { key: 'kyc/u1/back.jpg' };
const selfie = { key: 'kyc/u1/selfie.jpg' };
const TIMEOUT_MS = 10_000;

/** Delay điều khiển tay: không có thời gian thật trôi qua; test quyết định khi nào "hết giờ". */
class ManualDelay {
  readonly requested: number[] = [];
  private pending: Array<{ ms: number; resolve: () => void }> = [];

  /** `autoResolve(ms)` = true → resolve ngay (vd các khoảng backoff). */
  constructor(private readonly autoResolve: (ms: number) => boolean = () => false) {}

  readonly delay: Delay = (ms, signal) =>
    new Promise<void>((resolve) => {
      this.requested.push(ms);
      if (signal.aborted || this.autoResolve(ms)) return resolve();
      const entry = { ms, resolve };
      this.pending.push(entry);
      signal.addEventListener(
        'abort',
        () => {
          this.pending = this.pending.filter((p) => p !== entry);
          resolve();
        },
        { once: true },
      );
    });

  get pendingCount(): number {
    return this.pending.length;
  }

  /** Cho mọi delay đang chờ hết giờ. */
  elapse(): void {
    const due = this.pending;
    this.pending = [];
    for (const p of due) p.resolve();
  }
}

const flush = (): Promise<void> => new Promise((r) => setImmediate(r));

type Step = 'hang' | 'ok' | Error;

/** Provider kịch bản theo từng lần gọi: treo (không bao giờ trả lời), trả OK, hoặc throw. */
class ScriptedProvider implements EkycProvider {
  calls = 0;
  constructor(private readonly steps: readonly Step[]) {}

  private next<T>(value: T): Promise<Result<T, EkycRejection>> {
    const step = this.steps[Math.min(this.calls, this.steps.length - 1)] ?? 'ok';
    this.calls++;
    if (step === 'hang') return new Promise(() => undefined);
    if (step instanceof Error) return Promise.reject(step);
    return Promise.resolve(ok(value));
  }

  ocrIdCard(): Promise<Result<IdCardOcrResult, EkycRejection>> {
    return this.next({ ...FAKE_EKYC_ID_CARD });
  }
  checkLiveness(): Promise<Result<LivenessResult, EkycRejection>> {
    return this.next({ score: 0.99 });
  }
  matchFace(): Promise<Result<FaceMatchResult, EkycRejection>> {
    return this.next({ score: 0.97 });
  }
}

describe('ResilientEkycProvider timeout', () => {
  it('turns a hanging provider call into EkycProviderError TIMEOUT without waiting real time', async () => {
    const clock = new ManualDelay();
    const inner = new ScriptedProvider(['hang']);
    const provider = new ResilientEkycProvider(inner, { timeoutMs: TIMEOUT_MS, maxAttempts: 1 }, clock.delay);

    const call = provider.ocrIdCard(front, back).catch((e: unknown) => e);
    await flush();
    expect(clock.requested).toEqual([TIMEOUT_MS]);
    clock.elapse();

    const error = await call;
    expect(error).toBeInstanceOf(EkycProviderError);
    expect(error).toMatchObject({ kind: 'TIMEOUT', operation: 'ocrIdCard', attempts: 1, retryable: true });
    expect(inner.calls).toBe(1);
  });

  it('retries after a timeout and returns the later success', async () => {
    const clock = new ManualDelay();
    const inner = new ScriptedProvider(['hang', 'ok']);
    const provider = new ResilientEkycProvider(inner, { timeoutMs: TIMEOUT_MS, maxAttempts: 2 }, clock.delay);

    const call = provider.checkLiveness(selfie);
    await flush();
    clock.elapse();

    const result = await call;
    expect(result.ok && result.value).toEqual({ score: 0.99 });
    expect(inner.calls).toBe(2);
  });

  it('gives up after maxAttempts timeouts with attempts recorded', async () => {
    const clock = new ManualDelay();
    const inner = new ScriptedProvider(['hang']);
    const provider = new ResilientEkycProvider(inner, { timeoutMs: TIMEOUT_MS, maxAttempts: 3 }, clock.delay);

    const call = provider.matchFace(front, selfie).catch((e: unknown) => e);
    for (let i = 0; i < 3; i++) {
      await flush();
      clock.elapse();
    }

    expect(await call).toMatchObject({ name: 'EkycProviderError', kind: 'TIMEOUT', attempts: 3 });
    expect(inner.calls).toBe(3);
  });

  it('cancels the timeout timer when the provider answers in time', async () => {
    const clock = new ManualDelay();
    const provider = new ResilientEkycProvider(
      new ScriptedProvider(['ok']),
      { timeoutMs: TIMEOUT_MS, maxAttempts: 1 },
      clock.delay,
    );

    const result = await provider.ocrIdCard(front, back);
    expect(result.ok).toBe(true);
    expect(clock.pendingCount).toBe(0);
  });
});

describe('ResilientEkycProvider retry policy', () => {
  it('retries UNAVAILABLE up to maxAttempts and then throws the classified error', async () => {
    const inner = new FakeEkycProvider({ scenario: 'UNAVAILABLE' });
    const provider = new ResilientEkycProvider(
      inner,
      { timeoutMs: TIMEOUT_MS, maxAttempts: 3 },
      new ManualDelay().delay,
    );

    await expect(provider.ocrIdCard(front, back)).rejects.toMatchObject({
      kind: 'UNAVAILABLE',
      operation: 'ocrIdCard',
      attempts: 3,
    });
    expect(inner.calls).toHaveLength(3);
  });

  it('recovers when a transient UNAVAILABLE is followed by success', async () => {
    const inner = new ScriptedProvider([new EkycProviderError('UNAVAILABLE', 'matchFace'), 'ok']);
    const provider = new ResilientEkycProvider(
      inner,
      { timeoutMs: TIMEOUT_MS, maxAttempts: 2 },
      new ManualDelay().delay,
    );

    const result = await provider.matchFace(front, selfie);
    expect(result.ok && result.value).toEqual({ score: 0.97 });
    expect(inner.calls).toBe(2);
  });

  it('waits a linear backoff between retries', async () => {
    const clock = new ManualDelay((ms) => ms !== TIMEOUT_MS);
    const inner = new FakeEkycProvider({ scenario: 'UNAVAILABLE' });
    const provider = new ResilientEkycProvider(
      inner,
      { timeoutMs: TIMEOUT_MS, maxAttempts: 3, backoffMs: 100 },
      clock.delay,
    );

    await expect(provider.checkLiveness(selfie)).rejects.toMatchObject({ kind: 'UNAVAILABLE', attempts: 3 });
    expect(clock.requested.filter((ms) => ms !== TIMEOUT_MS)).toEqual([100, 200]);
  });

  it('does not retry business rejections (they are results, not errors)', async () => {
    const inner = new FakeEkycProvider({ scenario: 'BLURRY' });
    const provider = new ResilientEkycProvider(
      inner,
      { timeoutMs: TIMEOUT_MS, maxAttempts: 3 },
      new ManualDelay().delay,
    );

    const result = await provider.ocrIdCard(front, back);
    expect(!result.ok && result.error).toEqual({ kind: 'IMAGE_BLURRY' });
    expect(inner.calls).toHaveLength(1);
  });

  it('does not retry non-transient BAD_RESPONSE', async () => {
    const inner = new ScriptedProvider([new EkycProviderError('BAD_RESPONSE', 'ocrIdCard'), 'ok']);
    const provider = new ResilientEkycProvider(
      inner,
      { timeoutMs: TIMEOUT_MS, maxAttempts: 3 },
      new ManualDelay().delay,
    );

    await expect(provider.ocrIdCard(front, back)).rejects.toMatchObject({
      kind: 'BAD_RESPONSE',
      attempts: 1,
      retryable: false,
    });
    expect(inner.calls).toBe(1);
  });

  it('wraps unknown errors as UNEXPECTED (no retry) keeping the cause', async () => {
    const boom = new TypeError('adapter bug');
    const inner = new ScriptedProvider([boom, 'ok']);
    const provider = new ResilientEkycProvider(
      inner,
      { timeoutMs: TIMEOUT_MS, maxAttempts: 3 },
      new ManualDelay().delay,
    );

    const error = await provider.checkLiveness(selfie).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EkycProviderError);
    expect(error).toMatchObject({ kind: 'UNEXPECTED', attempts: 1 });
    expect((error as EkycProviderError).cause).toBe(boom);
    expect(inner.calls).toBe(1);
  });

  it('rejects invalid configuration', () => {
    const inner = new FakeEkycProvider();
    expect(() => new ResilientEkycProvider(inner, { timeoutMs: 1_000, maxAttempts: 0 })).toThrow();
    expect(() => new ResilientEkycProvider(inner, { timeoutMs: 0, maxAttempts: 1 })).toThrow();
  });
});

/**
 * AC2: lỗi hạ tầng luôn là `EkycProviderError` có phân loại → use case (BE-S3-03) bắt được bằng một
 * `instanceof` duy nhất và vẫn chuyển hồ sơ sang chuyên viên duyệt tay thay vì làm hỏng submission.
 */
describe('AC2: provider timeout is a classified infrastructure error the caller can fall back on', () => {
  it('lets a caller route to manual review on timeout', async () => {
    const provider = new ResilientEkycProvider(
      new FakeEkycProvider({ scenario: 'TIMEOUT' }),
      { timeoutMs: TIMEOUT_MS, maxAttempts: 2 },
      new ManualDelay().delay,
    );

    const routeOf = async (): Promise<'AUTO_SUGGESTION' | 'MANUAL_REVIEW'> => {
      try {
        await provider.ocrIdCard(front, back);
        return 'AUTO_SUGGESTION';
      } catch (e) {
        if (e instanceof EkycProviderError) return 'MANUAL_REVIEW';
        throw e;
      }
    };

    await expect(routeOf()).resolves.toBe('MANUAL_REVIEW');
  });
});

describe('setTimeoutDelay', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves after the given time', async () => {
    vi.useFakeTimers();
    let done = false;
    const p = setTimeoutDelay(500, new AbortController().signal).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(499);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(done).toBe(true);
  });

  it('resolves early and clears its timer when aborted', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const p = setTimeoutDelay(60_000, controller.signal);
    expect(vi.getTimerCount()).toBe(1);
    controller.abort();
    await p;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('resolves immediately when the signal is already aborted', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    controller.abort();
    await setTimeoutDelay(60_000, controller.signal);
    expect(vi.getTimerCount()).toBe(0);
  });
});
