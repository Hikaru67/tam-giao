import { AggregateRoot, fail, ok, type DomainError, type Id, type Result } from '@tamgiao/kernel';
import type { CccdNumber } from './cccd-number.js';
import type { RejectionReason, RejectionReasonCode } from './rejection-reason.js';

export type KycSubmissionId = Id<'KycSubmission'>;
/** Id tài khoản app (module identity) — verification chỉ giữ tham chiếu, không import domain identity (A3). */
export type KycUserId = string;
/** Id chuyên viên (admin của module identity). */
export type ReviewerId = string;

/**
 * Vòng đời hồ sơ:
 * `DRAFT → SUBMITTED → UNDER_REVIEW → (NEEDS_MORE_INFO ↔ UNDER_REVIEW) → APPROVED | REJECTED`.
 * `APPROVED`, `REJECTED` là trạng thái cuối (đã quyết định).
 */
export const KYC_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'NEEDS_MORE_INFO',
  'APPROVED',
  'REJECTED',
] as const;
export type KycStatus = (typeof KYC_STATUSES)[number];

/** 4 bước kiểm tra hiển thị ở màn 6, theo thứ tự hiển thị. Duyệt hồ sơ cần cả 4 bước `PASSED`. */
export const KYC_STEPS = ['CCCD_CHIP', 'MARITAL_STATUS', 'MANUAL_REVIEW', 'INTERVIEW'] as const;
export type KycStep = (typeof KYC_STEPS)[number];

export const KYC_STEP_STATUSES = ['PENDING', 'PASSED', 'FAILED'] as const;
export type KycStepStatus = (typeof KYC_STEP_STATUSES)[number];
export type KycStepOutcome = Exclude<KycStepStatus, 'PENDING'>;

export interface KycStepState {
  readonly status: KycStepStatus;
  /** Lần cuối bước được đánh dấu đạt/không đạt; `null` khi còn `PENDING`. */
  readonly decidedAt: Date | null;
}

export type KycSteps = Readonly<Record<KycStep, KycStepState>>;

/** Tài liệu chuyên viên có thể yêu cầu bổ sung. */
export const MORE_INFO_ITEMS = [
  'CCCD_FRONT',
  'CCCD_BACK',
  'SELFIE',
  'MARITAL_STATUS_CERTIFICATE',
  'OTHER',
] as const;
export type MoreInfoItem = (typeof MORE_INFO_ITEMS)[number];

export interface MoreInfoRequest {
  readonly items: readonly MoreInfoItem[];
  /** Ghi chú cho người dùng — có thể chứa thông tin cá nhân, không đưa vào event. */
  readonly note: string | null;
  readonly requestedAt: Date;
}

/**
 * Key object (bucket private) của bộ tài liệu người dùng nộp. Key đã được xác nhận thuộc người dùng qua
 * `UploadRegistry` ở tầng application trước khi gắn vào hồ sơ.
 */
export interface KycDocuments {
  readonly cccdFrontKey: string;
  readonly cccdBackKey: string;
  readonly selfieKey: string;
  readonly maritalStatusCertificateKey: string;
}

/**
 * Kết quả một thao tác eKYC: `OK` (có điểm nếu thao tác trả điểm), `REJECTED` (nhà cung cấp từ chối nghiệp vụ —
 * ảnh mờ, không khớp…), `ERROR` (lỗi hạ tầng — timeout, mất kết nối…). `reason` là mã phân loại, không chứa PII.
 */
export type EkycCheck =
  | { readonly status: 'OK'; readonly score: number | null }
  | { readonly status: 'REJECTED'; readonly reason: string; readonly score: number | null }
  | { readonly status: 'ERROR'; readonly reason: string };

/** Trường thông tin OCR lệch với hồ sơ người dùng (đối chiếu họ tên / ngày sinh). */
export const APPLICANT_MISMATCH_FIELDS = ['FULL_NAME', 'BIRTH_DATE'] as const;
export type ApplicantMismatchField = (typeof APPLICANT_MISMATCH_FIELDS)[number];

/**
 * Đánh giá sơ bộ của eKYC — **chỉ là gợi ý** cho chuyên viên, không tự đánh dấu bước nào đạt.
 * Không lưu họ tên / ngày sinh OCR (tối thiểu hoá dữ liệu), chỉ lưu cờ lệch.
 */
