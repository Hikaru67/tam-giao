import type { MyVoucher, PartnerDto, PaymentHistoryItem } from '@tamgiao/contracts/billing';
import { REFUND_SLA_HOURS } from '@tamgiao/contracts/constants';
import type { KycProgressResponse } from '@tamgiao/contracts/verification';
import {
  countPassedSteps,
  displayableVoucher,
  formatLocalDate,
  formatLocalDateTime,
  latestPaidPayment,
  refundStateFor,
  stepDisplayStates,
  voucherPartnerNames,
} from './status-model.js';

describe('status-model (FE-S3-04)', () => {
  describe('stepDisplayStates', () => {
    it('1. Trả về đúng passed, failed và đánh dấu current cho bước pending đầu tiên khi SUBMITTED / UNDER_REVIEW / NEEDS_MORE_INFO', () => {
      const progress: KycProgressResponse = {
        status: 'SUBMITTED',
        submittedAt: '2026-11-22T08:00:00.000Z',
        decidedAt: null,
        steps: [
          { step: 'CCCD_CHIP', status: 'PASSED', decidedAt: '2026-11-22T08:05:00.000Z' },
          { step: 'MARITAL_STATUS', status: 'PENDING', decidedAt: null },
          { step: 'MANUAL_REVIEW', status: 'PENDING', decidedAt: null },
          { step: 'INTERVIEW', status: 'PENDING', decidedAt: null },
        ],
        moreInfo: null,
        rejectionReason: null,
      };

      const result = stepDisplayStates(progress);

      expect(result).toEqual([
        { step: 'CCCD_CHIP', state: 'passed', decidedAt: '2026-11-22T08:05:00.000Z' },
        { step: 'MARITAL_STATUS', state: 'current', decidedAt: null },
        { step: 'MANUAL_REVIEW', state: 'pending', decidedAt: null },
        { step: 'INTERVIEW', state: 'pending', decidedAt: null },
      ]);
    });

    it('2. Khi có bước FAILED thì trả về state failed', () => {
      const progress: KycProgressResponse = {
        status: 'UNDER_REVIEW',
        submittedAt: '2026-11-22T08:00:00.000Z',
        decidedAt: null,
        steps: [
          { step: 'CCCD_CHIP', status: 'PASSED', decidedAt: '2026-11-22T08:05:00.000Z' },
          { step: 'MARITAL_STATUS', status: 'FAILED', decidedAt: '2026-11-22T08:10:00.000Z' },
          { step: 'MANUAL_REVIEW', status: 'PENDING', decidedAt: null },
          { step: 'INTERVIEW', status: 'PENDING', decidedAt: null },
        ],
        moreInfo: null,
        rejectionReason: null,
      };

      const result = stepDisplayStates(progress);

      expect(result).toEqual([
        { step: 'CCCD_CHIP', state: 'passed', decidedAt: '2026-11-22T08:05:00.000Z' },
        { step: 'MARITAL_STATUS', state: 'failed', decidedAt: '2026-11-22T08:10:00.000Z' },
        { step: 'MANUAL_REVIEW', state: 'current', decidedAt: null },
        { step: 'INTERVIEW', state: 'pending', decidedAt: null },
      ]);
    });

    it('3. Khi status là APPROVED, REJECTED, NOT_SUBMITTED, DRAFT thì bước PENDING không được là current (toàn bộ là pending)', () => {
      const statuses = ['APPROVED', 'REJECTED', 'NOT_SUBMITTED', 'DRAFT'] as const;

      for (const status of statuses) {
        const progress: KycProgressResponse = {
          status,
          submittedAt: null,
          decidedAt: null,
          steps: [
            { step: 'CCCD_CHIP', status: 'PENDING', decidedAt: null },
            { step: 'MARITAL_STATUS', status: 'PENDING', decidedAt: null },
            { step: 'MANUAL_REVIEW', status: 'PENDING', decidedAt: null },
            { step: 'INTERVIEW', status: 'PENDING', decidedAt: null },
          ],
          moreInfo: null,
          rejectionReason: null,
        };

        const result = stepDisplayStates(progress);
        expect(result.every((s) => s.state === 'pending')).toBe(true);
      }
    });
  });

  describe('countPassedSteps', () => {
    it('Đếm chính xác số bước PASSED', () => {
      const progress: KycProgressResponse = {
        status: 'SUBMITTED',
        submittedAt: '2026-11-22T08:00:00.000Z',
        decidedAt: null,
        steps: [
          { step: 'CCCD_CHIP', status: 'PASSED', decidedAt: '2026-11-22T08:05:00.000Z' },
          { step: 'MARITAL_STATUS', status: 'PASSED', decidedAt: '2026-11-22T08:10:00.000Z' },
          { step: 'MANUAL_REVIEW', status: 'PENDING', decidedAt: null },
          { step: 'INTERVIEW', status: 'PENDING', decidedAt: null },
        ],
        moreInfo: null,
        rejectionReason: null,
      };

      expect(countPassedSteps(progress)).toBe(2);
    });
  });

  describe('latestPaidPayment', () => {
    it('Bỏ qua PENDING và FAILED; chọn phần tử đầu tiên có status SUCCEEDED, REFUND_PENDING, hoặc REFUNDED', () => {
      const items: PaymentHistoryItem[] = [
        {
          paymentId: '01890a5d-ac96-774b-bcce-b302099a8051',
          orderId: 'ORD-1',
          status: 'PENDING',
          amountVnd: 299000,
          checkoutUrl: null,
          qrData: null,
          createdAt: '2026-11-22T10:00:00.000Z',
          succeededAt: null,
          failedAt: null,
          refundedAt: null,
        },
        {
          paymentId: '01890a5d-ac96-774b-bcce-b302099a8052',
          orderId: 'ORD-2',
          status: 'FAILED',
          amountVnd: 299000,
          checkoutUrl: null,
          qrData: null,
          createdAt: '2026-11-22T09:00:00.000Z',
          succeededAt: null,
          failedAt: '2026-11-22T09:05:00.000Z',
          refundedAt: null,
        },
        {
          paymentId: '01890a5d-ac96-774b-bcce-b302099a8053',
          orderId: 'ORD-3',
          status: 'SUCCEEDED',
          amountVnd: 299000,
          checkoutUrl: null,
          qrData: null,
          createdAt: '2026-11-22T08:00:00.000Z',
          succeededAt: '2026-11-22T08:05:00.000Z',
          failedAt: null,
          refundedAt: null,
        },
        {
          paymentId: '01890a5d-ac96-774b-bcce-b302099a8054',
          orderId: 'ORD-4',
          status: 'REFUNDED',
          amountVnd: 299000,
          checkoutUrl: null,
          qrData: null,
          createdAt: '2026-11-22T07:00:00.000Z',
          succeededAt: '2026-11-22T07:05:00.000Z',
          failedAt: null,
          refundedAt: '2026-11-22T07:10:00.000Z',
        },
      ];

      const result = latestPaidPayment(items);
      expect(result?.paymentId).toBe('01890a5d-ac96-774b-bcce-b302099a8053');
    });

    it('Trả về null khi mảng rỗng hoặc chỉ toàn PENDING/FAILED', () => {
      expect(latestPaidPayment([])).toBeNull();

      const onlyFailed: PaymentHistoryItem[] = [
        {
          paymentId: '01890a5d-ac96-774b-bcce-b302099a8051',
          orderId: 'ORD-1',
          status: 'FAILED',
          amountVnd: 299000,
          checkoutUrl: null,
          qrData: null,
          createdAt: '2026-11-22T09:00:00.000Z',
          succeededAt: null,
          failedAt: '2026-11-22T09:05:00.000Z',
          refundedAt: null,
        },
      ];
      expect(latestPaidPayment(onlyFailed)).toBeNull();
    });
  });

  describe('refundStateFor', () => {
    const baseProgress: KycProgressResponse = {
      status: 'REJECTED',
      submittedAt: '2026-11-22T08:00:00.000Z',
      decidedAt: '2026-11-22T12:00:00.000Z',
      steps: [
        { step: 'CCCD_CHIP', status: 'FAILED', decidedAt: '2026-11-22T12:00:00.000Z' },
        { step: 'MARITAL_STATUS', status: 'PENDING', decidedAt: null },
        { step: 'MANUAL_REVIEW', status: 'PENDING', decidedAt: null },
        { step: 'INTERVIEW', status: 'PENDING', decidedAt: null },
      ],
      moreInfo: null,
      rejectionReason: 'INVALID_ID_DOCUMENT',
    };

    const basePayment: PaymentHistoryItem = {
      paymentId: '01890a5d-ac96-774b-bcce-b302099a8051',
      orderId: 'ORD-1',
      status: 'SUCCEEDED',
      amountVnd: 299000,
      checkoutUrl: null,
      qrData: null,
      createdAt: '2026-11-22T08:00:00.000Z',
      succeededAt: '2026-11-22T08:05:00.000Z',
      failedAt: null,
      refundedAt: null,
    };

    it('Trả về none khi progress.status khác REJECTED hoặc payment là null', () => {
      expect(refundStateFor({ ...baseProgress, status: 'SUBMITTED' }, basePayment)).toEqual({
        kind: 'none',
      });
      expect(refundStateFor(baseProgress, null)).toEqual({ kind: 'none' });
    });

    it('Trả về not_started khi payment.status là SUCCEEDED và tính deadline đúng decidedAt + REFUND_SLA_HOURS giờ', () => {
      const result = refundStateFor(baseProgress, basePayment);
      expect(result.kind).toBe('not_started');
      if (result.kind === 'not_started') {
        const expectedMs = new Date('2026-11-22T12:00:00.000Z').getTime() + REFUND_SLA_HOURS * 3_600_000;
        expect(result.deadline?.getTime()).toBe(expectedMs);
      }
    });

    it('Trả về pending khi payment.status là REFUND_PENDING', () => {
      const result = refundStateFor(baseProgress, {
        ...basePayment,
        status: 'REFUND_PENDING',
      });
      expect(result.kind).toBe('pending');
      if (result.kind === 'pending') {
        const expectedMs = new Date('2026-11-22T12:00:00.000Z').getTime() + REFUND_SLA_HOURS * 3_600_000;
        expect(result.deadline?.getTime()).toBe(expectedMs);
      }
    });

    it('Trả về refunded khi payment.status là REFUNDED', () => {
      const refundedAt = '2026-11-23T10:00:00.000Z';
      const result = refundStateFor(baseProgress, {
        ...basePayment,
        status: 'REFUNDED',
        refundedAt,
      });
      expect(result).toEqual({
        kind: 'refunded',
        amountVnd: 299000,
        refundedAt: new Date(refundedAt),
      });
    });

    it('Xử lý decidedAt là null -> deadline là null', () => {
      const result = refundStateFor({ ...baseProgress, decidedAt: null }, basePayment);
      expect(result).toEqual({
        kind: 'not_started',
        deadline: null,
      });
    });
  });

  describe('displayableVoucher', () => {
    it('Bỏ qua VOID, REDEEMED, EXPIRED; chọn voucher đầu tiên có RESERVED hoặc ACTIVE', () => {
      const vouchers: MyVoucher[] = [
        {
          id: '01890a5d-ac96-774b-bcce-b302099a8051',
          status: 'VOID',
          valueVnd: 300000,
          expiresAt: null,
          partnerId: null,
          issuedAt: '2026-11-20T00:00:00.000Z',
          activatedAt: null,
          redeemedAt: null,
        },
        {
          id: '01890a5d-ac96-774b-bcce-b302099a8052',
          status: 'RESERVED',
          valueVnd: 300000,
          expiresAt: null,
          partnerId: null,
          issuedAt: '2026-11-21T00:00:00.000Z',
          activatedAt: null,
          redeemedAt: null,
        },
        {
          id: '01890a5d-ac96-774b-bcce-b302099a8053',
          status: 'ACTIVE',
          valueVnd: 300000,
          expiresAt: '2027-02-21T00:00:00.000Z',
          partnerId: null,
          issuedAt: '2026-11-22T00:00:00.000Z',
          activatedAt: '2026-11-22T00:00:00.000Z',
          redeemedAt: null,
        },
      ];

      expect(displayableVoucher(vouchers)?.id).toBe('01890a5d-ac96-774b-bcce-b302099a8052');
    });

    it('Trả về null nếu không có voucher hợp lệ', () => {
      expect(displayableVoucher([])).toBeNull();
    });
  });

  describe('voucherPartnerNames', () => {
    const partners: PartnerDto[] = [
      {
        id: '01890a5d-ac96-774b-bcce-b302099a8051',
        name: 'The Running Bean',
        address: '123 Đồng Khởi',
        photoUrl: null,
        tags: ['cafe'],
      },
      {
        id: '01890a5d-ac96-774b-bcce-b302099a8052',
        name: 'RuNam d’Or',
        address: '456 Lê Lợi',
        photoUrl: null,
        tags: ['lounge'],
      },
    ];

    const baseVoucher: MyVoucher = {
      id: '01890a5d-ac96-774b-bcce-b302099a8053',
      status: 'ACTIVE',
      valueVnd: 300000,
      expiresAt: null,
      partnerId: null,
      issuedAt: '2026-11-22T00:00:00.000Z',
      activatedAt: null,
      redeemedAt: null,
    };

    it('partnerId khác null và khớp id -> trả [tên quán]', () => {
      const names = voucherPartnerNames(
        { ...baseVoucher, partnerId: '01890a5d-ac96-774b-bcce-b302099a8051' },
        partners,
      );
      expect(names).toEqual(['The Running Bean']);
    });

    it('partnerId khác null nhưng không khớp -> trả []', () => {
      const names = voucherPartnerNames(
        { ...baseVoucher, partnerId: '01890a5d-ac96-774b-bcce-b302099a8099' },
        partners,
      );
      expect(names).toEqual([]);
    });

    it('partnerId là null -> trả tên mọi quán', () => {
      const names = voucherPartnerNames({ ...baseVoucher, partnerId: null }, partners);
      expect(names).toEqual(['The Running Bean', 'RuNam d’Or']);
    });
  });

  describe('formatLocalDate & formatLocalDateTime', () => {
    it('Định dạng đúng theo getter giờ địa phương', () => {
      const testDate = new Date(2026, 10, 23, 9, 5); // 23/11/2026 09:05 local
      const expectedDay = String(testDate.getDate()).padStart(2, '0');
      const expectedMonth = String(testDate.getMonth() + 1).padStart(2, '0');
      const expectedYear = String(testDate.getFullYear());
      const expectedHours = String(testDate.getHours()).padStart(2, '0');
      const expectedMinutes = String(testDate.getMinutes()).padStart(2, '0');

      const expectedDate = `${expectedDay}/${expectedMonth}/${expectedYear}`;
      const expectedDateTime = `${expectedHours}:${expectedMinutes} ${expectedDate}`;

      expect(formatLocalDate(testDate)).toBe(expectedDate);
      expect(formatLocalDateTime(testDate)).toBe(expectedDateTime);

      // Chấp nhận cả chuỗi ISO
      expect(formatLocalDate(testDate.toISOString())).toBe(expectedDate);
      expect(formatLocalDateTime(testDate.toISOString())).toBe(expectedDateTime);
    });
  });
});
