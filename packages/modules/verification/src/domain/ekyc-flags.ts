import type { EkycAssessment, EkycCheck } from './kyc-submission.js';

/**
 * Cờ cảnh báo eKYC hiển thị ở hàng chờ duyệt (BE-S3-04) — gợi ý chuyên viên xem kỹ, không tự quyết định gì.
 * - `EKYC_MISSING`: hồ sơ chưa có kết quả eKYC.
 * - `<THAO_TÁC>_REJECTED` / `<THAO_TÁC>_ERROR`: nhà cung cấp từ chối (ảnh mờ, không khớp…) / lỗi hạ tầng.
 * - `FULL_NAME_MISMATCH`, `BIRTH_DATE_MISMATCH`: OCR lệch hồ sơ.
 * - `PROFILE_NOT_COMPARED`: không đối chiếu được OCR với hồ sơ.
 *
 * Hồ sơ "có cờ" ⇔ danh sách khác rỗng. Bộ lọc `flagged` ở `DrizzleKycReviewQueue` viết lại đúng định nghĩa này
 * bằng SQL — đổi ở đây phải đổi ở đó (test tích hợp giữ hai nơi khớp nhau).
 */
export const EKYC_FLAGS = [
  'EKYC_MISSING',
  'OCR_REJECTED',
  'OCR_ERROR',
  'LIVENESS_REJECTED',
  'LIVENESS_ERROR',
  'FACE_MATCH_REJECTED',
  'FACE_MATCH_ERROR',
  'FULL_NAME_MISMATCH',
  'BIRTH_DATE_MISMATCH',
  'PROFILE_NOT_COMPARED',
] as const;
export type EkycFlag = (typeof EKYC_FLAGS)[number];

const checkFlag = (check: EkycCheck, rejected: EkycFlag, error: EkycFlag): EkycFlag | null => {
  if (check.status === 'REJECTED') return rejected;
  if (check.status === 'ERROR') return error;
  return null;
};

/** Cờ eKYC của một hồ sơ, theo thứ tự `EKYC_FLAGS`. */
export function ekycFlags(assessment: EkycAssessment | null): readonly EkycFlag[] {
  if (assessment === null) return ['EKYC_MISSING'];
  const flags: (EkycFlag | null)[] = [
    checkFlag(assessment.ocr, 'OCR_REJECTED', 'OCR_ERROR'),
    checkFlag(assessment.liveness, 'LIVENESS_REJECTED', 'LIVENESS_ERROR'),
    checkFlag(assessment.faceMatch, 'FACE_MATCH_REJECTED', 'FACE_MATCH_ERROR'),
  ];
  const mismatches = assessment.profileMismatches;
  if (mismatches === null) flags.push('PROFILE_NOT_COMPARED');
  else {
    if (mismatches.includes('FULL_NAME')) flags.push('FULL_NAME_MISMATCH');
    if (mismatches.includes('BIRTH_DATE')) flags.push('BIRTH_DATE_MISMATCH');
  }
  return flags.filter((f): f is EkycFlag => f !== null);
}
