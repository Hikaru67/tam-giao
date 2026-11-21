import { z } from 'zod';
import { matchScoreSchema } from './dto.js';
import { MATCH_STATUS_NAMES } from './events.js';

/**
 * DTO body/response của các lệnh ghép đôi qua HTTP (BE-S5-07): nút phản hồi lời ngỏ của người dùng
 * (`POST /me/match/accept|decline|withdraw`) và chuyên viên đề xuất ghép đôi (`POST /admin/matches`).
 */

/** Độ dài tối đa lý do "Bỏ qua" (văn bản tự do — có thể chứa PII, không log). */
export const MATCH_DECLINE_REASON_MAX_LENGTH = 500;
/** Độ dài tối đa lời nhắn / ghi chú chuyên viên khi đề xuất (có thể chứa PII, không log/event/audit). */
export const MATCH_STAFF_NOTE_MAX_LENGTH = 1000;

/** `POST /me/match/decline` — body tuỳ chọn; bỏ trống body tương đương `{}`. */
export const declineMatchBodySchema = z.object({
  reason: z.string().max(MATCH_DECLINE_REASON_MAX_LENGTH).nullish(),
});
export type DeclineMatchBody = z.infer<typeof declineMatchBodySchema>;

/**
 * Kết quả `POST /me/match/accept|decline|withdraw`: trạng thái mới + hạn mới (client đếm ngược); `expiresAt` `null`
 * khi trạng thái mới không có hạn (vd `DECLINED`).
 */
export const matchResponseResultSchema = z.object({
  matchId: z.uuid(),
  status: z.enum(MATCH_STATUS_NAMES),
  expiresAt: z.iso.datetime().nullable(),
});
export type MatchResponseResult = z.infer<typeof matchResponseResultSchema>;

/** `POST /admin/matches` — chuyên viên (permission `match:propose`) đề xuất ghép đôi hai người. */
export const proposeMatchBodySchema = z.object({
  userAId: z.uuid(),
  userBId: z.uuid(),
  staffNote: z.string().max(MATCH_STAFF_NOTE_MAX_LENGTH).nullish(),
});
export type ProposeMatchBody = z.infer<typeof proposeMatchBodySchema>;

/** 201 — match `OFFERED`, hạn suy nghĩ `expiresAt` (`OFFER_TTL_HOURS`). */
export const proposeMatchResponseSchema = z.object({
  matchId: z.uuid(),
  status: z.enum(MATCH_STATUS_NAMES),
  participantIds: z.tuple([z.uuid(), z.uuid()]),
  score: matchScoreSchema,
  expiresAt: z.iso.datetime(),
});
export type ProposeMatchResponse = z.infer<typeof proposeMatchResponseSchema>;
