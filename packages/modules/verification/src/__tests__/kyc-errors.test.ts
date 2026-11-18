import {
  KYC_APPROVED,
  KYC_MORE_INFO_ITEMS,
  KYC_MORE_INFO_REQUESTED,
  KYC_REJECTED,
  KYC_REJECTION_REASON_CODES,
  KYC_SUBMITTED,
  errorRegistry,
} from '@tamgiao/contracts';
import { describe, expect, it } from 'vitest';
import { VERIFICATION_DOMAIN_ERRORS } from '../domain/errors.js';
import * as domain from '../domain/kyc-submission.js';
import { REJECTION_REASON_CODES } from '../domain/rejection-reason.js';

describe('mã lỗi verification (domain)', () => {
  it.each(VERIFICATION_DOMAIN_ERRORS)('%s đã đăng ký HTTP status trong contracts', (code) => {
    expect(errorRegistry.get(code)).toBeDefined();
  });
});

// Domain không được import contracts ngoài `constants` (A1) → giữ bản sao, test này bảo đảm hai nơi khớp nhau.
describe('danh mục KYC khớp contracts', () => {
  it('event type names', () => {
    expect([
      domain.KYC_SUBMITTED,
      domain.KYC_APPROVED,
      domain.KYC_REJECTED,
      domain.KYC_MORE_INFO_REQUESTED,
    ]).toEqual([KYC_SUBMITTED, KYC_APPROVED, KYC_REJECTED, KYC_MORE_INFO_REQUESTED]);
  });

  it('rejection reason codes', () => {
    expect(REJECTION_REASON_CODES).toEqual(KYC_REJECTION_REASON_CODES);
  });

  it('more-info items', () => {
    expect(domain.MORE_INFO_ITEMS).toEqual(KYC_MORE_INFO_ITEMS);
  });
});
