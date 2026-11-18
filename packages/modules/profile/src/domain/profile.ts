import { MAX_PROFILE_PHOTOS, MIN_AGE } from '@tamgiao/contracts/constants';
import { AggregateRoot, fail, ok, type DomainError, type Result } from '@tamgiao/kernel';

/** Hồ sơ dùng chung id với tài khoản identity (1 người dùng — 1 hồ sơ). */
export type ProfileId = string;

// Danh mục giá trị — trùng với `@tamgiao/contracts` (domain không import Zod); `catalog.test.ts` giữ hai nơi khớp nhau.
export const GENDERS = ['male', 'female'] as const;
export type Gender = (typeof GENDERS)[number];
/** Tăng dần theo cấp học. */
export const EDUCATION_LEVELS = ['high_school', 'college', 'bachelor', 'master', 'doctorate'] as const;
export type EducationLevel = (typeof EDUCATION_LEVELS)[number];
export const INCOME_RANGES = ['under_10m', '10m_20m', '20m_40m', '40m_70m', 'over_70m'] as const;
export type IncomeRange = (typeof INCOME_RANGES)[number];
export const HOUSING_TYPES = ['own_home', 'renting', 'with_family', 'other'] as const;
export type HousingType = (typeof HOUSING_TYPES)[number];

export const PROFILE_STATUSES = ['DRAFT', 'COMPLETED'] as const;
export type ProfileStatus = (typeof PROFILE_STATUSES)[number];

/** Nội dung form "Khởi tạo hồ sơ". `null` = chưa điền. */
export interface ProfileData {
  readonly fullName: string | null;
  /** `YYYY-MM-DD`. */
  readonly birthDate: string | null;
  readonly gender: Gender | null;
  readonly hometown: string | null;
  readonly currentCity: string | null;
  readonly education: EducationLevel | null;
  readonly occupation: string | null;
  readonly bio: string | null;
  readonly interests: readonly string[];
  /** Riêng tư — repository mã hoá qua `Encryptor`. */
  readonly incomeRange: IncomeRange | null;
  readonly housing: HousingType | null;
  readonly assets: string | null;
  /** Key ảnh (đã xác nhận quyền sở hữu); phần tử đầu là ảnh đại diện. */
  readonly photos: readonly string[];
}

export const EMPTY_PROFILE_DATA: ProfileData = {
  fullName: null,
  birthDate: null,
  gender: null,
  hometown: null,
  currentCity: null,
  education: null,
  occupation: null,
  bio: null,
  interests: [],
  incomeRange: null,
  housing: null,
  assets: null,
  photos: [],
};

/** Trường bắt buộc để bấm "Tiếp tục". Thông tin riêng tư, quê quán, tự bạch, sở thích là tuỳ chọn. */
export const REQUIRED_FIELDS = [
  'fullName',
  'birthDate',
  'gender',
  'currentCity',
  'education',
  'occupation',
  'photos',
] as const satisfies readonly (keyof ProfileData)[];

export interface ProfileState {
  readonly userId: ProfileId;
  readonly data: ProfileData;
  readonly status: ProfileStatus;
  readonly completedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly version: number;
}

export type ProfileError = DomainError<
  'AGE_NOT_ELIGIBLE' | 'TOO_MANY_PHOTOS' | 'PROFILE_INCOMPLETE' | 'VALIDATION_FAILED'
>;

/** Múi giờ Việt Nam (UTC+7, không có giờ mùa hè) — tuổi tính theo ngày lịch tại Việt Nam. */
const VN_OFFSET_MS = 7 * 3_600_000;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Tuổi tròn tại thời điểm `now` (theo ngày lịch Việt Nam); `null` nếu ngày không hợp lệ. */
export function ageAt(birthDate: string, now: Date): number | null {
  const m = DATE_PATTERN.exec(birthDate);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;

  const today = new Date(now.getTime() + VN_OFFSET_MS);
  const [ty, tm, td] = [today.getUTCFullYear(), today.getUTCMonth() + 1, today.getUTCDate()];
  let age = ty - y;
  if (tm < mo || (tm === mo && td < d)) age -= 1;
  return age;
}

const isMissing = (data: ProfileData, field: (typeof REQUIRED_FIELDS)[number]): boolean => {
  const value = data[field];
  return value === null || (Array.isArray(value) && value.length === 0);
};

export class Profile extends AggregateRoot<ProfileId> {
  protected readonly aggregateType = 'Profile';

  private constructor(
    private state: Omit<ProfileState, 'version'>,
    version: number,
  ) {
    super(state.userId, version);
  }

  static start(userId: ProfileId, now: Date): Profile {
    return new Profile(
      {
        userId,
        data: EMPTY_PROFILE_DATA,
        status: 'DRAFT',
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      },
      0,
    );
  }

  static restore(state: ProfileState): Profile {
    const { version, ...rest } = state;
    return new Profile(rest, version);
  }

  get status(): ProfileStatus {
    return this.state.status;
  }

  /**
   * Ghi đè toàn bộ form. `submit = false` ("Lưu tạm") chấp nhận form dở dang, nhưng trường đã điền vẫn phải
   * hợp lệ (tuổi, số ảnh). `submit = true` ("Tiếp tục") còn đòi đủ `REQUIRED_FIELDS`; lần đầu hoàn tất phát
   * `ProfileCompleted`. Hồ sơ đã hoàn tất thì luôn phải giữ đủ trường bắt buộc (không quay lại nháp).
   */
  update(data: ProfileData, options: { readonly submit: boolean }, now: Date): Result<void, ProfileError> {
    if (data.birthDate !== null) {
      const age = ageAt(data.birthDate, now);
      if (age === null) return fail('VALIDATION_FAILED', { field: 'birthDate' });
      if (age < MIN_AGE) return fail('AGE_NOT_ELIGIBLE', { minAge: MIN_AGE });
    }
    if (data.photos.length > MAX_PROFILE_PHOTOS) {
      return fail('TOO_MANY_PHOTOS', { max: MAX_PROFILE_PHOTOS });
    }
    if (new Set(data.photos).size !== data.photos.length)
      return fail('VALIDATION_FAILED', { field: 'photos' });

    const mustBeComplete = options.submit || this.state.status === 'COMPLETED';
    const missing = REQUIRED_FIELDS.filter((f) => isMissing(data, f));
    if (mustBeComplete && missing.length > 0) return fail('PROFILE_INCOMPLETE', { missing });

    const completing = options.submit && this.state.status === 'DRAFT';
    this.state = {
      ...this.state,
      data: { ...data, interests: [...new Set(data.interests)] },
      status: completing ? 'COMPLETED' : this.state.status,
      completedAt: completing ? now : this.state.completedAt,
      updatedAt: now,
    };
    if (completing) this.record('ProfileCompleted', { userId: this.id }, now);
    return ok();
  }

  toState(): ProfileState {
    return { ...this.state, version: this.version };
  }
}
