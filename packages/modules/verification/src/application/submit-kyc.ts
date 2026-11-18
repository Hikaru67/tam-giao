import {
  err,
  fail,
  newId,
  ok,
  type Clock,
  type DomainError,
  type Result,
  type Tx,
  type UnitOfWork,
  type UploadPurpose,
  type UploadRegistry,
} from '@tamgiao/kernel';
import { compareApplicantIdentity } from '../domain/applicant-match.js';
import { CccdNumber } from '../domain/cccd-number.js';
import {
  KycSubmission,
  type EkycAssessment,
  type EkycCheck,
  type KycDocuments,
  type KycStatus,
  type KycSubmissionId,
} from '../domain/kyc-submission.js';
import type { ApplicantProfileReader } from './ports/applicant-profile-reader.js';
import {
  EkycProviderError,
  type EkycProvider,
  type EkycRejection,
  type IdCardOcrResult,
} from './ports/ekyc-provider.js';
import type { KycSubmissionRepository } from './ports/kyc-submission-repository.js';
import type { PaymentStatusReader } from './ports/payment-status-reader.js';

/** Key upload client gửi lên (từ `POST /uploads`); bỏ trống → `KYC_DOCS_MISSING`. */
export interface SubmitKycDocumentsInput {
  readonly cccdFrontKey?: string | null | undefined;
  readonly cccdBackKey?: string | null | undefined;
  readonly selfieKey?: string | null | undefined;
  readonly maritalStatusCertificateKey?: string | null | undefined;
}

export interface SubmitKycCommand {
  readonly userId: string;
  readonly documents: SubmitKycDocumentsInput;
}

export interface SubmitKycResult {
  readonly submissionId: KycSubmissionId;
  readonly status: KycStatus;
}

export interface SubmitKycDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly submissions: KycSubmissionRepository;
  readonly uploads: UploadRegistry;
  readonly ekyc: EkycProvider;
  readonly applicants: ApplicantProfileReader;
  /** Trạng thái thanh toán xác thực (facade billing, BE-S4-03) — chưa thanh toán → `PAYMENT_REQUIRED`. */
  readonly payments: PaymentStatusReader;
}

/** Thứ tự kiểm tra + mục đích upload hợp lệ của từng tài liệu. */
const DOCUMENT_SLOTS: readonly { readonly field: keyof KycDocuments; readonly purpose: UploadPurpose }[] = [
  { field: 'cccdFrontKey', purpose: 'kyc_doc' },
  { field: 'cccdBackKey', purpose: 'kyc_doc' },
  { field: 'selfieKey', purpose: 'kyc_selfie' },
  { field: 'maritalStatusCertificateKey', purpose: 'kyc_doc' },
];

/** Trạng thái hồ sơ còn cho người dùng nộp: chưa nộp, hoặc được yêu cầu bổ sung. */
const SUBMITTABLE: readonly KycStatus[] = ['DRAFT', 'NEEDS_MORE_INFO'];

interface CheckOutcome<T> {
  readonly check: EkycCheck;
  readonly value: T | null;
}

/**
 * Người dùng nộp (hoặc nộp bổ sung) bộ tài liệu eKYC (BE-S3-03). Chưa thanh toán xác thực → `PAYMENT_REQUIRED`
 * (BE-S4-03).
 * 1. Kiểm tra đủ 4 key, hồ sơ còn được nộp, key thuộc người dùng (transaction ngắn).
 * 2. Gọi eKYC **ngoài transaction** (không giữ connection/khoá trong lúc chờ nhà cung cấp). Kết quả chỉ là gợi ý:
 *    bị từ chối (ảnh mờ, không khớp…) hay lỗi hạ tầng (timeout…) đều vẫn nộp, chuyên viên duyệt tay.
 * 3. Lưu hồ sơ trong transaction thứ hai (khoá dòng, kiểm tra lại trạng thái). CCCD trùng tài khoản khác →
 *    `CCCD_ALREADY_REGISTERED` do unique index trên blind index bảo đảm (kể cả khi đồng thời).
 */
export class SubmitKyc {
  constructor(private readonly deps: SubmitKycDeps) {}

  async execute(cmd: SubmitKycCommand): Promise<Result<SubmitKycResult, DomainError>> {
    // BE-S4-03: phải thanh toán xác thực trước khi nộp (kiểm tra trước mọi bước khác).
    if (!(await this.deps.payments.hasPaidVerification(cmd.userId))) return fail('PAYMENT_REQUIRED');

    const documents = collectDocuments(cmd.documents);
    if (documents.isErr()) return err(documents.error);
    const docs = documents.value;

    const precheck = await this.deps.uow.run((tx) => this.precheck(tx, cmd.userId, docs));
    if (precheck.isErr()) return err(precheck.error);

    const [assessed, applicant] = await Promise.all([
      this.assess(docs),
      this.deps.applicants.getApplicantIdentity(cmd.userId),
    ]);
    const now = this.deps.clock.now();
    const assessment: EkycAssessment = {
      ocr: assessed.ocr.check,
      liveness: assessed.liveness.check,
      faceMatch: assessed.faceMatch.check,
      profileMismatches:
        assessed.ocr.value !== null && applicant !== null
          ? compareApplicantIdentity(
              { fullName: assessed.ocr.value.fullName, birthDate: assessed.ocr.value.dateOfBirth },
              applicant,
            )
          : null,
      assessedAt: now,
    };

    return this.deps.uow.run(async (tx) => {
      const { submissions } = this.deps;
      const existing = await submissions.findByUserIdForUpdate(tx, cmd.userId);
      if (existing !== null && !SUBMITTABLE.includes(existing.status)) {
        return fail('KYC_ALREADY_SUBMITTED', { status: existing.status });
      }
      const submission =
        existing ?? KycSubmission.start({ id: newId<'KycSubmission'>(), userId: cmd.userId }, now);
      const resubmission = submission.status === 'NEEDS_MORE_INFO';

      const steps: Result<void, DomainError>[] = [
        submission.attachDocuments(docs, now),
        submission.recordEkycAssessment(assessment, now),
      ];
      if (assessed.cccd !== null) steps.push(submission.recordCccdNumber(assessed.cccd, now));
      steps.push(resubmission ? submission.resubmit(now) : submission.submit(now));
      const failed = steps.find((r) => r.isErr());
      if (failed?.isErr()) return err(failed.error);

      const saved = await submissions.save(tx, submission);
      if (saved.isErr()) return err(saved.error);
      return ok({ submissionId: submission.id, status: submission.status });
    });
  }

