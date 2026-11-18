import type { Result } from '@tamgiao/kernel';

/**
 * Tham chiếu một ảnh đã tải lên bucket private (`privateKyc`) qua presigned PUT (BE-S2-07).
 *
 * Port nhận **object key** chứ không nhận bytes: use case chỉ có key (đã `UploadRegistry.verifyOwned`),
 * không phải tải ảnh vào bộ nhớ của tiến trình API. Adapter thật tự lấy ảnh theo cách nhà cung cấp cần
 * (presigned GET URL ngắn hạn qua `ObjectStorage.presignGet`, hoặc tự tải bytes rồi gửi multipart/base64).
 */
export interface EkycImageRef {
  readonly key: string;
}

/**
 * Dữ liệu OCR từ CCCD gắn chip, đã chuẩn hoá. **Chứa PII** — không log, không đưa vào message lỗi.
 * Đây chỉ là **gợi ý** cho chuyên viên; quyết định cuối do chuyên viên.
 */
export interface IdCardOcrResult {
  /** 12 chữ số, không khoảng trắng. */
  readonly cccdNumber: string;
  /** Họ tên in hoa/thường như trên thẻ, đã trim, gộp khoảng trắng. */
  readonly fullName: string;
  /** Ngày sinh dạng lịch `YYYY-MM-DD` (không gắn múi giờ). */
  readonly dateOfBirth: string;
}

export interface LivenessResult {
  /** Điểm người thật, thang [0, 1]. */
  readonly score: number;
}

export interface FaceMatchResult {
  /** Điểm khớp khuôn mặt ảnh chân dung trên thẻ ↔ selfie, thang [0, 1]. */
  readonly score: number;
}

/**
 * Phân loại các lần nhà cung cấp **từ chối nghiệp vụ** một ảnh (khác với lỗi hạ tầng):
 * - `IMAGE_BLURRY`: ảnh mờ/lóa/thiếu sáng, cần chụp lại.
 * - `DOCUMENT_UNREADABLE`: không đọc được giấy tờ (cắt mất góc, không phải CCCD…).
 * - `NO_FACE_DETECTED`: không thấy khuôn mặt (hoặc nhiều khuôn mặt).
 * - `LIVENESS_FAILED`: nghi ảnh chụp lại màn hình/ảnh in.
 * - `FACE_MISMATCH`: khuôn mặt selfie không khớp ảnh trên thẻ.
 */
export const EKYC_REJECTION_KINDS = [
  'IMAGE_BLURRY',
  'DOCUMENT_UNREADABLE',
  'NO_FACE_DETECTED',
  'LIVENESS_FAILED',
  'FACE_MISMATCH',
] as const;
export type EkycRejectionKind = (typeof EKYC_REJECTION_KINDS)[number];

export interface EkycRejection {
  readonly kind: EkycRejectionKind;
  /** Điểm nhà cung cấp trả kèm (nếu có), thang [0, 1] — vd điểm khớp khi `FACE_MISMATCH`. */
  readonly score?: number;
}

/**
 * Phân loại lỗi hạ tầng khi gọi nhà cung cấp:
 * - `TIMEOUT`: quá thời gian chờ (đã retry hết lượt nếu đi qua `ResilientEkycProvider`).
 * - `UNAVAILABLE`: lỗi mạng / 5xx / bị giới hạn tần suất.
 * - `BAD_RESPONSE`: phản hồi sai định dạng / thiếu trường bắt buộc.
 * - `UNEXPECTED`: lỗi không phân loại được (bug adapter…).
 */
export const EKYC_PROVIDER_ERROR_KINDS = ['TIMEOUT', 'UNAVAILABLE', 'BAD_RESPONSE', 'UNEXPECTED'] as const;
export type EkycProviderErrorKind = (typeof EKYC_PROVIDER_ERROR_KINDS)[number];

export type EkycOperation = 'ocrIdCard' | 'checkLiveness' | 'matchFace';

/**
 * Lỗi hạ tầng **có phân loại** của eKYC (throw, không phải `Result` — AGENTS.md A4).
 * Use case bắt lỗi này để vẫn chuyển hồ sơ sang chuyên viên duyệt tay (BE-S3-02 AC2).
 * Message chỉ chứa phân loại + thao tác, **không bao giờ** chứa PII.
 */
export class EkycProviderError extends Error {
  override readonly name = 'EkycProviderError';
  /** Số lần đã gọi nhà cung cấp trước khi bỏ cuộc. */
  readonly attempts: number;

  constructor(
    readonly kind: EkycProviderErrorKind,
    readonly operation: EkycOperation,
    options?: { readonly cause?: unknown; readonly attempts?: number },
  ) {
    super(
      `eKYC ${operation} failed: ${kind}`,
      options?.cause === undefined ? undefined : { cause: options.cause },
    );
    this.attempts = options?.attempts ?? 1;
  }

  /** Lỗi tạm thời, gọi lại có thể thành công. */
  get retryable(): boolean {
    return this.kind === 'TIMEOUT' || this.kind === 'UNAVAILABLE';
  }
}

/**
 * Nhà cung cấp eKYC (chờ quyết định D2). Kết quả chỉ là **gợi ý** cho chuyên viên.
 * - Từ chối nghiệp vụ (ảnh mờ, không khớp…) → `Err(EkycRejection)`.
 * - Lỗi hạ tầng (timeout, mất kết nối…) → throw `EkycProviderError`.
 */
export interface EkycProvider {
  ocrIdCard(front: EkycImageRef, back: EkycImageRef): Promise<Result<IdCardOcrResult, EkycRejection>>;
  checkLiveness(selfie: EkycImageRef): Promise<Result<LivenessResult, EkycRejection>>;
  matchFace(idPortrait: EkycImageRef, selfie: EkycImageRef): Promise<Result<FaceMatchResult, EkycRejection>>;
}
