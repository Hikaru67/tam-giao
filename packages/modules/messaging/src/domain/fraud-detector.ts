import { FRAUD_FLAG_THRESHOLD, FRAUD_RULES, type FraudRule } from './fraud-rules.js';
import { buildScanViews, type ScanViews } from './vietnamese-text.js';

/** Kết quả chấm điểm: `reasons` = mã luật khớp (theo thứ tự cấu hình), không trích nội dung tin. */
export interface FraudAssessment {
  readonly score: number;
  readonly reasons: readonly string[];
  readonly flagged: boolean;
}

/**
 * Domain service `FraudDetector` (BE-S6-03): chấm điểm dấu hiệu lừa đảo tài chính của một tin bằng luật regex/từ khoá
 * có trọng số (`fraud-rules.ts`). Chuẩn hoá tiếng Việt bỏ dấu, chống lách bằng khoảng trắng/ký tự đặc biệt/leetspeak.
 * Thuần, không I/O, không log nội dung.
 */
export class FraudDetector {
  constructor(
    private readonly rules: readonly FraudRule[] = FRAUD_RULES,
    private readonly threshold: number = FRAUD_FLAG_THRESHOLD,
  ) {}

  assess(text: string): FraudAssessment {
    const views = buildScanViews(text);
    const reasons: string[] = [];
    let score = 0;
    for (const rule of this.rules) {
      if (matches(rule, views)) {
        reasons.push(rule.id);
        score += rule.weight;
      }
    }
    return { score, reasons, flagged: score >= this.threshold };
  }
}

function matches(rule: FraudRule, views: ScanViews): boolean {
  if (rule.patterns?.some((p) => p.test(views.plain) || p.test(views.leet))) return true;
  if (rule.compact?.some((k) => views.compact.includes(k))) return true;
  return rule.raw?.some((p) => p.test(views.folded)) ?? false;
}
