import type { StorageBucket, Tx } from '@tamgiao/kernel';
import type { AccountDeletion, AccountDeletionId } from '../../domain/account-deletion.js';
import type { DataExport, DataExportId } from '../../domain/data-export.js';

/** Một ảnh/tệp của chính chủ trong file xuất — lúc tải được đổi thành presigned GET. */
export interface PersonalDataFile {
  readonly bucket: StorageBucket;
  readonly key: string;
  /** Nhãn mô tả (vd `profile_photo_1`, `cccd_front`) — không chứa PII. */
  readonly label: string;
}

export interface PersonalDataSection {
  /** Dữ liệu JSON của module (chỉ của chính chủ; Date → ISO, bigint → chuỗi). */
  readonly data: unknown;
  readonly files: readonly PersonalDataFile[];
}

/**
 * Nguồn dữ liệu cá nhân của một module cho file xuất (BE-S7-06). Mỗi module tự hiện thực trong file riêng của mình (đọc
 * bảng của chính nó) và composition root của worker truyền vào identity — identity không đọc bảng module khác (A3).
 */
export interface PersonalDataSource {
  /** Tên mục trong file xuất, vd `profile`. Duy nhất. */
  readonly section: string;
  collect(tx: Tx, userId: string): Promise<PersonalDataSection>;
}

/** Nội dung đã dựng của file xuất (lưu mã hoá tới khi hết hạn tải). */
export interface DataExportPayload {
  readonly generatedAt: string;
  readonly sections: Readonly<Record<string, unknown>>;
  readonly files: readonly (PersonalDataFile & { readonly section: string })[];
}

export interface DataExportRepository {
  /**
   * Thêm yêu cầu mới + event vào outbox cùng `tx` (A6). Người dùng đã có yêu cầu `PENDING` (partial unique index — A10,
   * kể cả hai request đồng thời) → `false`, không ghi gì.
   */
  insert(tx: Tx, exp: DataExport): Promise<boolean>;
  findById(tx: Tx, id: DataExportId): Promise<DataExport | null>;
  /** Khoá dòng tới hết `tx` — hai lượt dựng cùng một yêu cầu chạy tuần tự. */
  findByIdForUpdate(tx: Tx, id: DataExportId): Promise<DataExport | null>;
  findPendingByUser(tx: Tx, userId: string): Promise<DataExport | null>;
  /** Lưu trạng thái `READY` + nội dung (mã hoá qua `Encryptor`). */
  saveReady(tx: Tx, exp: DataExport, payload: DataExportPayload): Promise<void>;
  /** `null` nếu nội dung đã bị xoá (quá hạn). */
  loadPayload(tx: Tx, exp: DataExport): Promise<DataExportPayload | null>;
  /** Xoá nội dung của mọi file đã quá hạn tải; trả số file vừa xoá. Idempotent. */
  purgeExpired(tx: Tx, now: Date): Promise<number>;
  /** Xoá mọi yêu cầu xuất của người dùng (khi xoá tài khoản). */
  deleteByUser(tx: Tx, userId: string): Promise<void>;
}

export interface AccountDeletionRepository {
  findById(tx: Tx, id: AccountDeletionId): Promise<AccountDeletion | null>;
  findByUser(tx: Tx, userId: string): Promise<AccountDeletion | null>;
  /** Thêm yêu cầu + `AccountDeletionRequested` vào outbox cùng `tx` (A6). Trùng `user_id` → throw (unique, A10). */
  insert(tx: Tx, deletion: AccountDeletion): Promise<void>;
}

/** Đọc consumer nào đã xử lý một event (`platform.processed_events`) — tiến độ xoá dữ liệu từng module. */
export interface ConsumerProgressReader {
  processedConsumers(tx: Tx, eventId: string, consumers: readonly string[]): Promise<ReadonlySet<string>>;
}

/** Ký/kiểm tra liên kết tải file xuất (không cần đăng nhập, hết hạn theo `expires`). */
export interface DataExportLinkSigner {
  sign(exportId: string, expiresAtEpochSeconds: number): string;
  verify(exportId: string, expiresAtEpochSeconds: number, signature: string): boolean;
}

/** Một bước xoá dữ liệu: module + tên consumer `AccountDeletionRequested` của nó (composition root khai báo). */
export interface AccountDeletionStep {
  readonly module: string;
  readonly consumer: string;
}
