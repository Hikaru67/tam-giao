import { ContactMasker } from './contact-masker.js';
import { FraudDetector } from './fraud-detector.js';
import type { MessageScreener } from './message-policy.js';

/**
 * Ghép `FraudDetector` + `ContactMasker` thành `MessageScreener` (BE-S6-03):
 * - `maskedBody` = bản đã che liên hệ (SĐT, email, link, MXH) hoặc `null` khi không có gì để che;
 * - `flagged` khi điểm lừa đảo ≥ ngưỡng, `reasons` = mã luật khớp (rỗng khi không gắn cờ).
 * Chấm điểm trên nội dung gốc (trước khi che) để không mất tín hiệu STK/link.
 */
export function createContentScreener(
  detector: FraudDetector = new FraudDetector(),
  masker: ContactMasker = new ContactMasker(),
): MessageScreener {
  return (body) => {
    const assessment = detector.assess(body);
    return {
      maskedBody: masker.mask(body),
      flagged: assessment.flagged,
      reasons: assessment.flagged ? assessment.reasons : [],
    };
  };
}