export interface EkycAssessment {
  readonly ocr: EkycCheck;
  readonly liveness: EkycCheck;
  readonly faceMatch: EkycCheck;
  /**
   * Trường OCR lệch với hồ sơ (rỗng = khớp). `null` khi không đối chiếu được (OCR không đọc được hoặc hồ sơ
   * chưa có họ tên / ngày sinh) — chuyên viên tự đối chiếu.
   */
  readonly profileMismatches: readonly ApplicantMismatchField[] | null;
  readonly assessedAt: Date;
}

/** Snapshot đầy đủ để repository lưu / dựng lại aggregate (`toState` ↔ `restore`). */
export interface KycSubmissionState {
  readonly id: KycSubmissionId;
  readonly userId: KycUserId;
  readonly status: KycStatus;
  readonly steps: KycSteps;
  /** Số CCCD đọc được (OCR) — `null` khi chưa có (eKYC lỗi/timeout vẫn cho chuyên viên duyệt tay). */
  readonly cccdNumber: CccdNumber | null;
  /** Bộ tài liệu đã nộp — `null` khi hồ sơ còn nháp chưa gắn tài liệu. */
  readonly documents: KycDocuments | null;
  /** Đánh giá eKYC của lần nộp gần nhất — `null` khi chưa chạy. */
  readonly ekycAssessment: EkycAssessment | null;
  readonly reviewerId: ReviewerId | null;
  readonly moreInfoRequest: MoreInfoRequest | null;
  readonly rejectionReason: RejectionReason | null;
  readonly decidedBy: ReviewerId | null;
  readonly createdAt: Date;
  readonly submittedAt: Date | null;
  readonly decidedAt: Date | null;
  readonly updatedAt: Date;
  readonly version: number;
}

export const KYC_SUBMITTED = 'KycSubmitted';
export const KYC_APPROVED = 'KycApproved';
export const KYC_REJECTED = 'KycRejected';
export const KYC_MORE_INFO_REQUESTED = 'KycMoreInfoRequested';

export type KycTransitionError = DomainError<'KYC_INVALID_TRANSITION' | 'KYC_ALREADY_DECIDED'>;
export type KycApproveError = KycTransitionError | DomainError<'KYC_STEPS_INCOMPLETE'>;
export type KycMoreInfoError = KycTransitionError | DomainError<'KYC_MORE_INFO_ITEMS_REQUIRED'>;

const DECIDED_STATUSES: readonly KycStatus[] = ['APPROVED', 'REJECTED'];
const PENDING_STEP: KycStepState = { status: 'PENDING', decidedAt: null };

const initialSteps = (): KycSteps => ({
  CCCD_CHIP: PENDING_STEP,
  MARITAL_STATUS: PENDING_STEP,
  MANUAL_REVIEW: PENDING_STEP,
  INTERVIEW: PENDING_STEP,
});

/**
 * Hồ sơ thẩm định eKYC + độc thân của một người dùng. Kết quả eKYC chỉ là gợi ý; quyết định cuối do chuyên viên
 * (`approve`/`reject`). Event không chứa PII (không số CCCD, không ghi chú) — consumer tự tra theo id.
 *
 * Lưu ý cho repository: chỉ chuyển trạng thái có event mới tăng `version` (kernel `AggregateRoot`);
 * thao tác không phát event (`assignReviewer`, `markStep`, `recordCccdNumber`, `attachDocuments`,
 * `recordEkycAssessment`) chỉ đổi `updatedAt`.
 */
export class KycSubmission extends AggregateRoot<KycSubmissionId> {
  protected readonly aggregateType = 'KycSubmission';

  private constructor(
    private state: Omit<KycSubmissionState, 'version'>,
    version: number,
  ) {
    super(state.id, version);
  }

  /** Tạo hồ sơ nháp (chưa nộp) cho người dùng. */
  static start(
    input: { readonly id: KycSubmissionId; readonly userId: KycUserId },
    now: Date,
  ): KycSubmission {
    return new KycSubmission(
      {
        id: input.id,
        userId: input.userId,
        status: 'DRAFT',
        steps: initialSteps(),
        cccdNumber: null,
        documents: null,
        ekycAssessment: null,
        reviewerId: null,
        moreInfoRequest: null,
        rejectionReason: null,
        decidedBy: null,
        createdAt: now,
        submittedAt: null,
        decidedAt: null,
        updatedAt: now,
      },
      0,
    );
  }

