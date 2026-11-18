import {
  addDuration,
  fail,
  newId,
  ok,
  type Clock,
  type DomainError,
  type ObjectStorage,
  type Result,
  type StorageBucket,
  type Tx,
  type UnitOfWork,
  type UploadPurpose,
  type UploadRef,
  type UploadRegistry,
  type UploadVerifyError,
} from '@tamgiao/kernel';
import { eq } from 'drizzle-orm';
import { uploads } from '../schema/platform.js';
import { asDbTx } from '../tx.js';

/** MIME được nhận → phần mở rộng của key. */
export const UPLOAD_CONTENT_TYPES: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
};

/**
 * Giới hạn kỹ thuật cho một tệp ảnh (ảnh chụp điện thoại thường 2–6 MB). Không phải luật nghiệp vụ nên
 * không nằm trong `@tamgiao/contracts/constants`.
 */
export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

export const bucketForPurpose = (purpose: UploadPurpose): StorageBucket =>
  purpose === 'profile_photo' ? 'publicProfile' : 'privateKyc';

export interface RequestUploadInput {
  readonly ownerId: string;
  readonly purpose: UploadPurpose;
  readonly contentType: string;
  readonly sizeBytes: number;
}

export interface UploadTicket {
  readonly uploadId: string;
  readonly key: string;
  readonly url: string;
  readonly method: 'PUT';
  readonly headers: Readonly<Record<string, string>>;
  readonly expiresAt: Date;
}

export interface UploadServiceDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly storage: ObjectStorage;
  /** Hạn URL PUT (giây) — composition root truyền `PRESIGNED_URL_TTL_SECONDS`. */
  readonly putTtlSeconds: number;
}

/**
 * Cấp presigned PUT + ghi `platform.uploads`; hiện thực `UploadRegistry` cho module nghiệp vụ.
 * Hạ tầng dùng chung (không thuộc module nào), nên nằm ở `@tamgiao/db` thay vì một module.
 */
export class UploadService implements UploadRegistry {
  constructor(private readonly deps: UploadServiceDeps) {}

  async requestUpload(
    input: RequestUploadInput,
  ): Promise<Result<UploadTicket, DomainError<'UPLOAD_INVALID'>>> {
    const ext = UPLOAD_CONTENT_TYPES[input.contentType];
    if (ext === undefined) return fail('UPLOAD_INVALID', { reason: 'CONTENT_TYPE_NOT_ALLOWED' });
    if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0 || input.sizeBytes > UPLOAD_MAX_BYTES) {
      return fail('UPLOAD_INVALID', { reason: 'SIZE_OUT_OF_RANGE', maxBytes: UPLOAD_MAX_BYTES });
    }

    const { uow, clock, storage, putTtlSeconds } = this.deps;
    const uploadId = newId<'Upload'>();
    const bucket = bucketForPurpose(input.purpose);
    // Key không chứa tên tệp gốc của client (có thể lộ PII) — chỉ purpose/owner/id.
    const key = `${input.purpose}/${input.ownerId}/${uploadId}.${ext}`;
    const now = clock.now();

    const presigned = await storage.presignPut({
      bucket,
      key,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      expiresInSeconds: putTtlSeconds,
    });
    await uow.run(async (tx) => {
      await asDbTx(tx)
        .insert(uploads)
        .values({
          id: uploadId,
          ownerId: input.ownerId,
          key,
          bucket,
          purpose: input.purpose,
          contentType: input.contentType,
          sizeBytes: input.sizeBytes,
          status: 'PENDING',
          createdAt: now,
          expiresAt: addDuration(now, { seconds: putTtlSeconds }),
        });
      return ok();
    });

    return ok({
      uploadId,
      key,
      url: presigned.url,
      method: 'PUT',
      headers: presigned.headers,
      expiresAt: presigned.expiresAt,
    });
  }

  async verifyOwned(
    tx: Tx,
    input: { readonly ownerId: string; readonly key: string; readonly purposes: readonly UploadPurpose[] },
  ): Promise<Result<UploadRef, UploadVerifyError>> {
    const [row] = await asDbTx(tx).select().from(uploads).where(eq(uploads.key, input.key)).for('update');
    // Không phân biệt "không tồn tại" với "của người khác" → không dò được key của người khác.
    if (!row || row.ownerId !== input.ownerId) return fail('UPLOAD_NOT_OWNED');

    const purpose = row.purpose as UploadPurpose;
    if (!input.purposes.includes(purpose)) return fail('UPLOAD_INVALID', { reason: 'WRONG_PURPOSE' });
    const bucket = row.bucket as StorageBucket;

    if (row.status === 'PENDING') {
      const head = await this.deps.storage.head(bucket, row.key);
      if (head === null) return fail('UPLOAD_INVALID', { reason: 'NOT_UPLOADED' });
      if (head.sizeBytes !== row.sizeBytes || head.contentType !== row.contentType) {
        // URL đã ký content-type/length nên lẽ ra không xảy ra; vẫn kiểm tra lại phòng storage không ép chữ ký.
        return fail('UPLOAD_INVALID', { reason: 'OBJECT_MISMATCH' });
      }
      await asDbTx(tx)
        .update(uploads)
        .set({ status: 'CONFIRMED', confirmedAt: this.deps.clock.now() })
        .where(eq(uploads.id, row.id));
    }

    return ok({
      uploadId: row.id,
      ownerId: row.ownerId,
      key: row.key,
      bucket,
      purpose,
      contentType: row.contentType,
      sizeBytes: row.sizeBytes,
    });
  }
}
