import type { ObjectStorage, StorageBucket, Tx } from '@tamgiao/kernel';
import { eq } from 'drizzle-orm';
import type { EventBus } from '../outbox/event-bus.js';
import { uploads } from '../schema/platform.js';
import { asDbTx } from '../tx.js';

/** Tên consumer (duy nhất toàn hệ thống) xoá upload khi người dùng xoá tài khoản (BE-S7-06). */
export const UPLOADS_ERASE_ON_ACCOUNT_DELETION_CONSUMER = 'uploads.erase-on-account-deletion';

/**
 * Xoá mọi object người dùng đã tải lên qua presigned URL (kể cả ảnh chưa gắn vào hồ sơ nào, ảnh `PENDING`) rồi xoá dòng
 * `platform.uploads` của họ (BE-S7-06). Idempotent: object đã mất không lỗi, dòng đã xoá không còn để chọn lại.
 * Trả số upload đã xoá.
 */
export async function eraseUploadsOfOwner(tx: Tx, storage: ObjectStorage, ownerId: string): Promise<number> {
  const db = asDbTx(tx);
  const rows = await db
    .select({ id: uploads.id, bucket: uploads.bucket, key: uploads.key })
    .from(uploads)
    .where(eq(uploads.ownerId, ownerId))
    .for('update');
  for (const row of rows) await storage.delete(row.bucket as StorageBucket, row.key);
  if (rows.length > 0) await db.delete(uploads).where(eq(uploads.ownerId, ownerId));
  return rows.length;
}

/**
 * Đăng ký consumer `AccountDeletionRequested` cho upload (worker gọi). `eventType` truyền từ `@tamgiao/contracts` (gói db
 * không phụ thuộc contracts).
 */
export function registerUploadErasureConsumer(
  bus: EventBus,
  deps: { readonly eventType: string; readonly storage: ObjectStorage },
): void {
  bus.on(deps.eventType, UPLOADS_ERASE_ON_ACCOUNT_DELETION_CONSUMER, async (event, tx) => {
    const payload = event.payload;
    const userId =
      typeof payload === 'object' && payload !== null ? (payload as { userId?: unknown }).userId : undefined;
    if (typeof userId !== 'string' || userId.length === 0) {
      throw new Error(`${event.type} ${event.eventId}: payload thiếu userId`);
    }
    await eraseUploadsOfOwner(tx, deps.storage, userId);
  });
}
