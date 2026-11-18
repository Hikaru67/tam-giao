import { asDbTx, type OutboxWriter } from '@tamgiao/db';
import { fail, ok, type BlindIndexer, type Encryptor, type Result, type Tx } from '@tamgiao/kernel';
import { eq, sql } from 'drizzle-orm';
import { CCCD_INDEX_PURPOSE } from '../application/index-purposes.js';
import type {
  KycSaveError,
  KycSubmissionRepository,
} from '../application/ports/kyc-submission-repository.js';
import { CccdNumber } from '../domain/cccd-number.js';
import {
  APPLICANT_MISMATCH_FIELDS,
  KYC_STATUSES,
  KYC_STEPS,
  KYC_STEP_STATUSES,
  KycSubmission,
  MORE_INFO_ITEMS,
  type ApplicantMismatchField,
  type EkycAssessment,
  type EkycCheck,
  type KycStatus,
  type KycStepState,
  type KycSteps,
  type KycSubmissionId,
  type MoreInfoItem,
  type MoreInfoRequest,
} from '../domain/kyc-submission.js';
import { RejectionReason } from '../domain/rejection-reason.js';
import { KYC_CCCD_BIDX_UNIQUE, KYC_USER_UNIQUE, kycSubmissions } from './schema.js';

export type Row = typeof kycSubmissions.$inferSelect;

const cccdContext = (userId: string) => `verification.kyc_submissions.cccd_number:${userId}`;

const PG_UNIQUE_VIOLATION = '23505';

/** Lỗi pg nằm trong chuỗi `cause` (Drizzle bọc lỗi driver trong `DrizzleQueryError`). */
function uniqueViolationConstraint(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth++) {
    const e = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (e.code === PG_UNIQUE_VIOLATION && typeof e.constraint === 'string') return e.constraint;
    current = e.cause;
  }
  return null;
}

const includes = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === 'string' && (list as readonly string[]).includes(v);

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

const toDate = (v: unknown): Date | null => (typeof v === 'string' ? new Date(v) : null);

function invalid(row: Pick<Row, 'id'>, what: string): never {
  throw new Error(`verification.kyc_submissions ${row.id}: ${what} trong DB không hợp lệ`);
}

/** Hiện thực `KycSubmissionRepository` bằng Drizzle + PostgreSQL. Số CCCD mã hoá + blind index. */
export class DrizzleKycSubmissionRepository implements KycSubmissionRepository {
  constructor(
    private readonly encryptor: Encryptor,
    private readonly blindIndexer: BlindIndexer,
    private readonly outbox: OutboxWriter,
  ) {}

  async findByUserId(tx: Tx, userId: string): Promise<KycSubmission | null> {
    const [row] = await asDbTx(tx).select().from(kycSubmissions).where(eq(kycSubmissions.userId, userId));
    return row ? this.toDomain(row) : null;
  }

