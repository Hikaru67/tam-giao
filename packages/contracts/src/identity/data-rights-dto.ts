import { z } from 'zod';

/** Trạng thái file xuất dữ liệu cá nhân (BE-S7-06). */
export const DATA_EXPORT_STATUSES = ['PENDING', 'READY', 'EXPIRED'] as const;
export type DataExportStatus = (typeof DATA_EXPORT_STATUSES)[number];

/** `POST /me/data-exports` (202) và `GET /me/data-exports/:id`. */
export const dataExportViewSchema = z.object({
  exportId: z.uuid(),
  status: z.enum(DATA_EXPORT_STATUSES),
  requestedAt: z.iso.datetime(),
  readyAt: z.iso.datetime().nullable(),
  /** Hết hạn tải (24 giờ sau khi sẵn sàng); `null` khi chưa sẵn sàng. */
  expiresAt: z.iso.datetime().nullable(),
  /** Đường dẫn tải có ký (tương đối), dùng được tới `expiresAt`, không cần đăng nhập; `null` khi chưa sẵn sàng / hết hạn. */
  downloadUrl: z.string().nullable(),
});
export type DataExportView = z.infer<typeof dataExportViewSchema>;

/** Query của `GET /data-exports/:id/download` (liên kết có ký). */
export const dataExportDownloadQuerySchema = z.object({
  expires: z.coerce.number().int().positive(),
  sig: z.string().regex(/^[A-Za-z0-9_-]{20,128}$/),
});
export type DataExportDownloadQuery = z.infer<typeof dataExportDownloadQuerySchema>;

/** Ảnh của chính chủ trong file xuất: presigned GET cấp lúc tải (hạn `PRESIGNED_URL_TTL_SECONDS`). */
export const dataExportFileSchema = z.object({
  section: z.string(),
  label: z.string(),
  url: z.string(),
  expiresAt: z.iso.datetime(),
});

/** Nội dung file JSON xuất dữ liệu. `sections` = dữ liệu từng module (chỉ của chính chủ). */
export const dataExportDocumentSchema = z.object({
  exportId: z.uuid(),
  userId: z.uuid(),
  generatedAt: z.iso.datetime(),
  sections: z.record(z.string(), z.unknown()),
  files: z.array(dataExportFileSchema),
});
export type DataExportDocument = z.infer<typeof dataExportDocumentSchema>;

/** `POST /me/account/deletion` — mã OTP vừa gửi tới SĐT của tài khoản (`POST /me/account/deletion/otp`). */
export const deleteAccountBodySchema = z.object({ code: z.string().regex(/^\d{6}$/) });
export type DeleteAccountBody = z.infer<typeof deleteAccountBodySchema>;

export const ACCOUNT_DELETION_STATUSES = ['PROCESSING', 'COMPLETED'] as const;
export type AccountDeletionStatus = (typeof ACCOUNT_DELETION_STATUSES)[number];

/** `POST /me/account/deletion` (202) và `GET /account-deletions/:requestId` (không cần đăng nhập — phiên đã bị thu hồi). */
export const accountDeletionViewSchema = z.object({
  requestId: z.uuid(),
  status: z.enum(ACCOUNT_DELETION_STATUSES),
  requestedAt: z.iso.datetime(),
  /** Tiến độ từng module tự xoá/ẩn danh dữ liệu của mình. */
  steps: z.array(z.object({ module: z.string(), done: z.boolean() })),
});
export type AccountDeletionView = z.infer<typeof accountDeletionViewSchema>;
