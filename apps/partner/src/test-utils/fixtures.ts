import type {
  PartnerSessionResponse,
  PartnerMeResponse,
  RedeemVoucherResponse,
} from '@tamgiao/contracts/billing';

export const STAFF_ID = '01890a5d-ac96-774b-bcce-b302099a8057';
export const PARTNER_ID = '01890a5d-ac96-774b-bcce-b302099a8058';
export const VOUCHER_ID = '01890a5d-ac96-774b-bcce-b302099a8059';

export function partnerSessionFixture(token = 'partner-session-token'): PartnerSessionResponse {
  return {
    token,
    expiresAt: '2026-11-25T20:00:00.000Z',
    staff: {
      id: STAFF_ID,
      name: 'Nguyễn Văn A',
    },
    partner: {
      id: PARTNER_ID,
      name: 'Cà phê Hẹn Hò',
    },
  };
}

export function partnerMeFixture(): PartnerMeResponse {
  return {
    staff: {
      id: STAFF_ID,
      name: 'Nguyễn Văn A',
    },
    partner: {
      id: PARTNER_ID,
      name: 'Cà phê Hẹn Hò',
    },
  };
}

export function redeemSuccessFixture(valueVnd = 300_000): RedeemVoucherResponse {
  return {
    voucherId: VOUCHER_ID,
    status: 'REDEEMED',
    valueVnd,
    redeemedAt: '2026-11-24T19:40:00.000Z',
  };
}