  private async precheck(tx: Tx, userId: string, docs: KycDocuments): Promise<Result<void, DomainError>> {
    const existing = await this.deps.submissions.findByUserId(tx, userId);
    if (existing !== null && !SUBMITTABLE.includes(existing.status)) {
      return fail('KYC_ALREADY_SUBMITTED', { status: existing.status });
    }
    for (const slot of DOCUMENT_SLOTS) {
      const owned = await this.deps.uploads.verifyOwned(tx, {
        ownerId: userId,
        key: docs[slot.field],
        purposes: [slot.purpose],
      });
      if (owned.isErr()) return fail(owned.error.code, { ...owned.error.details, field: slot.field });
    }
    return ok();
  }

  /** Chạy 3 thao tác eKYC song song; mỗi thao tác độc lập (một thao tác lỗi không bỏ qua thao tác khác). */
  private async assess(docs: KycDocuments): Promise<{
    readonly ocr: CheckOutcome<IdCardOcrResult>;
    readonly liveness: CheckOutcome<unknown>;
    readonly faceMatch: CheckOutcome<unknown>;
    readonly cccd: CccdNumber | null;
  }> {
    const { ekyc } = this.deps;
    const front = { key: docs.cccdFrontKey };
    const back = { key: docs.cccdBackKey };
    const selfie = { key: docs.selfieKey };
    const [ocrRaw, liveness, faceMatch] = await Promise.all([
      runCheck(
        () => ekyc.ocrIdCard(front, back),
        () => null,
      ),
      runCheck(
        () => ekyc.checkLiveness(selfie),
        (v) => v.score,
      ),
      runCheck(
        () => ekyc.matchFace(front, selfie),
        (v) => v.score,
      ),
    ]);

    let ocr = ocrRaw;
    let cccd: CccdNumber | null = null;
    if (ocrRaw.value !== null) {
      const parsed = CccdNumber.parse(ocrRaw.value.cccdNumber);
      if (parsed.isOk()) cccd = parsed.value;
      // Số OCR không hợp lệ → coi như không đọc được giấy tờ; vẫn giữ họ tên/ngày sinh để đối chiếu.
      else
        ocr = {
          check: { status: 'REJECTED', reason: 'DOCUMENT_UNREADABLE', score: null },
          value: ocrRaw.value,
        };
    }
    return { ocr, liveness, faceMatch, cccd };
  }
}

function collectDocuments(input: SubmitKycDocumentsInput): Result<KycDocuments, DomainError> {
  const missing = DOCUMENT_SLOTS.map((s) => s.field).filter((f) => !input[f]?.trim());
  if (missing.length > 0) return fail('KYC_DOCS_MISSING', { missing });
  const docs: KycDocuments = {
    cccdFrontKey: (input.cccdFrontKey ?? '').trim(),
    cccdBackKey: (input.cccdBackKey ?? '').trim(),
    selfieKey: (input.selfieKey ?? '').trim(),
    maritalStatusCertificateKey: (input.maritalStatusCertificateKey ?? '').trim(),
  };
  if (new Set(Object.values(docs)).size !== DOCUMENT_SLOTS.length) {
    return fail('UPLOAD_INVALID', { reason: 'DUPLICATE_KEY' });
  }
  return ok(docs);
}

/**
 * Gọi một thao tác eKYC và chuẩn hoá kết quả. Chỉ nuốt `EkycProviderError` (lỗi hạ tầng có phân loại —
 * BE-S3-02 AC2); lỗi khác là lỗi lập trình, ném tiếp.
 */
async function runCheck<T>(
  call: () => Promise<Result<T, EkycRejection>>,
  scoreOf: (value: T) => number | null,
): Promise<CheckOutcome<T>> {
  try {
    const result = await call();
    if (result.isOk()) return { check: { status: 'OK', score: scoreOf(result.value) }, value: result.value };
    return {
      check: { status: 'REJECTED', reason: result.error.kind, score: result.error.score ?? null },
      value: null,
    };
  } catch (e) {
    if (e instanceof EkycProviderError) return { check: { status: 'ERROR', reason: e.kind }, value: null };
    throw e;
  }
}
