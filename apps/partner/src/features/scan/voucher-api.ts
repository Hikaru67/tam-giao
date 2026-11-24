import type { ApiClient } from '@tamgiao/api-client';
import {
  redeemVoucherBodySchema,
  redeemVoucherResponseSchema,
  type RedeemVoucherBody,
  type RedeemVoucherResponse,
} from '@tamgiao/contracts/billing';

/**
 * Đổi voucher tại quán đối tác (`POST /partner/vouchers/redeem`, BE-S4-05).
 * Gửi token đọc được từ mã QR hoặc nhập tay.
 */
export function redeemVoucher(client: ApiClient, body: RedeemVoucherBody): Promise<RedeemVoucherResponse> {
  return client.post('/partner/vouchers/redeem', {
    body: redeemVoucherBodySchema.parse(body),
    schema: redeemVoucherResponseSchema,
  });
}
