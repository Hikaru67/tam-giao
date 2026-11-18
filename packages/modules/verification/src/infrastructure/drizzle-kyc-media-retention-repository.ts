import { asDbTx } from '@tamgiao/db';
import type { Tx } from '@tamgiao/kernel';
import { and, asc, eq, gt, inArray, isNotNull, lt, or } from 'drizzle-orm';
import type {
  KycMediaCursor,
  KycMediaRetentionRepository,
  KycStoredMedia,
} from '../application/ports/kyc-media-retention-repository.js';
import { KYC_STATUSES, type KycStatus, type KycSubmissionId } from '../domain/kyc-submission.js';
import { kycSubmissions as t } from './schema.js';

const DECIDED: readonly KycStatus[] = ['APPROVED', 'REJECTED'];

const hasAnyMedia = or(
  isNotNull(t.cccdFrontKey),
  isNotNull(t.cccdBackKey),
  isNotNull(t.selfieKey),
  isNotNull(t.maritalStatusCertificateKey),
);

const isStatus = (v: string): v is KycStatus => (KYC_STATUSES as readonly string[]).includes(v);

/** Hiện thực `KycMediaRetentionRepository` bằng Drizzle — chỉ đọc/ghi cột key ảnh, không giải mã số CCCD. */
export class DrizzleKycMediaRetentionRepository implements KycMediaRetentionRepository {
  async findExpired(
    tx: Tx,
    query: { readonly decidedBefore: Date; readonly after: KycMediaCursor | null; readonly limit: number },
  ): Promise<readonly KycMediaCursor[]> {
    const { after } = query;
    const rows = await asDbTx(tx)
      .select({ id: t.id, decidedAt: t.decidedAt })
      .from(t)
      .where(
        and(
          inArray(t.status, [...DECIDED]),
          lt(t.decidedAt, query.decidedBefore),
          hasAnyMedia,
          after === null
            ? undefined
            : or(
                gt(t.decidedAt, after.decidedAt),
                and(eq(t.decidedAt, after.decidedAt), gt(t.id, after.submissionId)),
              ),
        ),
      )
      .orderBy(asc(t.decidedAt), asc(t.id))
      .limit(query.limit);
    return rows.flatMap((r) =>
      r.decidedAt === null ? [] : [{ submissionId: r.id as KycSubmissionId, decidedAt: r.decidedAt }],
    );
  }

  async lockMedia(tx: Tx, submissionId: KycSubmissionId): Promise<KycStoredMedia | null> {
    const [row] = await asDbTx(tx)
      .select({
        status: t.status,
        decidedAt: t.decidedAt,
        cccdFrontKey: t.cccdFrontKey,
        cccdBackKey: t.cccdBackKey,
        selfieKey: t.selfieKey,
        maritalStatusCertificateKey: t.maritalStatusCertificateKey,
      })
      .from(t)
      .where(eq(t.id, submissionId))
      .for('update', { skipLocked: true });
    if (row === undefined) return null;
    if (!isStatus(row.status)) {
      throw new Error(`verification.kyc_submissions ${submissionId}: status trong DB không hợp lệ`);
    }
    const keys = [row.cccdFrontKey, row.cccdBackKey, row.selfieKey, row.maritalStatusCertificateKey].filter(
      (k): k is string => k !== null,
    );
    return { submissionId, status: row.status, decidedAt: row.decidedAt, keys };
  }

  async clearMedia(tx: Tx, submissionId: KycSubmissionId, now: Date): Promise<void> {
    await asDbTx(tx)
      .update(t)
      .set({
        cccdFrontKey: null,
        cccdBackKey: null,
        selfieKey: null,
        maritalStatusCertificateKey: null,
        updatedAt: now,
      })
      .where(eq(t.id, submissionId));
  }
}
