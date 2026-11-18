import type { ApplicantMismatchField } from './kyc-submission.js';

/** Họ tên + ngày sinh (`YYYY-MM-DD`) để đối chiếu giữa OCR CCCD và hồ sơ. Chứa PII — không log. */
export interface ApplicantIdentity {
  readonly fullName: string;
  readonly birthDate: string;
}

/**
 * Chuẩn hoá họ tên để so khớp: bỏ dấu tiếng Việt (kể cả `đ`), viết hoa, gộp khoảng trắng.
 * vd `"  Nguyễn   Văn  Ánh "` → `"NGUYEN VAN ANH"`.
 */
export function normalizePersonName(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Trả danh sách trường lệch giữa thông tin OCR và hồ sơ (rỗng = khớp). */
export function compareApplicantIdentity(
  ocr: ApplicantIdentity,
  profile: ApplicantIdentity,
): ApplicantMismatchField[] {
  const mismatches: ApplicantMismatchField[] = [];
  if (normalizePersonName(ocr.fullName) !== normalizePersonName(profile.fullName))
    mismatches.push('FULL_NAME');
  if (ocr.birthDate.trim() !== profile.birthDate.trim()) mismatches.push('BIRTH_DATE');
  return mismatches;
}
