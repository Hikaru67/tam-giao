import { describe, it, expect } from 'vitest';
import { ApiError } from '@tamgiao/api-client';
import { redeemVoucherBodySchema, VOUCHER_QR_TOKEN_MAX_LENGTH } from '@tamgiao/contracts/billing';
import { redeemOutcome } from './redeem-result';

describe('redeemOutcome', () => {
  it('không có lỗi → success', () => {
    expect(redeemOutcome(null)).toBe('success');
    expect(redeemOutcome(undefined)).toBe('success');
  });

  it('VOUCHER_ALREADY_REDEEMED → already_redeemed', () => {
    const error = new ApiError({
      code: 'VOUCHER_ALREADY_REDEEMED',
      status: 409,
      message: 'Voucher đã được sử dụng',
    });
    expect(redeemOutcome(error)).toBe('already_redeemed');
  });

  it('VOUCHER_EXPIRED → expired', () => {
    const error = new ApiError({
      code: 'VOUCHER_EXPIRED',
      status: 410,
      message: 'Voucher đã hết hạn',
    });
    expect(redeemOutcome(error)).toBe('expired');
  });

  it('VOUCHER_PARTNER_MISMATCH → wrong_partner', () => {
    const error = new ApiError({
      code: 'VOUCHER_PARTNER_MISMATCH',
      status: 403,
      message: 'Voucher không áp dụng tại quán này',
    });
    expect(redeemOutcome(error)).toBe('wrong_partner');
  });

  it('VOUCHER_TOKEN_INVALID hoặc VOUCHER_NOT_FOUND → invalid_code', () => {
    const invalidTokenError = new ApiError({
      code: 'VOUCHER_TOKEN_INVALID',
      status: 422,
      message: 'Mã QR không hợp lệ',
    });
    expect(redeemOutcome(invalidTokenError)).toBe('invalid_code');

    const notFoundError = new ApiError({
      code: 'VOUCHER_NOT_FOUND',
      status: 404,
      message: 'Không tìm thấy voucher',
    });
    expect(redeemOutcome(notFoundError)).toBe('invalid_code');
  });

  it('VOUCHER_NOT_ACTIVE → not_active', () => {
    const error = new ApiError({
      code: 'VOUCHER_NOT_ACTIVE',
      status: 409,
      message: 'Voucher chưa kích hoạt',
    });
    expect(redeemOutcome(error)).toBe('not_active');
  });

  it('NETWORK_ERROR, TIMEOUT hoặc status = 0 → network', () => {
    const networkError = new ApiError({
      code: 'NETWORK_ERROR',
      status: 0,
      message: 'Lỗi mạng',
    });
    expect(redeemOutcome(networkError)).toBe('network');

    const timeoutError = new ApiError({
      code: 'TIMEOUT',
      status: 0,
      message: 'Quá thời gian chờ',
    });
    expect(redeemOutcome(timeoutError)).toBe('network');

    const zeroStatusError = new ApiError({
      code: 'OTHER_CLIENT_ERROR',
      status: 0,
      message: 'Mất kết nối',
    });
    expect(redeemOutcome(zeroStatusError)).toBe('network');
  });

  it('5xx → network (chưa biết BE đã đổi xong chưa, cho gửi lại cùng mã)', () => {
    const error = new ApiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Lỗi hệ thống' });
    expect(redeemOutcome(error)).toBe('network');
  });

  it('mã quét không đúng dạng token (schema contract chặn) → invalid_code', () => {
    const parsed = redeemVoucherBodySchema.safeParse({
      token: 'x'.repeat(VOUCHER_QR_TOKEN_MAX_LENGTH + 1),
    });
    expect(redeemOutcome(parsed.error)).toBe('invalid_code');
  });

  it('lỗi khác không xác định → unknown', () => {
    const otherApiError = new ApiError({
      code: 'SOMETHING_ELSE',
      status: 409,
      message: 'Lỗi khác',
    });
    expect(redeemOutcome(otherApiError)).toBe('unknown');

    const standardError = new Error('Lỗi chung');
    expect(redeemOutcome(standardError)).toBe('unknown');
  });
});
