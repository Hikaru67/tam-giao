import { z } from 'zod';

export const uploadPurposeSchema = z.enum(['profile_photo', 'kyc_doc', 'kyc_selfie', 'report_evidence']);
export type UploadPurposeDto = z.infer<typeof uploadPurposeSchema>;

/**
 * `POST /uploads`. Loại tệp (jpeg/png/heic) và kích thước tối đa được server kiểm tra → `UPLOAD_INVALID`
 * (kèm `meta.reason`), trước khi cấp URL.
 */
export const createUploadBodySchema = z.object({
  purpose: uploadPurposeSchema,
  /** MIME của tệp, vd `image/jpeg`. */
  contentType: z.string().trim().toLowerCase().min(1).max(100),
  /** Kích thước chính xác (byte) — được ký vào URL, tải lên tệp khác kích thước sẽ bị storage từ chối. */
  sizeBytes: z.number().int().positive(),
});
export type CreateUploadBody = z.infer<typeof createUploadBodySchema>;

export const createUploadResponseSchema = z.object({
  uploadId: z.uuid(),
  /** Gửi key này cho API nghiệp vụ (vd hồ sơ) sau khi tải lên xong. */
  key: z.string(),
  url: z.url(),
  method: z.literal('PUT'),
  /** Header bắt buộc gửi kèm request PUT (cùng `content-length` = `sizeBytes`). */
  headers: z.record(z.string(), z.string()),
  expiresAt: z.iso.datetime(),
});
export type CreateUploadResponse = z.infer<typeof createUploadResponseSchema>;
