import type { DomainError } from './domain-error.js';
import type { Result } from './result.js';
import type { Tx } from './unit-of-work.js';

/**
 * Bucket logic (BE-S2-07). Tên bucket thật lấy từ config (`S3_BUCKET_*`) ở adapter.
 * - `publicProfile`: ảnh hồ sơ.
 * - `privateKyc`: CCCD, selfie, bằng chứng báo cáo — chỉ đọc qua presigned GET ngắn hạn (AGENTS.md mục 5).
 */
export type StorageBucket = 'publicProfile' | 'privateKyc';

export interface PresignedRequest {
  readonly url: string;
  readonly method: 'PUT' | 'GET';
  /** Header client **bắt buộc** gửi kèm (đã nằm trong chữ ký), vd `content-type`. */
  readonly headers: Readonly<Record<string, string>>;
  readonly expiresAt: Date;
}

export interface ObjectHead {
  readonly sizeBytes: number;
  readonly contentType: string | null;
}

/** Port lưu trữ object kiểu S3. Upload/download đi thẳng client ↔ storage qua presigned URL, không qua API. */
export interface ObjectStorage {
  /** URL PUT có ký `content-type` + `content-length` → client không đổi được loại/kích thước file. */
  presignPut(input: {
    readonly bucket: StorageBucket;
    readonly key: string;
    readonly contentType: string;
    readonly sizeBytes: number;
    readonly expiresInSeconds: number;
  }): Promise<PresignedRequest>;
  /** URL GET; hạn dùng do adapter cố định (`PRESIGNED_URL_TTL_SECONDS`). */
  presignGet(input: { readonly bucket: StorageBucket; readonly key: string }): Promise<PresignedRequest>;
  /** `null` nếu object chưa tồn tại. */
  head(bucket: StorageBucket, key: string): Promise<ObjectHead | null>;
  /** Idempotent: object không tồn tại cũng không lỗi. */
  delete(bucket: StorageBucket, key: string): Promise<void>;
}

/** Mục đích upload → bucket: `profile_photo` → `publicProfile`, còn lại → `privateKyc`. */
export const UPLOAD_PURPOSES = ['profile_photo', 'kyc_doc', 'kyc_selfie', 'report_evidence'] as const;
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

export interface UploadRef {
  readonly uploadId: string;
  readonly ownerId: string;
  readonly key: string;
  readonly bucket: StorageBucket;
  readonly purpose: UploadPurpose;
  readonly contentType: string;
  readonly sizeBytes: number;
}

export type UploadVerifyError = DomainError<'UPLOAD_NOT_OWNED' | 'UPLOAD_INVALID'>;

/**
 * Cho module nghiệp vụ (profile, verification, safety) xác nhận một `key` client gửi lên đúng là của người dùng đó
 * trước khi gắn vào hồ sơ — chặn việc dùng key của người khác (BE-S2-07 AC1).
 */
export interface UploadRegistry {
  /**
   * - Không có upload với `key` hoặc thuộc người khác → `UPLOAD_NOT_OWNED`.
   * - Sai mục đích, object chưa được tải lên, hoặc object thật khác loại/kích thước đã khai báo → `UPLOAD_INVALID`.
   * Thành công → đánh dấu upload đã dùng (`UPLOADED`) và trả thông tin để lưu.
   */
  verifyOwned(
    tx: Tx,
    input: { readonly ownerId: string; readonly key: string; readonly purposes: readonly UploadPurpose[] },
  ): Promise<Result<UploadRef, UploadVerifyError>>;
}
