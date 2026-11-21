import { z } from 'zod';

/**
 * DTO màn ghép đôi phía người dùng (BE-S5-06; route ở BE-S5-07): màn 7 "Gợi ý độc quyền 1-1", màn 8 "Chi tiết hồ sơ",
 * màn 9 "Chờ phản hồi". Mọi thời gian là ISO 8601 UTC; `expiresAt` lấy từ server để client đếm ngược.
 */

/** Ba trụ cột tương hợp — khớp `COMPATIBILITY_PILLARS` của domain matching (có test đối chiếu). */
export const MATCH_PILLAR_NAMES = ['VALUES_FAMILY', 'PLANS_TIMING', 'LIFESTYLE_FINANCE'] as const;
export type MatchPillarName = (typeof MATCH_PILLAR_NAMES)[number];

/** Trạng thái match còn mở (người trong cặp còn xem được) — khớp `OPEN_MATCH_STATUSES` của domain. */
export const OPEN_MATCH_STATUS_NAMES = ['OFFERED', 'AWAITING_RESPONSE', 'DATING', 'MET'] as const;

/**
 * Giai đoạn match **nhìn từ người xem** — khớp `USER_MATCH_PHASES` của matching (có test đối chiếu):
 * - `NEEDS_MY_RESPONSE`: `OFFERED`, chưa ai đồng ý (màn 7).
 * - `COUNTERPART_ACCEPTED`: `AWAITING_RESPONSE`, đối phương đã đồng ý, chờ mình (màn 7).
 * - `WAITING_FOR_COUNTERPART`: `AWAITING_RESPONSE`, mình đã đồng ý, chờ đối phương (màn 9 — có thể rút lời ngỏ).
 * - `DATING`: cả hai đồng ý, giai đoạn tìm hiểu độc quyền. `MET`: đã gặp, chờ đánh giá.
 */
export const USER_MATCH_PHASES = [
  'NEEDS_MY_RESPONSE',
  'COUNTERPART_ACCEPTED',
  'WAITING_FOR_COUNTERPART',
  'DATING',
  'MET',
] as const;
export type UserMatchPhase = (typeof USER_MATCH_PHASES)[number];

/** Mã điểm chung (vd `SAME_CITY`, `SHARED_TRAIT_HONEST`) — FE tự dịch; không chứa giá trị cụ thể. */
export const commonPointCodeSchema = z.string().regex(/^[A-Z][A-Z_]*$/);

/** Điểm tương hợp (snapshot lúc chuyên viên đề xuất), số nguyên 0–100. */
export const matchScoreSchema = z.object({
  total: z.number().int().min(0).max(100),
  pillars: z.object({
    VALUES_FAMILY: z.number().int().min(0).max(100),
    PLANS_TIMING: z.number().int().min(0).max(100),
    LIFESTYLE_FINANCE: z.number().int().min(0).max(100),
  }),
});
export type MatchScoreDto = z.infer<typeof matchScoreSchema>;

/** Ảnh hồ sơ qua presigned GET, hết hạn sau `PRESIGNED_URL_TTL_SECONDS`. */
export const matchPhotoSchema = z.object({ url: z.url(), expiresAt: z.iso.datetime() });

const educationSchema = z.enum(['high_school', 'college', 'bachelor', 'master', 'doctorate']);

/**
 * Thông tin cơ bản đối phương trên thẻ gợi ý. `displayName` = tên gọi (bỏ họ — theo thiết kế màn 7/9 "Minh Trang,
 * 28"); không trả họ tên đầy đủ, SĐT, CCCD, thu nhập/tài sản, ảnh eKYC.
 */
export const matchCounterpartSummarySchema = z.object({
  userId: z.uuid(),
  displayName: z.string(),
  age: z.number().int(),
  currentCity: z.string(),
  occupation: z.string(),
  education: educationSchema,
  /** Ảnh đại diện; `null` khi hồ sơ không có ảnh. */
  avatar: matchPhotoSchema.nullable(),
});

/** `GET /me/match` — match đang mở của người dùng. */
export const currentMatchSchema = z.object({
  matchId: z.uuid(),
  status: z.enum(OPEN_MATCH_STATUS_NAMES),
  phase: z.enum(USER_MATCH_PHASES),
  /** Hạn của trạng thái hiện tại (suy nghĩ / chờ phản hồi / tìm hiểu); `null` ở `MET`. */
  expiresAt: z.iso.datetime().nullable(),
  offeredAt: z.iso.datetime(),
  datingStartedAt: z.iso.datetime().nullable(),
  /** `null` nếu match không có snapshot điểm. */
  score: matchScoreSchema.nullable(),
  commonPoints: z.array(commonPointCodeSchema),
  /** Lời nhắn chuyên viên — chỉ người trong cặp nhận được. */
  staffNote: z.string().nullable(),
  /** `null` khi hồ sơ đối phương không còn đọc được. */
  counterpart: matchCounterpartSummarySchema.nullable(),
});
export type CurrentMatchDto = z.infer<typeof currentMatchSchema>;

/** Không có match mở → `{ match: null }` (200, không lỗi). */
export const currentMatchResponseSchema = z.object({ match: currentMatchSchema.nullable() });
export type CurrentMatchResponse = z.infer<typeof currentMatchResponseSchema>;

/** `GET /me/match/profile?matchId=` — bỏ trống `matchId` = match đang mở. */
export const matchProfileQuerySchema = z.object({ matchId: z.uuid().optional() });
export type MatchProfileQuery = z.infer<typeof matchProfileQuerySchema>;

/**
 * Hồ sơ chi tiết đối phương — **chỉ người trong cặp** (người ngoài → `NOT_PARTICIPANT`). Hiện chỉ gồm phần công khai
 * của hồ sơ; phần riêng tư (mở sau bước đồng ý) chờ chốt luật hiển thị (BE-S5-06 Blocker).
 */
export const matchProfileResponseSchema = z.object({
  matchId: z.uuid(),
  status: z.enum(OPEN_MATCH_STATUS_NAMES),
  phase: z.enum(USER_MATCH_PHASES),
  expiresAt: z.iso.datetime().nullable(),
  score: matchScoreSchema.nullable(),
  commonPoints: z.array(commonPointCodeSchema),
  counterpart: z.object({
    userId: z.uuid(),
    displayName: z.string(),
    age: z.number().int(),
    gender: z.enum(['male', 'female']),
    currentCity: z.string(),
    occupation: z.string(),
    education: educationSchema,
    bio: z.string().nullable(),
    interests: z.array(z.string()),
    photos: z.array(matchPhotoSchema),
  }),
});
export type MatchProfileResponse = z.infer<typeof matchProfileResponseSchema>;
