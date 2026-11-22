import type { PartnerDto, PaymentHistoryItem, MyVoucher } from '@tamgiao/contracts/billing';
import { REFUND_SLA_HOURS } from '@tamgiao/contracts/constants';
import type { KYC_STEP_NAMES, KycProgressResponse } from '@tamgiao/contracts/verification';
import { PAID_STATUSES } from '../payment/index.js';

export type KycStepName = (typeof KYC_STEP_NAMES)[number];
export type StepDisplayState = 'passed' | 'failed' | 'current' | 'pending';

/**
 * Xác định trạng thái hiển thị của từng bước thẩm định:
 * - PASSED -> 'passed'
 * - FAILED -> 'failed'
 * - PENDING: bước PENDING đầu tiên là 'current' chỉ khi progress.status ∈ {SUBMITTED, UNDER_REVIEW, NEEDS_MORE_INFO}; còn lại 'pending'.
 */
export function stepDisplayStates(
  progress: KycProgressResponse,
): { step: KycStepName; state: StepDisplayState; decidedAt: string | null }[] {
  const canHaveCurrent =
    progress.status === 'SUBMITTED' ||
    progress.status === 'UNDER_REVIEW' ||
    progress.status === 'NEEDS_MORE_INFO';
  let firstPendingFound = false;

  return progress.steps.map((item) => {
    let state: StepDisplayState;
    if (item.status === 'PASSED') {
      state = 'passed';
    } else if (item.status === 'FAILED') {
      state = 'failed';
    } else {
      if (canHaveCurrent && !firstPendingFound) {
        state = 'current';
        firstPendingFound = true;
      } else {
        state = 'pending';
      }
    }
    return {
      step: item.step,
      state,
      decidedAt: item.decidedAt,
    };
  });
}

export function countPassedSteps(progress: KycProgressResponse): number {
  return progress.steps.filter((s) => s.status === 'PASSED').length;
}

/**
 * Khoản thanh toán hợp lệ đầu tiên (mảng đã sắp xếp mới nhất trước)
 * có status ∈ {SUCCEEDED, REFUND_PENDING, REFUNDED}.
 */
export function latestPaidPayment(items: readonly PaymentHistoryItem[]): PaymentHistoryItem | null {
  for (const item of items) {
    if (PAID_STATUSES.some((paid) => paid === item.status)) {
      return item;
    }
  }
  return null;
}

export type RefundState =
  | { kind: 'not_started'; deadline: Date | null }
  | { kind: 'pending'; deadline: Date | null }
  | { kind: 'refunded'; amountVnd: number; refundedAt: Date | null }
  | { kind: 'none' };

/**
 * Xác định trạng thái hoàn tiền khi hồ sơ bị từ chối:
 * Chỉ hiển thị khi progress.status === 'REJECTED' và payment !== null.
 */
export function refundStateFor(
  progress: KycProgressResponse,
  payment: PaymentHistoryItem | null,
): RefundState {
  if (progress.status !== 'REJECTED' || payment === null) {
    return { kind: 'none' };
  }

  const deadline =
    progress.decidedAt !== null
      ? new Date(new Date(progress.decidedAt).getTime() + REFUND_SLA_HOURS * 3_600_000)
      : null;

  if (payment.status === 'SUCCEEDED') {
    return { kind: 'not_started', deadline };
  }

  if (payment.status === 'REFUND_PENDING') {
    return { kind: 'pending', deadline };
  }

  if (payment.status === 'REFUNDED') {
    return {
      kind: 'refunded',
      amountVnd: payment.amountVnd,
      refundedAt: payment.refundedAt ? new Date(payment.refundedAt) : null,
    };
  }

  return { kind: 'none' };
}

/**
 * Voucher đầu tiên có status RESERVED hoặc ACTIVE.
 */
/** Voucher đang hiển thị được (đã giữ chỗ hoặc đã kích hoạt). */
export type DisplayableVoucher = MyVoucher & { status: 'RESERVED' | 'ACTIVE' };

function isDisplayableVoucher(voucher: MyVoucher): voucher is DisplayableVoucher {
  return voucher.status === 'RESERVED' || voucher.status === 'ACTIVE';
}

export function displayableVoucher(items: readonly MyVoucher[]): DisplayableVoucher | null {
  return items.find(isDisplayableVoucher) ?? null;
}

/**
 * Danh sách tên quán áp dụng cho voucher:
 * - partnerId khác null: [tên quán khớp id] (không khớp -> [])
 * - partnerId null: tên mọi quán trong danh sách
 */
export function voucherPartnerNames(voucher: MyVoucher, partners: readonly PartnerDto[]): string[] {
  if (voucher.partnerId !== null) {
    const match = partners.find((p) => p.id === voucher.partnerId);
    return match ? [match.name] : [];
  }
  return partners.map((p) => p.name);
}

function toDate(value: string | Date): Date {
  return typeof value === 'string' ? new Date(value) : value;
}

/**
 * Định dạng ngày theo giờ địa phương: dd/MM/yyyy.
 */
export function formatLocalDate(iso: string | Date): string {
  const d = toDate(iso);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = String(d.getFullYear());
  return `${day}/${month}/${year}`;
}

/**
 * Định dạng ngày giờ theo giờ địa phương: HH:mm dd/MM/yyyy.
 */
export function formatLocalDateTime(value: string | Date): string {
  const d = toDate(value);
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes} ${formatLocalDate(d)}`;
}