  static restore(state: KycSubmissionState): KycSubmission {
    const { version, ...rest } = state;
    return new KycSubmission({ ...rest, steps: { ...rest.steps } }, version);
  }

  get userId(): KycUserId {
    return this.state.userId;
  }

  get status(): KycStatus {
    return this.state.status;
  }

  get steps(): KycSteps {
    return this.state.steps;
  }

  get documents(): KycDocuments | null {
    return this.state.documents;
  }

  get isDecided(): boolean {
    return DECIDED_STATUSES.includes(this.state.status);
  }

  /** Ghi số CCCD đọc được (OCR) — chỉ khi hồ sơ chưa được quyết định. */
  recordCccdNumber(cccd: CccdNumber, now: Date): Result<void, KycTransitionError> {
    const guard = this.ensureOpen();
    if (guard.isErr()) return guard;
    this.state = { ...this.state, cccdNumber: cccd, updatedAt: now };
    return ok();
  }

  /**
   * Gắn bộ tài liệu người dùng nộp — chỉ khi hồ sơ còn nháp (`DRAFT`) hoặc đang được yêu cầu bổ sung
   * (`NEEDS_MORE_INFO`, bộ mới thay bộ cũ). Không phát event (event phát ở `submit`/`resubmit`).
   */
  attachDocuments(documents: KycDocuments, now: Date): Result<void, KycTransitionError> {
    const guard = this.ensureStatus('attachDocuments', ['DRAFT', 'NEEDS_MORE_INFO']);
    if (guard.isErr()) return guard;
    this.state = { ...this.state, documents: { ...documents }, updatedAt: now };
    return ok();
  }

  /** Ghi đánh giá eKYC (gợi ý cho chuyên viên) — chỉ khi hồ sơ chưa được quyết định. Không phát event. */
  recordEkycAssessment(assessment: EkycAssessment, now: Date): Result<void, KycTransitionError> {
    const guard = this.ensureOpen();
    if (guard.isErr()) return guard;
    this.state = { ...this.state, ekycAssessment: assessment, updatedAt: now };
    return ok();
  }

  /** Người dùng nộp hồ sơ lần đầu: `DRAFT → SUBMITTED`, phát `KycSubmitted`. */
  submit(now: Date): Result<void, KycTransitionError> {
    const guard = this.ensureStatus('submit', ['DRAFT']);
    if (guard.isErr()) return guard;
    this.state = { ...this.state, status: 'SUBMITTED', submittedAt: now, updatedAt: now };
    this.record(KYC_SUBMITTED, this.submittedPayload(false), now);
    return ok();
  }

  /**
   * Gán chuyên viên phụ trách. Hồ sơ `SUBMITTED` chuyển sang `UNDER_REVIEW`; hồ sơ đang xét / chờ bổ sung
   * thì chỉ đổi người phụ trách. Không phát event.
   */
  assignReviewer(reviewerId: ReviewerId, now: Date): Result<void, KycTransitionError> {
    const guard = this.ensureStatus('assignReviewer', ['SUBMITTED', 'UNDER_REVIEW', 'NEEDS_MORE_INFO']);
    if (guard.isErr()) return guard;
    const status: KycStatus = this.state.status === 'SUBMITTED' ? 'UNDER_REVIEW' : this.state.status;
    this.state = { ...this.state, status, reviewerId, updatedAt: now };
    return ok();
  }

  /**
   * Đánh dấu một bước đạt/không đạt (eKYC tự động, chuyên viên, hoặc kết quả phỏng vấn). Được ghi đè kết quả cũ
   * khi hồ sơ chưa quyết định; hồ sơ `DRAFT` cũng được ghi (eKYC có thể chạy trước khi nộp). Không phát event.
   */
  markStep(step: KycStep, outcome: KycStepOutcome, now: Date): Result<void, KycTransitionError> {
    const guard = this.ensureOpen();
    if (guard.isErr()) return guard;
    this.state = {
      ...this.state,
      steps: { ...this.state.steps, [step]: { status: outcome, decidedAt: now } },
      updatedAt: now,
    };
    return ok();
  }

