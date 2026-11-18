import {
  PAYMENT_FAILED,
  PAYMENT_SUCCEEDED,
  REFUND_COMPLETED,
  VOUCHER_ACTIVATED,
  VOUCHER_EXPIRED_EVENT,
  VOUCHER_ISSUED,
  VOUCHER_REDEEMED,
  VOUCHER_VOIDED,
  errorRegistry,
} from '@tamgiao/contracts';
import { describe, expect, it } from 'vitest';
import { BILLING_DOMAIN_ERRORS } from '../domain/errors.js';
import * as payment from '../domain/verification-payment.js';
import * as voucher from '../domain/voucher.js';

describe('mã lỗi billing (domain)', () => {
  it.each(BILLING_DOMAIN_ERRORS)('%s đã đăng ký HTTP status trong contracts', (code) => {
    expect(errorRegistry.get(code)).toBeDefined();
  });
});

// Domain không được import contracts ngoài `constants` (A1) → giữ bản sao, test này bảo đảm hai nơi khớp nhau.
describe('tên event billing khớp contracts', () => {
  it('payment events', () => {
    expect([payment.PAYMENT_SUCCEEDED, payment.PAYMENT_FAILED, payment.REFUND_COMPLETED]).toEqual([
      PAYMENT_SUCCEEDED,
      PAYMENT_FAILED,
      REFUND_COMPLETED,
    ]);
  });

  it('voucher events', () => {
    expect([
      voucher.VOUCHER_ISSUED,
      voucher.VOUCHER_ACTIVATED,
      voucher.VOUCHER_REDEEMED,
      voucher.VOUCHER_VOIDED,
      voucher.VOUCHER_EXPIRED_EVENT,
    ]).toEqual([VOUCHER_ISSUED, VOUCHER_ACTIVATED, VOUCHER_REDEEMED, VOUCHER_VOIDED, VOUCHER_EXPIRED_EVENT]);
  });
});
