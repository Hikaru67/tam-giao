import { SAFETY_RESPONSE_SLA_MINUTES } from '@tamgiao/contracts/constants';
import {
  AggregateRoot,
  addDuration,
  fail,
  ok,
  type DomainError,
  type Id,
  type Result,
} from '@tamgiao/kernel';
import { REPORT_FILED, REPORT_STATUS_CHANGED } from './report-events.js';

export type ReportId = Id<'Report'>;
/** Id tài khoản app (module identity) — safety chỉ giữ tham chiếu (A3). */
export type ReportUserId = string;

/** Loại vi phạm (màn "Báo cáo Vi phạm"). Khớp `REPORT_CATEGORY_NAMES` ở contracts (có test đối chiếu). */
export const REPORT_CATEGORIES = [
  'MARITAL_FRAUD',
  'FINANCIAL_SCAM',
  'HARASSMENT',
  'NO_SHOW_DISRESPECT',
] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

/** Mức độ nghiêm trọng, tăng dần (hàng chờ admin BE-S6-06 sắp theo mức này + `dueAt`). */
export const REPORT_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type ReportSeverity = (typeof REPORT_SEVERITIES)[number];

export const REPORT_STATUSES = ['OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

/** Độ dài tối đa mô tả (ký tự, sau khi trim). Khớp `REPORT_DESCRIPTION_MAX_LENGTH` ở contracts. */
export const REPORT_DESCRIPTION_MAX_LENGTH = 1000;
/** Số ảnh bằng chứng tối đa (sau khi bỏ trùng). Khớp `REPORT_MAX_EVIDENCE` ở contracts. */
export const REPORT_MAX_EVIDENCE = 5;

/**
 * Mức độ mặc định theo loại vi phạm — theo nhãn trên màn thiết kế ("Gian dối tình trạng hôn nhân: Cực kỳ nghiêm
 * trọng", "Gạ gẫm chuyển tiền: Cảnh báo đỏ"); hai loại còn lại không có nhãn → thấp hơn. Chuyên viên xem xét lại ở
 * BE-S6-06. Cấu hình tại đây (luật domain), không ở tầng khác.
 */
export const REPORT_SEVERITY_BY_CATEGORY: Readonly<Record<ReportCategory, ReportSeverity>> = {
  MARITAL_FRAUD: 'CRITICAL',
  FINANCIAL_SCAM: 'HIGH',
  HARASSMENT: 'MEDIUM',
  NO_SHOW_DISRESPECT: 'LOW',
};

export type ReportFileError = DomainError<
  'REPORT_TARGET_INVALID' | 'REPORT_DESCRIPTION_TOO_LONG' | 'REPORT_EVIDENCE_TOO_MANY'
>;
export type ReportTransitionError = DomainError<'REPORT_INVALID_TRANSITION'>;

export interface ReportState {
  readonly id: ReportId;
  readonly reporterId: ReportUserId;
  readonly reportedUserId: ReportUserId;
  /** Match gần nhất giữa hai người lúc báo cáo (bị khoá qua event `ReportFiled`). */
  readonly matchId: string;
  readonly category: ReportCategory;
  readonly severity: ReportSeverity;
  /** Mô tả diễn biến — văn bản tự do, có thể chứa PII: KHÔNG log, KHÔNG đưa vào event. `null` = không mô tả. */
  readonly description: string | null;
  /** Key ảnh bằng chứng (bucket private, mục đích `report_evidence`) của người báo cáo — không đưa vào event. */
  readonly evidenceKeys: readonly string[];
  /** Người báo cáo chọn "Chuyên viên can thiệp khẩn cấp". */
  readonly urgent: boolean;
  /** Hạn chuyên viên phản hồi = lúc báo cáo + `SAFETY_RESPONSE_SLA_MINUTES` khi `urgent`, ngược lại `null`. */
  readonly dueAt: Date | null;
  readonly status: ReportStatus;
  readonly createdAt: Date;
  /** Lúc vào `RESOLVED | DISMISSED`. */
  readonly closedAt: Date | null;
  readonly updatedAt: Date;
  readonly version: number;
}

type MutableState = Omit<ReportState, 'version'>;

export interface FileReportInput {
  readonly id: ReportId;
  readonly reporterId: ReportUserId;
  readonly reportedUserId: ReportUserId;
  readonly matchId: string;
  readonly category: ReportCategory;
  readonly description?: string | null;
  readonly evidenceKeys?: readonly string[];
  readonly urgent?: boolean;
}

/**
 * Aggregate `Report` — báo cáo vi phạm của một người dùng về người đang/đã từng ghép với mình (BE-S6-05).
 *
 * `file` (tạo `OPEN`, phát `ReportFiled`), kiểm tra theo thứ tự:
 * - tự báo cáo chính mình → `REPORT_TARGET_INVALID {reason: SELF}` (luật "đã từng ghép" do use case kiểm tra qua
 *   facade matching vì cần dữ liệu module khác);
 * - mô tả trim, rỗng → `null`; dài hơn `REPORT_DESCRIPTION_MAX_LENGTH` → `REPORT_DESCRIPTION_TOO_LONG`;
 * - key bằng chứng trim + bỏ trùng (giữ thứ tự), quá `REPORT_MAX_EVIDENCE` → `REPORT_EVIDENCE_TOO_MANY`.
 * Mức độ suy ra từ loại (`REPORT_SEVERITY_BY_CATEGORY`); `urgent` → `dueAt = now + SAFETY_RESPONSE_SLA_MINUTES`.
 *
 * Trạng thái xử lý (thao tác của chuyên viên, route ở BE-S6-06), mỗi bước phát `ReportStatusChanged`:
 * - OPEN      → startReview → IN_REVIEW; dismiss → DISMISSED
 * - IN_REVIEW → resolve → RESOLVED; dismiss → DISMISSED
 * - RESOLVED | DISMISSED: trạng thái cuối — mọi thao tác → `REPORT_INVALID_TRANSITION`.
 * (`resolve` từ OPEN không được: phải nhận xử lý trước.) Lỗi không đổi state, không phát event.
 */
export class Report extends AggregateRoot<ReportId> {
  protected readonly aggregateType = 'Report';

  private constructor(
    private state: MutableState,
    version: number,
  ) {
    super(state.id, version);
  }

  static file(input: FileReportInput, now: Date): Result<Report, ReportFileError> {
    if (input.reporterId.toLowerCase() === input.reportedUserId.toLowerCase()) {
      return fail('REPORT_TARGET_INVALID', { reason: 'SELF' });
    }

    const trimmed = input.description?.trim() ?? '';
    if (trimmed.length > REPORT_DESCRIPTION_MAX_LENGTH) {
      return fail('REPORT_DESCRIPTION_TOO_LONG', { maxLength: REPORT_DESCRIPTION_MAX_LENGTH });
    }

    const evidenceKeys = [
      ...new Set((input.evidenceKeys ?? []).map((k) => k.trim()).filter((k) => k.length > 0)),
    ];
    if (evidenceKeys.length > REPORT_MAX_EVIDENCE) {
      return fail('REPORT_EVIDENCE_TOO_MANY', { max: REPORT_MAX_EVIDENCE });
    }

    const urgent = input.urgent ?? false;
    const dueAt = urgent ? addDuration(now, { minutes: SAFETY_RESPONSE_SLA_MINUTES }) : null;
    const severity = REPORT_SEVERITY_BY_CATEGORY[input.category];
    const report = new Report(
      {
        id: input.id,
        reporterId: input.reporterId,
        reportedUserId: input.reportedUserId,
        matchId: input.matchId,
        category: input.category,
        severity,
        description: trimmed.length > 0 ? trimmed : null,
        evidenceKeys,
        urgent,
        dueAt,
        status: 'OPEN',
        createdAt: now,
        closedAt: null,
        updatedAt: now,
      },
      0,
    );
    report.record(
      REPORT_FILED,
      {
        reportId: report.id,
        reporterId: input.reporterId,
        reportedUserId: input.reportedUserId,
        matchId: input.matchId,
        category: input.category,
        severity,
        urgent,
        dueAt: dueAt?.toISOString() ?? null,
      },
      now,
    );
    return ok(report);
  }

  static restore(state: ReportState): Report {
    const { version, ...rest } = state;
    return new Report({ ...rest, evidenceKeys: [...rest.evidenceKeys] }, version);
  }

  get status(): ReportStatus {
    return this.state.status;
  }

  get category(): ReportCategory {
    return this.state.category;
  }

  get severity(): ReportSeverity {
    return this.state.severity;
  }

  get urgent(): boolean {
    return this.state.urgent;
  }

  get dueAt(): Date | null {
    return this.state.dueAt;
  }

  get createdAt(): Date {
    return this.state.createdAt;
  }

  /** Chuyên viên nhận xử lý: OPEN → IN_REVIEW. */
  startReview(now: Date): Result<void, ReportTransitionError> {
    if (this.state.status !== 'OPEN') return this.invalid('startReview');
    this.transition('IN_REVIEW', now);
    return ok();
  }

  /** Kết luận vi phạm: IN_REVIEW → RESOLVED. */
  resolve(now: Date): Result<void, ReportTransitionError> {
    if (this.state.status !== 'IN_REVIEW') return this.invalid('resolve');
    this.transition('RESOLVED', now);
    return ok();
  }

  /** Bác bỏ báo cáo: OPEN | IN_REVIEW → DISMISSED. */
  dismiss(now: Date): Result<void, ReportTransitionError> {
    const { status } = this.state;
    if (status !== 'OPEN' && status !== 'IN_REVIEW') return this.invalid('dismiss');
    this.transition('DISMISSED', now);
    return ok();
  }

  toState(): ReportState {
    return { ...this.state, version: this.version };
  }

  private invalid(action: string): Result<never, ReportTransitionError> {
    return fail('REPORT_INVALID_TRANSITION', { action, status: this.state.status });
  }

  private transition(to: ReportStatus, now: Date): void {
    const fromStatus = this.state.status;
    const closed = to === 'RESOLVED' || to === 'DISMISSED';
    this.state = { ...this.state, status: to, closedAt: closed ? now : null, updatedAt: now };
    this.record(REPORT_STATUS_CHANGED, { reportId: this.id, fromStatus, toStatus: to }, now);
  }
}