  /** Chuyên viên yêu cầu bổ sung tài liệu: `UNDER_REVIEW → NEEDS_MORE_INFO`, phát `KycMoreInfoRequested`. */
  requestMoreInfo(
    input: { readonly items: readonly MoreInfoItem[]; readonly note?: string | null },
    now: Date,
  ): Result<void, KycMoreInfoError> {
    const guard = this.ensureStatus('requestMoreInfo', ['UNDER_REVIEW']);
    if (guard.isErr()) return guard;
    const items = [...new Set(input.items)];
    if (items.length === 0) return fail('KYC_MORE_INFO_ITEMS_REQUIRED');

    const note = input.note?.trim() ?? '';
    this.state = {
      ...this.state,
      status: 'NEEDS_MORE_INFO',
      moreInfoRequest: { items, note: note.length > 0 ? note : null, requestedAt: now },
      updatedAt: now,
    };
    this.record(
      KYC_MORE_INFO_REQUESTED,
      { submissionId: this.id, userId: this.state.userId, items: [...items] },
      now,
    );
    return ok();
  }

  /** Người dùng nộp bổ sung: `NEEDS_MORE_INFO → UNDER_REVIEW`, phát `KycSubmitted` (`resubmission = true`). */
  resubmit(now: Date): Result<void, KycTransitionError> {
    const guard = this.ensureStatus('resubmit', ['NEEDS_MORE_INFO']);
    if (guard.isErr()) return guard;
    this.state = { ...this.state, status: 'UNDER_REVIEW', moreInfoRequest: null, updatedAt: now };
    this.record(KYC_SUBMITTED, this.submittedPayload(true), now);
    return ok();
  }

  /** Duyệt hồ sơ: chỉ từ `UNDER_REVIEW` và khi cả 4 bước đã `PASSED`. Phát `KycApproved`. */
  approve(reviewerId: ReviewerId, now: Date): Result<void, KycApproveError> {
    const guard = this.ensureStatus('approve', ['UNDER_REVIEW']);
    if (guard.isErr()) return guard;
    const notPassed = KYC_STEPS.filter((step) => this.state.steps[step].status !== 'PASSED');
    if (notPassed.length > 0) return fail('KYC_STEPS_INCOMPLETE', { steps: notPassed });

    this.state = { ...this.state, status: 'APPROVED', decidedBy: reviewerId, decidedAt: now, updatedAt: now };
    this.record(KYC_APPROVED, { submissionId: this.id, userId: this.state.userId }, now);
    return ok();
  }

  /**
   * Từ chối hồ sơ (bắt buộc có `RejectionReason`): từ `UNDER_REVIEW` hoặc `NEEDS_MORE_INFO`
   * (người dùng không bổ sung). Không cần đủ bước. Phát `KycRejected` (chỉ mang mã lý do, không ghi chú).
   */
  reject(reason: RejectionReason, reviewerId: ReviewerId, now: Date): Result<void, KycTransitionError> {
    const guard = this.ensureStatus('reject', ['UNDER_REVIEW', 'NEEDS_MORE_INFO']);
    if (guard.isErr()) return guard;
    this.state = {
      ...this.state,
      status: 'REJECTED',
      rejectionReason: reason,
      moreInfoRequest: null,
      decidedBy: reviewerId,
      decidedAt: now,
      updatedAt: now,
    };
    const reasonCode: RejectionReasonCode = reason.code;
    this.record(KYC_REJECTED, { submissionId: this.id, userId: this.state.userId, reasonCode }, now);
    return ok();
  }

  toState(): KycSubmissionState {
    return { ...this.state, version: this.version };
  }

  private submittedPayload(resubmission: boolean) {
    return { submissionId: this.id, userId: this.state.userId, resubmission };
  }

  private ensureOpen(): Result<void, KycTransitionError> {
    if (this.isDecided) return fail('KYC_ALREADY_DECIDED', { status: this.state.status });
    return ok();
  }

  private ensureStatus(action: string, allowed: readonly KycStatus[]): Result<void, KycTransitionError> {
    const open = this.ensureOpen();
    if (open.isErr()) return open;
    if (!allowed.includes(this.state.status)) {
      return fail('KYC_INVALID_TRANSITION', { action, status: this.state.status });
    }
    return ok();
  }
}
