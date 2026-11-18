import { z } from 'zod';

export const GENDERS = ['male', 'female'] as const;
/** Thứ tự tăng dần — tiêu chí "học vấn tối thiểu" (BE-S2-06) so sánh theo thứ tự này. */
export const EDUCATION_LEVELS = ['high_school', 'college', 'bachelor', 'master', 'doctorate'] as const;
export const INCOME_RANGES = ['under_10m', '10m_20m', '20m_40m', '40m_70m', 'over_70m'] as const;
export const HOUSING_TYPES = ['own_home', 'renting', 'with_family', 'other'] as const;

export const PROFILE_BIO_MAX_LENGTH = 800;
export const PROFILE_INTERESTS_MAX = 20;

const shortText = z.string().trim().min(1).max(100);

/** Ngày dạng `YYYY-MM-DD` (lịch Gregory, kiểm tra ngày có thật). */
export const isoDateSchema = z.iso.date();

/**
 * `PUT /me/profile` — gửi **toàn bộ** form hiện tại (trường bỏ trống = chưa điền).
 * `submit: false` = "Lưu tạm"; `submit: true` = "Tiếp tục" (bắt buộc đủ trường, lỗi `PROFILE_INCOMPLETE`).
 */
export const updateProfileBodySchema = z.object({
  fullName: shortText.nullish(),
  birthDate: isoDateSchema.nullish(),
  gender: z.enum(GENDERS).nullish(),
  hometown: shortText.nullish(),
  currentCity: shortText.nullish(),
  education: z.enum(EDUCATION_LEVELS).nullish(),
  occupation: shortText.nullish(),
  bio: z.string().trim().max(PROFILE_BIO_MAX_LENGTH).nullish(),
  interests: z.array(z.string().trim().min(1).max(30)).max(PROFILE_INTERESTS_MAX).optional(),
  /** Riêng tư — lưu mã hoá, chỉ chính chủ (và chuyên viên có quyền) xem. */
  incomeRange: z.enum(INCOME_RANGES).nullish(),
  housing: z.enum(HOUSING_TYPES).nullish(),
  assets: z.string().trim().max(500).nullish(),
  /**
   * Key ảnh từ `POST /uploads` (purpose `profile_photo`), ảnh đầu tiên là ảnh đại diện.
   * Tối đa `MAX_PROFILE_PHOTOS` — vượt quá trả `TOO_MANY_PHOTOS`.
   */
  photos: z.array(z.string().min(1).max(300)).max(20).optional(),
  submit: z.boolean().optional(),
});
export type UpdateProfileBody = z.infer<typeof updateProfileBodySchema>;

export const profilePhotoSchema = z.object({
  key: z.string(),
  /** Presigned GET, hết hạn sau `PRESIGNED_URL_TTL_SECONDS`. */
  url: z.url(),
});

export const profileResponseSchema = z.object({
  userId: z.uuid(),
  status: z.enum(['DRAFT', 'COMPLETED']),
  fullName: z.string().nullable(),
  birthDate: z.string().nullable(),
  gender: z.enum(GENDERS).nullable(),
  hometown: z.string().nullable(),
  currentCity: z.string().nullable(),
  education: z.enum(EDUCATION_LEVELS).nullable(),
  occupation: z.string().nullable(),
  bio: z.string().nullable(),
  interests: z.array(z.string()),
  incomeRange: z.enum(INCOME_RANGES).nullable(),
  housing: z.enum(HOUSING_TYPES).nullable(),
  assets: z.string().nullable(),
  photos: z.array(profilePhotoSchema),
  completedAt: z.iso.datetime().nullable(),
  updatedAt: z.iso.datetime(),
});
export type ProfileResponse = z.infer<typeof profileResponseSchema>;

/**
 * Bước onboarding để app điều hướng: `PROFILE` → `CRITERIA` → `VERIFICATION` → `UNDER_REVIEW` → `ACTIVE`,
 * hoặc `REJECTED` khi hồ sơ xác thực bị từ chối (chi tiết lý do ở `GET /me/kyc`).
 * Ba bước cuối lấy từ facade verification (BE-S3-07); điều kiện đã thanh toán nối ở BE-S4-03.
 */
export const ONBOARDING_STEPS = [
  'PROFILE',
  'CRITERIA',
  'VERIFICATION',
  'UNDER_REVIEW',
  'ACTIVE',
  'REJECTED',
] as const;

export const meResponseSchema = z.object({
  userId: z.uuid(),
  onboardingStep: z.enum(ONBOARDING_STEPS),
  profile: z
    .object({
      fullName: z.string().nullable(),
      gender: z.enum(GENDERS).nullable(),
      /** Tuổi tròn theo ngày lịch Việt Nam; `null` nếu chưa nhập ngày sinh. */
      age: z.number().int().nullable(),
      currentCity: z.string().nullable(),
      /** Presigned GET của ảnh đại diện (ảnh đầu tiên). */
      avatarUrl: z.url().nullable(),
    })
    .nullable(),
  /**
   * Huy hiệu hiển thị. Hiện chỉ có huy hiệu xác thực (`VERIFICATION_BADGES` của `@tamgiao/contracts/verification`:
   * `CCCD_VERIFIED`, `SINGLE_VERIFIED`, `INTERVIEWED`); để `string` để module khác có thể bổ sung huy hiệu.
   */
  badges: z.array(z.string()),
});
export type MeResponse = z.infer<typeof meResponseSchema>;
