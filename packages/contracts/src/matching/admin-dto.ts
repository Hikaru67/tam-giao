import { z } from 'zod';
import { commonPointCodeSchema, matchPhotoSchema, matchScoreSchema, OPEN_MATCH_STATUS_NAMES } from './dto.js';
import { MATCH_STATUS_NAMES } from './events.js';

/**
 * DTO màn admin "Điều phối mai mối" (BE-S5-06; route ở BE-S5-07): danh sách ứng viên đề xuất cho một người và bảng
 * theo dõi các cặp. Chứa PII (họ tên, ngày sinh qua tuổi, ảnh) — chỉ trả ở API admin, không log.
 */

/** Bảng theo dõi mặc định lọc các trạng thái còn mở. */
export const MATCHES_BOARD_DEFAULT_STATUSES = OPEN_MATCH_STATUS_NAMES;

/** `GET /admin/users/:id/candidates?limit=` — top N (≤ 50) ứng viên kèm điểm. */
export const adminCandidateListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
});
export type AdminCandidateListQuery = z.infer<typeof adminCandidateListQuerySchema>;

export const adminCandidateSchema = z.object({
  userId: z.uuid(),
  score: matchScoreSchema,
  /** Toàn bộ điểm chung (kể cả `SAME_RELIGION` — chuyên viên được xem). */
  commonPoints: z.array(commonPointCodeSchema),
  /** Hồ sơ hiển thị; `null` khi hồ sơ không còn đọc được (đồng bộ trễ). */
  profile: z
    .object({
      fullName: z.string(),
      age: z.number().int(),
      gender: z.enum(['male', 'female']),
      currentCity: z.string(),
      occupation: z.string(),
      education: z.enum(['high_school', 'college', 'bachelor', 'master', 'doctorate']),
      avatar: matchPhotoSchema.nullable(),
    })
    .nullable(),
});
export type AdminCandidateDto = z.infer<typeof adminCandidateSchema>;

/** Điểm giảm dần (hoà → `userId`). */
export const adminCandidateListResponseSchema = z.object({ items: z.array(adminCandidateSchema) });
export type AdminCandidateListResponse = z.infer<typeof adminCandidateListResponseSchema>;

/**
 * `GET /admin/matches` — bảng theo dõi cặp, **sắp hết hạn trước** (`expiresAt` tăng dần, match không có hạn ở cuối;
 * hoà → `matchId`), phân trang cursor.
 * - `status`: danh sách phân tách bằng dấu phẩy; bỏ trống = trạng thái mở (`OFFERED,AWAITING_RESPONSE,DATING,MET`).
 */
export const matchesBoardQuerySchema = z.object({
  status: z
    .string()
    .transform((raw) =>
      raw
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    )
    .pipe(z.array(z.enum(MATCH_STATUS_NAMES)).min(1))
    .optional(),
  /** `nextCursor` của trang trước. */
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export type MatchesBoardQuery = z.infer<typeof matchesBoardQuerySchema>;

export const matchesBoardItemSchema = z.object({
  matchId: z.uuid(),
  status: z.enum(MATCH_STATUS_NAMES),
  /** Hai người theo thứ tự lúc đề xuất. `fullName` `null` khi không đọc được hồ sơ. */
  participants: z.array(
    z.object({ userId: z.uuid(), fullName: z.string().nullable(), accepted: z.boolean() }),
  ),
  score: matchScoreSchema.nullable(),
  expiresAt: z.iso.datetime().nullable(),
  offeredAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  /** Chuyên viên đề xuất. */
  createdBy: z.uuid(),
});
export type MatchesBoardItem = z.infer<typeof matchesBoardItemSchema>;

export const matchesBoardResponseSchema = z.object({
  items: z.array(matchesBoardItemSchema),
  /** `null` khi hết dữ liệu. */
  nextCursor: z.string().nullable(),
});
export type MatchesBoardResponse = z.infer<typeof matchesBoardResponseSchema>;
