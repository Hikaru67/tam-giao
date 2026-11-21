/**
 * Facade read-only của module profile cho module khác (AGENTS.md A3). Chỉ chứa kiểu + thao tác chỉ-đọc;
 * module khác không đọc bảng `profile.*`.
 */
import type {
  CoreTrait,
  ChildrenPlan,
  Lifestyle,
  Religion,
  FINANCIAL_INDEPENDENCE,
} from '../domain/preferences.js';
import type { EducationLevel, Gender } from '../domain/profile.js';

/** Họ tên + ngày sinh (`YYYY-MM-DD`) người dùng đã khai. Chứa PII — nơi nhận không được log. */
export interface ApplicantIdentity {
  readonly fullName: string;
  readonly birthDate: string;
}

/** Tóm tắt hồ sơ cho màn duyệt eKYC của admin (BE-S3-04). Chứa PII (họ tên) — nơi nhận không được log. */
export interface ApplicantSummary {
  readonly userId: string;
  readonly fullName: string | null;
  readonly occupation: string | null;
}

/** Tiêu chí bạn đời (BE-S2-06) — bản chỉ-đọc cho matching. `not_important` = bỏ qua tiêu chí. */
export interface MatchingCriteria {
  readonly ageMin: number;
  readonly ageMax: number;
  /** `null` = không giới hạn khu vực. */
  readonly areaCity: string | null;
  readonly areaRadiusKm: number | null;
  readonly childrenPlan: ChildrenPlan;
  readonly religion: Religion;
  readonly minEducation: EducationLevel | null;
  readonly lifestyle: Lifestyle;
  readonly financialIndependence: (typeof FINANCIAL_INDEPENDENCE)[number];
  readonly coreTraits: readonly CoreTrait[];
}

/**
 * Dữ liệu matching cần để lọc + chấm điểm (BE-S5-03): hồ sơ đã hoàn tất + tiêu chí bạn đời. Không có họ tên,
 * ảnh, tự bạch hay trường mã hoá (thu nhập, nhà ở, tài sản). Ngày sinh/nơi sống vẫn là dữ liệu cá nhân — nơi
 * nhận không được log. `profileVersion`/`preferencesVersion` tăng mỗi lần lưu → read model chỉ nhận bản mới hơn.
 */
export interface MatchingProfile {
  readonly userId: string;
  readonly gender: Gender;
  /** `YYYY-MM-DD`. */
  readonly birthDate: string;
  readonly currentCity: string;
  readonly education: EducationLevel;
  readonly criteria: MatchingCriteria;
  readonly profileVersion: number;
  readonly preferencesVersion: number;
}

export interface ProfileFacade {
  /**
   * Thông tin định danh đã khai ở hồ sơ — verification dùng đối chiếu với OCR CCCD (BE-S3-03).
   * `null` khi chưa có hồ sơ hoặc chưa điền đủ họ tên / ngày sinh.
   */
  getApplicantIdentity(userId: string): Promise<ApplicantIdentity | null>;
  /**
   * Id người dùng có họ tên hoặc nghề nghiệp chứa `text` (không phân biệt hoa/thường), tối đa `limit` id —
   * hàng chờ duyệt eKYC tìm theo tên/nghề (BE-S3-04).
   */
  searchUserIds(text: string, limit: number): Promise<readonly string[]>;
  /** Tóm tắt (họ tên, nghề nghiệp) của các người dùng đã có hồ sơ; người chưa có hồ sơ bị bỏ qua. */
  getApplicantSummaries(userIds: readonly string[]): Promise<readonly ApplicantSummary[]>;
  /**
   * Hồ sơ + tiêu chí cho matching (BE-S5-03). `null` khi hồ sơ chưa hoàn tất (`COMPLETED`) hoặc chưa có tiêu chí.
   */
  getMatchingProfile(userId: string): Promise<MatchingProfile | null>;
}
