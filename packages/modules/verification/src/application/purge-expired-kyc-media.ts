import { KYC_MEDIA_RETENTION_DAYS } from '@tamgiao/contracts/constants';
import { err, ok, type Clock, type ObjectStorage, type UnitOfWork } from '@tamgiao/kernel';
import type { AuditLogger } from '@tamgiao/module-identity/facade';
import { isKycMediaRetentionExpired, kycMediaRetentionCutoff } from '../domain/kyc-media-retention.js';
import type { KycSubmissionId } from '../domain/kyc-submission.js';
import { KYC_AUDIT_TARGET_TYPE } from './admin/run-review-action.js';
import type { KycMediaCursor, KycMediaRetentionRepository } from './ports/kyc-media-retention-repository.js';

export const KYC_PURGE_MEDIA_AUDIT_ACTION = 'kyc.purge_media';
const DEFAULT_BATCH_SIZE = 100;

export interface PurgeExpiredKycMediaDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly media: KycMediaRetentionRepository;
  readonly storage: ObjectStorage;
  readonly auditLogger: AuditLogger;
}

export interface PurgeExpiredKycMediaCommand {
  /** Số hồ sơ đọc mỗi lô (mặc định 100). */
  readonly batchSize?: number;
}

/** Kết quả một lượt chạy — chỉ số đếm + id hồ sơ (không key ảnh, không PII). */
export interface KycMediaPurgeSummary {
  /** Hồ sơ đã xoá ảnh + ghi audit trong lượt này. */
  readonly purged: number;
  /** Hồ sơ bị bỏ qua: đang bị transaction khác khoá, hoặc kiểm tra lại thấy đã xoá / chưa quá hạn. */
  readonly skipped: number;
  /** Hồ sơ lỗi (storage / DB) — đã rollback, lượt chạy sau thử lại. */
  readonly failedIds: readonly KycSubmissionId[];
}

const SKIPPED = Symbol('skipped');

/**
 * Xoá ảnh eKYC hết thời hạn lưu (BE-S3-06). Quét theo lô `(decidedAt, id)`; **mỗi hồ sơ một transaction**:
 * khoá dòng (`FOR UPDATE SKIP LOCKED`) → kiểm tra lại luật domain → xoá object (idempotent) → đặt key = NULL
 * → audit `kyc.purge_media` (actor `system`) cùng `tx`.
 *
 * Idempotent (A9): hồ sơ đã xoá không còn key nên không được chọn lại / bị bỏ qua khi kiểm tra lại → không audit
 * trùng. Lỗi giữa chừng (vd DB lỗi sau khi đã xoá object) → rollback, key vẫn còn; lượt sau xoá lại (object không
 * tồn tại không lỗi) rồi mới đặt NULL. Lỗi một hồ sơ không chặn các hồ sơ khác (cursor vẫn tiến).
 */
export class PurgeExpiredKycMedia {
  constructor(private readonly deps: PurgeExpiredKycMediaDeps) {}

  async execute(cmd: PurgeExpiredKycMediaCommand = {}): Promise<KycMediaPurgeSummary> {
    const limit = cmd.batchSize ?? DEFAULT_BATCH_SIZE;
    const decidedBefore = kycMediaRetentionCutoff(this.deps.clock.now());
    let purged = 0;
    let skipped = 0;
    const failedIds: KycSubmissionId[] = [];

    let after: KycMediaCursor | null = null;
    for (;;) {
      const batch = await this.findBatch(decidedBefore, after, limit);
      for (const candidate of batch) {
        try {
          if (await this.purgeOne(candidate.submissionId)) purged++;
          else skipped++;
        } catch {
          failedIds.push(candidate.submissionId);
        }
      }
      const last = batch.at(-1);
      if (last === undefined || batch.length < limit) break;
      after = last;
    }
    return { purged, skipped, failedIds };
  }

  private async findBatch(
    decidedBefore: Date,
    after: KycMediaCursor | null,
    limit: number,
  ): Promise<readonly KycMediaCursor[]> {
    const found = await this.deps.uow.run(async (tx) =>
      ok(await this.deps.media.findExpired(tx, { decidedBefore, after, limit })),
    );
    return found.isOk() ? found.value : [];
  }

  /** `true` = đã xoá ảnh; `false` = bỏ qua. Throw = lỗi hạ tầng (đã rollback). */
  private async purgeOne(submissionId: KycSubmissionId): Promise<boolean> {
    const result = await this.deps.uow.run(async (tx) => {
      const media = await this.deps.media.lockMedia(tx, submissionId);
      const now = this.deps.clock.now();
      if (media === null || media.keys.length === 0 || !isKycMediaRetentionExpired(media, now)) {
        return err(SKIPPED);
      }

      for (const key of media.keys) {
        await this.deps.storage.delete('privateKyc', key);
      }
      await this.deps.media.clearMedia(tx, submissionId, now);

      const audited = await this.deps.auditLogger.log(tx, {
        actor: { type: 'system', id: null },
        action: KYC_PURGE_MEDIA_AUDIT_ACTION,
        targetType: KYC_AUDIT_TARGET_TYPE,
        targetId: submissionId,
        meta: {
          status: media.status,
          objectCount: media.keys.length,
          retentionDays: KYC_MEDIA_RETENTION_DAYS,
        },
      });
      // Audit sai định dạng là lỗi lập trình → throw để rollback (không xoá mà không ghi vết).
      if (audited.isErr())
        throw new Error(`audit log ${KYC_PURGE_MEDIA_AUDIT_ACTION} rejected: ${audited.error.code}`);
      return ok(true);
    });
    return result.isOk();
  }
}