  /**
   * Khoá theo người dùng tới hết `tx` — kể cả khi chưa có dòng (advisory lock), để hai lần nộp đồng thời của
   * cùng người dùng chạy tuần tự và lần sau thấy hồ sơ của lần trước (`KYC_ALREADY_SUBMITTED`).
   */
  async findByUserIdForUpdate(tx: Tx, userId: string): Promise<KycSubmission | null> {
    await asDbTx(tx).execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`verification.kyc_submissions:${userId}`}, 0))`,
    );
    const [row] = await asDbTx(tx)
      .select()
      .from(kycSubmissions)
      .where(eq(kycSubmissions.userId, userId))
      .for('update');
    return row ? this.toDomain(row) : null;
  }

  async findById(tx: Tx, id: KycSubmissionId): Promise<KycSubmission | null> {
    const [row] = await asDbTx(tx).select().from(kycSubmissions).where(eq(kycSubmissions.id, id));
    return row ? this.toDomain(row) : null;
  }

  async findByIdForUpdate(tx: Tx, id: KycSubmissionId): Promise<KycSubmission | null> {
    const [row] = await asDbTx(tx)
      .select()
      .from(kycSubmissions)
      .where(eq(kycSubmissions.id, id))
      .for('update');
    return row ? this.toDomain(row) : null;
  }

  async save(tx: Tx, submission: KycSubmission): Promise<Result<void, KycSaveError>> {
    const s = submission.toState();
    const cccd = s.cccdNumber;
    const values = {
      id: s.id,
      userId: s.userId,
      status: s.status,
      steps: serializeSteps(s.steps),
      cccdNumberEnc: cccd !== null ? await this.encryptor.encrypt(cccd.value, cccdContext(s.userId)) : null,
      cccdNumberBidx: cccd !== null ? this.blindIndexer.index(cccd.value, CCCD_INDEX_PURPOSE) : null,
      cccdFrontKey: s.documents?.cccdFrontKey ?? null,
      cccdBackKey: s.documents?.cccdBackKey ?? null,
      selfieKey: s.documents?.selfieKey ?? null,
      maritalStatusCertificateKey: s.documents?.maritalStatusCertificateKey ?? null,
      ekycAssessment: s.ekycAssessment && serializeAssessment(s.ekycAssessment),
      reviewerId: s.reviewerId,
      moreInfoRequest: s.moreInfoRequest && {
        items: [...s.moreInfoRequest.items],
        note: s.moreInfoRequest.note,
        requestedAt: s.moreInfoRequest.requestedAt.toISOString(),
      },
      rejectionCode: s.rejectionReason?.code ?? null,
      rejectionNote: s.rejectionReason?.note ?? null,
      decidedBy: s.decidedBy,
      createdAt: s.createdAt,
      submittedAt: s.submittedAt,
      decidedAt: s.decidedAt,
      updatedAt: s.updatedAt,
      version: s.version,
    };
    const { id: _id, userId: _userId, createdAt: _createdAt, ...updatable } = values;

    try {
      await asDbTx(tx)
        .insert(kycSubmissions)
        .values(values)
        .onConflictDoUpdate({ target: kycSubmissions.id, set: updatable });
    } catch (error) {
      const constraint = uniqueViolationConstraint(error);
      if (constraint === KYC_CCCD_BIDX_UNIQUE) return fail('CCCD_ALREADY_REGISTERED');
      if (constraint === KYC_USER_UNIQUE) return fail('KYC_ALREADY_SUBMITTED');
      throw error;
    }

    await this.outbox.append(tx, submission.pullEvents());
    return ok();
  }

  private async toDomain(row: Row): Promise<KycSubmission> {
    if (!includes<KycStatus>(KYC_STATUSES, row.status)) invalid(row, 'status');

    let cccdNumber: CccdNumber | null = null;
    if (row.cccdNumberEnc !== null) {
      const parsed = CccdNumber.parse(
        await this.encryptor.decrypt(row.cccdNumberEnc, cccdContext(row.userId)),
      );
      if (parsed.isErr()) invalid(row, 'cccd_number');
      cccdNumber = parsed.value;
    }

    let rejectionReason: RejectionReason | null = null;
    if (row.rejectionCode !== null) {
      const parsed = RejectionReason.create({ code: row.rejectionCode, note: row.rejectionNote });
      if (parsed.isErr()) invalid(row, 'rejection');
      rejectionReason = parsed.value;
    }

    const { cccdFrontKey, cccdBackKey, selfieKey, maritalStatusCertificateKey } = row;
    const documents =
      cccdFrontKey !== null &&
      cccdBackKey !== null &&
      selfieKey !== null &&
      maritalStatusCertificateKey !== null
        ? { cccdFrontKey, cccdBackKey, selfieKey, maritalStatusCertificateKey }
        : null;

    return KycSubmission.restore({
      id: row.id as KycSubmissionId,
      userId: row.userId,
      status: row.status,
      steps: parseSteps(row),
      cccdNumber,
      documents,
      ekycAssessment: row.ekycAssessment === null ? null : parseAssessment(row),
      reviewerId: row.reviewerId,
      moreInfoRequest: row.moreInfoRequest === null ? null : parseMoreInfo(row),
      rejectionReason,
      decidedBy: row.decidedBy,
      createdAt: row.createdAt,
      submittedAt: row.submittedAt,
      decidedAt: row.decidedAt,
      updatedAt: row.updatedAt,
      version: row.version,
    });
  }
}

function serializeSteps(steps: KycSteps): Record<string, { status: string; decidedAt: string | null }> {
  return Object.fromEntries(
    KYC_STEPS.map((step) => [
      step,
      { status: steps[step].status, decidedAt: steps[step].decidedAt?.toISOString() ?? null },
    ]),
  );
}

export function parseSteps(row: Row): KycSteps {
  const raw = row.steps;
  if (!isObject(raw)) invalid(row, 'steps');
  const entry = (step: (typeof KYC_STEPS)[number]): KycStepState => {
    const v = raw[step];
    if (!isObject(v) || !includes(KYC_STEP_STATUSES, v.status)) invalid(row, `steps.${step}`);
    return { status: v.status, decidedAt: toDate(v.decidedAt) };
  };
  return {
    CCCD_CHIP: entry('CCCD_CHIP'),
    MARITAL_STATUS: entry('MARITAL_STATUS'),
    MANUAL_REVIEW: entry('MANUAL_REVIEW'),
    INTERVIEW: entry('INTERVIEW'),
  };
}

function serializeAssessment(a: EkycAssessment): Record<string, unknown> {
  return {
    ocr: { ...a.ocr },
    liveness: { ...a.liveness },
    faceMatch: { ...a.faceMatch },
    profileMismatches: a.profileMismatches && [...a.profileMismatches],
    assessedAt: a.assessedAt.toISOString(),
  };
}

function parseCheck(row: Row, v: unknown): EkycCheck {
  if (!isObject(v)) invalid(row, 'ekyc_assessment');
  const score = typeof v.score === 'number' ? v.score : null;
  if (v.status === 'OK') return { status: 'OK', score };
  if (typeof v.reason !== 'string') invalid(row, 'ekyc_assessment');
  if (v.status === 'REJECTED') return { status: 'REJECTED', reason: v.reason, score };
  if (v.status === 'ERROR') return { status: 'ERROR', reason: v.reason };
  invalid(row, 'ekyc_assessment');
}

export function parseAssessment(row: Row): EkycAssessment {
  const raw = row.ekycAssessment;
  if (!isObject(raw)) invalid(row, 'ekyc_assessment');
  const assessedAt = toDate(raw.assessedAt);
  if (assessedAt === null) invalid(row, 'ekyc_assessment');
  let profileMismatches: ApplicantMismatchField[] | null = null;
  if (raw.profileMismatches !== null) {
    if (!Array.isArray(raw.profileMismatches)) invalid(row, 'ekyc_assessment');
    profileMismatches = raw.profileMismatches.filter((f): f is ApplicantMismatchField =>
      includes(APPLICANT_MISMATCH_FIELDS, f),
    );
  }
  return {
    ocr: parseCheck(row, raw.ocr),
    liveness: parseCheck(row, raw.liveness),
    faceMatch: parseCheck(row, raw.faceMatch),
    profileMismatches,
    assessedAt,
  };
}

function parseMoreInfo(row: Row): MoreInfoRequest {
  const raw = row.moreInfoRequest;
  if (!isObject(raw) || !Array.isArray(raw.items)) invalid(row, 'more_info_request');
  const requestedAt = toDate(raw.requestedAt);
  if (requestedAt === null) invalid(row, 'more_info_request');
  return {
    items: raw.items.filter((i): i is MoreInfoItem => includes(MORE_INFO_ITEMS, i)),
    note: typeof raw.note === 'string' ? raw.note : null,
    requestedAt,
  };
}
