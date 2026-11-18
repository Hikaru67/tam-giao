import { fail, ok, type DomainError, type Result } from '@tamgiao/kernel';

/** Nhóm lý do từ chối hồ sơ (chuyên viên chọn trên admin). */
export const REJECTION_REASON_CODES = [
  'INVALID_ID_DOCUMENT',
  'FACE_MISMATCH',
  'INFO_MISMATCH',
  'MARITAL_STATUS_UNVERIFIED',
  'NOT_ELIGIBLE',
  'DUPLICATE_ACCOUNT',
  'INTERVIEW_FAILED',
  'OTHER',
] as const;
export type RejectionReasonCode = (typeof REJECTION_REASON_CODES)[number];

export const REJECTION_NOTE_MAX_LENGTH = 1000;

const isReasonCode = (raw: string): raw is RejectionReasonCode =>
  (REJECTION_REASON_CODES as readonly string[]).includes(raw);

/**
 * Lý do từ chối = mã (bắt buộc) + ghi chú của chuyên viên. Ghi chú bắt buộc khi mã là `OTHER`.
 * Ghi chú có thể chứa thông tin cá nhân → không đưa vào event, chỉ lưu trong hồ sơ.
 */
export class RejectionReason {
  private constructor(
    readonly code: RejectionReasonCode,
    readonly note: string | null,
  ) {}

  static create(input: {
    readonly code: string | null | undefined;
    readonly note?: string | null;
  }): Result<RejectionReason, DomainError<'REJECTION_REASON_REQUIRED'>> {
    const code = input.code?.trim() ?? '';
    if (!isReasonCode(code)) return fail('REJECTION_REASON_REQUIRED', { field: 'code' });

    const note = input.note?.trim() ?? '';
    if (note.length > REJECTION_NOTE_MAX_LENGTH) {
      return fail('REJECTION_REASON_REQUIRED', { field: 'note', maxLength: REJECTION_NOTE_MAX_LENGTH });
    }
    if (code === 'OTHER' && note.length === 0) return fail('REJECTION_REASON_REQUIRED', { field: 'note' });
    return ok(new RejectionReason(code, note.length > 0 ? note : null));
  }
}
