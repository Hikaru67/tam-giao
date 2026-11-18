import { z } from 'zod';

/**
 * DTO voucher hẹn hò (BE-S4-05): thẻ voucher của người dùng, mã QR ngắn hạn và đổi voucher tại quán đối tác.
 * Giá trị tiền là VND nguyên (`number`) vì JSON không tuần tự hoá được `bigint`.
 */

/** Trạng thái voucher (khớp `VOUCHER_STATUSES` của domain billing — có test đối chiếu). */
export const VOUCHER_STATUS_VALUES = ['RESERVED', 'ACTIVE', 'REDEEMED', 'VOID', 'EXPIRED'] as const;
export type VoucherStatusDto = (typeof VOUCHER_STATUS_VALUES)[number];

/** Một voucher của người dùng (`GET /me/vouchers`). `expiresAt` `null` khi hồ sơ chưa được duyệt. */
export const myVoucherSchema = z.object({
  id: z.uuid(),
  status: z.enum(VOUCHER_STATUS_VALUES),
  valueVnd: z.number().int(),
  expiresAt: z.iso.datetime().nullable(),
  /** Quán được gắn (chỉ quán này đổi được), `null` = đổi ở quán đối tác bất kỳ. */
  partnerId: z.uuid().nullable(),
  issuedAt: z.iso.datetime(),
  activatedAt: z.iso.datetime().nullable(),
  redeemedAt: z.iso.datetime().nullable(),
});
export type MyVoucher = z.infer<typeof myVoucherSchema>;

export const myVouchersResponseSchema = z.object({ items: z.array(myVoucherSchema) });
export type MyVouchersResponse = z.infer<typeof myVouchersResponseSchema>;

/**
 * `GET /me/vouchers/:id/qr` — token ký HMAC chỉ chứa id voucher + hạn (không PII). App vẽ QR từ `token` và gọi lại
 * trước `expiresAt` để làm mới.
 */
export const voucherQrResponseSchema = z.object({
  token: z.string(),
  expiresAt: z.iso.datetime(),
});
export type VoucherQrResponse = z.infer<typeof voucherQrResponseSchema>;

/** Độ dài tối đa token QR chấp nhận ở body (token thật ~140 ký tự). */
export const VOUCHER_QR_TOKEN_MAX_LENGTH = 512;

/** `POST /partner/vouchers/redeem` — nhân viên quán gửi token đọc được từ mã QR. */
export const redeemVoucherBodySchema = z.object({
  token: z.string().min(1).max(VOUCHER_QR_TOKEN_MAX_LENGTH),
});
export type RedeemVoucherBody = z.infer<typeof redeemVoucherBodySchema>;

/** Kết quả đổi voucher cho nhân viên quán — không chứa thông tin người dùng. */
export const redeemVoucherResponseSchema = z.object({
  voucherId: z.uuid(),
  status: z.literal('REDEEMED'),
  valueVnd: z.number().int(),
  redeemedAt: z.iso.datetime(),
});
export type RedeemVoucherResponse = z.infer<typeof redeemVoucherResponseSchema>;
