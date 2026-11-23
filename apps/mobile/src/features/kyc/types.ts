import type {
  KYC_MORE_INFO_ITEMS,
  KYC_PROGRESS_STATUSES,
  SubmitKycBody,
} from '@tamgiao/contracts/verification';
import type { UploadPurposeDto } from '@tamgiao/contracts/uploads';

export type KycProgressStatus = (typeof KYC_PROGRESS_STATUSES)[number];
export type KycMoreInfoItem = (typeof KYC_MORE_INFO_ITEMS)[number];

/**
 * 4 tài liệu `POST /me/kyc` bắt buộc, theo thứ tự hiển thị. Tên slot trùng giá trị `KYC_MORE_INFO_ITEMS` (trừ `OTHER`)
 * để map trực tiếp "yêu cầu bổ sung" của chuyên viên sang ảnh cần chụp lại.
 */
export const KYC_SLOTS = ['CCCD_FRONT', 'CCCD_BACK', 'SELFIE', 'MARITAL_STATUS_CERTIFICATE'] as const;
export type KycSlot = (typeof KYC_SLOTS)[number];

export type KycDocumentField = keyof SubmitKycBody;

export interface KycSlotConfig {
  /** Trường key trong body `POST /me/kyc`. */
  readonly field: KycDocumentField;
  /** Mục đích upload presigned (`POST /uploads`). */
  readonly purpose: UploadPurposeDto;
  /** Camera dùng để chụp: CCCD/giấy tờ dùng camera sau, selfie dùng camera trước. */
  readonly facing: 'front' | 'back';
}

export const KYC_SLOT_CONFIG = {
  CCCD_FRONT: { field: 'cccdFrontKey', purpose: 'kyc_doc', facing: 'back' },
  CCCD_BACK: { field: 'cccdBackKey', purpose: 'kyc_doc', facing: 'back' },
  SELFIE: { field: 'selfieKey', purpose: 'kyc_selfie', facing: 'front' },
  MARITAL_STATUS_CERTIFICATE: { field: 'maritalStatusCertificateKey', purpose: 'kyc_doc', facing: 'back' },
} as const satisfies Record<KycSlot, KycSlotConfig>;

/** Trạng thái hồ sơ còn được nộp (lần đầu hoặc nộp bổ sung) — khớp `SUBMITTABLE` của BE. */
export const KYC_SUBMITTABLE_STATUSES = [
  'NOT_SUBMITTED',
  'DRAFT',
  'NEEDS_MORE_INFO',
] as const satisfies readonly KycProgressStatus[];

export function isKycSubmittable(status: KycProgressStatus): boolean {
  return KYC_SUBMITTABLE_STATUSES.some((s) => s === status);
}

export function isKycSlot(value: string): value is KycSlot {
  return KYC_SLOTS.some((slot) => slot === value);
}

/** Slot ứng với trường key trong body (dùng cho `meta.field` / `meta.missing` của lỗi BE). */
export function slotForField(field: string): KycSlot | null {
  return KYC_SLOTS.find((slot) => KYC_SLOT_CONFIG[slot].field === field) ?? null;
}

/** Key upload đã nộp theo slot (dùng lại khi nộp bổ sung cho ảnh không bị yêu cầu chụp lại). */
export type KycDocumentKeys = Partial<Record<KycSlot, string>>;
