import { describe, expect, it } from 'vitest';
import { FraudDetector } from '../domain/fraud-detector.js';
import { FRAUD_FLAG_THRESHOLD, FRAUD_RULES } from '../domain/fraud-rules.js';
import { buildScanViews, foldVietnamese } from '../domain/vietnamese-text.js';
import { BENIGN_SAMPLES, SCAM_SAMPLES } from './fixtures/fraud-samples.js';

const detector = new FraudDetector();

describe('chuẩn hoá tiếng Việt', () => {
  it('bỏ dấu, đ → d, chữ thường, gộp ký tự toàn chiều rộng', () => {
    expect(foldVietnamese('Chuyển Khoản ĐẦU TƯ ＯＴＰ')).toBe('chuyen khoan dau tu otp');
  });

  it('nối token một ký tự (lách bằng khoảng trắng / ký tự đặc biệt), đổi leetspeak trong token lẫn chữ số', () => {
    const v = buildScanViews('c.h.u.y.ể.n k-h-o-ả-n vào s t k: b1tc0in 0912 345');
    expect(v.plain).toBe('chuyenkhoan vao stk b1tc0in 0912 345');
    expect(v.leet).toBe('chuyenkhoan vao stk bitcoin 0912 345');
    expect(v.compact).toBe('chuyenkhoanvaostkbitcoin0912345');
  });

  it('"vậy" (có dấu) không bị coi là "vay"; "vay" không dấu vẫn là từ khoá', () => {
    expect(buildScanViews('Như Vậy tiền').plain).toBe('nhu vayy tien');
    expect(detector.assess('vay tien online').reasons).toEqual(['LOAN']);
  });
});

describe('FraudDetector — bộ mẫu (AC1)', () => {
  it('fixtures đủ cỡ: ≥ 30 câu lừa đảo, ≥ 30 câu bình thường', () => {
    expect(SCAM_SAMPLES.length).toBeGreaterThanOrEqual(30);
    expect(BENIGN_SAMPLES.length).toBeGreaterThanOrEqual(30);
  });

  it('AC1: phát hiện ≥ 90% câu lừa đảo', () => {
    const missed = SCAM_SAMPLES.filter((s) => !detector.assess(s).flagged);
    const rate = (SCAM_SAMPLES.length - missed.length) / SCAM_SAMPLES.length;
    expect(missed).toEqual([]); // bộ mẫu hiện tại bắt được hết; nới khi thêm mẫu khó, nhưng giữ ≥ 90%
    expect(rate).toBeGreaterThanOrEqual(0.9);
  });

  it('AC1: báo nhầm ≤ 1 trên bộ câu bình thường', () => {
    const falsePositives = BENIGN_SAMPLES.filter((s) => detector.assess(s).flagged);
    expect(falsePositives.length).toBeLessThanOrEqual(1);
  });

  it.each(SCAM_SAMPLES.map((s, i) => [i, s] as const))('lừa đảo #%i bị gắn cờ: %s', (_i, sample) => {
    const r = detector.assess(sample);
    expect(r.score).toBeGreaterThanOrEqual(FRAUD_FLAG_THRESHOLD);
    expect(r.reasons.length).toBeGreaterThan(0);
  });

  it.each(BENIGN_SAMPLES.map((s, i) => [i, s] as const))('bình thường #%i không gắn cờ: %s', (_i, sample) => {
    expect(detector.assess(sample).flagged).toBe(false);
  });
});

describe('FraudDetector — luật', () => {
  it.each([
    ['đầu tuần', []],
    ['như vậy tiền đâu ra', []],
    ['tài khoản Netflix', []],
    ['mình đi chuyển nhà', []],
    ['mã OTP', ['OTP_REQUEST']],
    ['STK 0123456789', ['BANK_ACCOUNT', 'ACCOUNT_NUMBER']],
    ['đánh coin trên sàn forex', ['FOREX', 'CRYPTO']],
    ['bấm link bit.ly/abc', ['SHORT_LINK']],
  ] as const)('%s → %j', (text, reasons) => {
    expect(detector.assess(text).reasons).toEqual(reasons);
  });

  it('điểm = tổng trọng số luật khớp, mỗi luật tính một lần', () => {
    const r = detector.assess('chuyển khoản, chuyển tiền, chuyển khoản');
    expect(r).toEqual({ score: 3, reasons: ['MONEY_TRANSFER'], flagged: false });
  });

  it('ngưỡng và luật cấu hình được (inject)', () => {
    const strict = new FraudDetector(FRAUD_RULES, 3);
    expect(strict.assess('chuyển khoản giúp mình').flagged).toBe(true);
    expect(detector.assess('chuyển khoản giúp mình').flagged).toBe(false);
  });

  it('mã luật là duy nhất', () => {
    const ids = FRAUD_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
