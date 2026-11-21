import type { DisplayPhoto, MatchDisplayProfile } from '@tamgiao/module-profile/facade';
import { ageAt } from '../../domain/candidate-profile.js';
import type { CommonPointCode } from '../../domain/compatibility-scorer.js';
import type { CompatibilityPillar } from '../../domain/compatibility-weights.js';
import type { MatchScoreSnapshot, MatchStatus, MatchUserId, OpenMatchStatus } from '../../domain/match.js';

/**
 * Luật hiển thị màn ghép đôi phía người dùng (BE-S5-06) — hàm thuần, test ở `match-queries.test.ts`.
 * Nguồn: thiết kế màn 7 "Gợi ý độc quyền 1-1" (`design/stitch/g_i_gh_p_i_c_quy_n`), màn 8 "Chi tiết hồ sơ"
 * (`chi_ti_t_h_s_quan_ni_m_h_n_nh_n`), màn 9 "Chờ phản hồi" (`ch_ph_n_h_i_gh_p_i_1_1`); trường riêng tư của hồ sơ
 * (thu nhập, nhà ở, tài sản) "chỉ chính chủ (và chuyên viên có quyền) xem" (`@tamgiao/contracts` profile DTO).
 */

/** Giai đoạn match nhìn từ người xem — khớp `USER_MATCH_PHASES` của contracts. */
export const USER_MATCH_PHASES = [
  'NEEDS_MY_RESPONSE',
  'COUNTERPART_ACCEPTED',
  'WAITING_FOR_COUNTERPART',
  'DATING',
  'MET',
] as const;
export type UserMatchPhase = (typeof USER_MATCH_PHASES)[number];

/**
 * Giai đoạn của `viewer` trong match mở; `null` khi match đã đóng. `AWAITING_RESPONSE`: mình đã đồng ý →
 * `WAITING_FOR_COUNTERPART` (màn 9), ngược lại đối phương đã đồng ý → `COUNTERPART_ACCEPTED`.
 */
export function phaseFor(
  match: { readonly status: MatchStatus; readonly acceptedBy: readonly MatchUserId[] },
  viewer: MatchUserId,
): UserMatchPhase | null {
  switch (match.status) {
    case 'OFFERED':
      return 'NEEDS_MY_RESPONSE';
    case 'AWAITING_RESPONSE':
      return match.acceptedBy.includes(viewer) ? 'WAITING_FOR_COUNTERPART' : 'COUNTERPART_ACCEPTED';
    case 'DATING':
      return 'DATING';
    case 'MET':
      return 'MET';
    default:
      return null;
  }
}

export const isOpenStatus = (status: MatchStatus): status is OpenMatchStatus =>
  status === 'OFFERED' || status === 'AWAITING_RESPONSE' || status === 'DATING' || status === 'MET';

/**
 * Tên gọi hiển thị cho đối phương: bỏ họ (từ đầu) khi họ tên có từ 3 từ trở lên, giữ "đệm + tên" — đúng cách thiết
 * kế màn 7/8/9 hiển thị ("Minh Trang, 28", "Quốc Huy, 31"). Họ tên 1–2 từ giữ nguyên. Không trả họ tên đầy đủ cho
 * người dùng app.
 */
export function displayNameOf(fullName: string): string {
  const words = fullName
    .trim()
    .split(/\s+/u)
    .filter((w) => w.length > 0);
  return words.length >= 3 ? words.slice(-2).join(' ') : words.join(' ');
}

/**
 * Điểm chung trả cho **người dùng app**: bỏ `SAME_RELIGION` vì tôn giáo là dữ liệu cá nhân nhạy cảm (Nghị định
 * 13/2023, Điều 2) — mã này cho người xem suy ra tôn giáo của đối phương. Chuyên viên vẫn thấy đủ.
 */
export function userFacingCommonPoints(codes: readonly CommonPointCode[]): CommonPointCode[] {
  return codes.filter((c) => c !== 'SAME_RELIGION');
}

export interface MatchScoreView {
  readonly total: number;
  readonly pillars: Readonly<Record<CompatibilityPillar, number>>;
}

/** Snapshot (key tự do trong jsonb) → đủ 3 trụ cột. Thiếu trụ cột là lỗi dữ liệu → throw. */
export function toScoreView(snapshot: MatchScoreSnapshot | null): MatchScoreView | null {
  if (snapshot === null) return null;
  const pillar = (name: CompatibilityPillar): number => {
    const value = snapshot.pillars[name];
    if (value === undefined) throw new Error(`score_snapshot thiếu trụ cột ${name}`);
    return value;
  };
  return {
    total: snapshot.total,
    pillars: {
      VALUES_FAMILY: pillar('VALUES_FAMILY'),
      PLANS_TIMING: pillar('PLANS_TIMING'),
      LIFESTYLE_FINANCE: pillar('LIFESTYLE_FINANCE'),
    },
  };
}

/** Thông tin cơ bản đối phương trên thẻ gợi ý (màn 7, 9). */
export interface CounterpartSummaryView {
  readonly userId: string;
  readonly displayName: string;
  readonly age: number;
  readonly currentCity: string;
  readonly occupation: string;
  readonly education: MatchDisplayProfile['education'];
  readonly avatar: DisplayPhoto | null;
}

export function toCounterpartSummary(profile: MatchDisplayProfile, now: Date): CounterpartSummaryView {
  return {
    userId: profile.userId,
    displayName: displayNameOf(profile.fullName),
    age: ageAt(profile.birthDate, now),
    currentCity: profile.currentCity,
    occupation: profile.occupation,
    education: profile.education,
    avatar: profile.photos[0] ?? null,
  };
}

/**
 * Hồ sơ chi tiết đối phương (màn 8) — **chỉ phần công khai**: tên gọi, tuổi, giới tính, thành phố, nghề nghiệp,
 * học vấn, tự bạch, sở thích, ảnh hồ sơ. Không bao giờ có SĐT, CCCD, thu nhập/nhà ở/tài sản, ảnh eKYC. Phần riêng tư
 * "mở sau bước đồng ý" chưa có luật nguồn → chưa trả (Blocker BE-S5-06).
 */
export interface CounterpartProfileView {
  readonly userId: string;
  readonly displayName: string;
  readonly age: number;
  readonly gender: MatchDisplayProfile['gender'];
  readonly currentCity: string;
  readonly occupation: string;
  readonly education: MatchDisplayProfile['education'];
  readonly bio: string | null;
  readonly interests: readonly string[];
  readonly photos: readonly DisplayPhoto[];
}

export function toCounterpartProfile(profile: MatchDisplayProfile, now: Date): CounterpartProfileView {
  return {
    userId: profile.userId,
    displayName: displayNameOf(profile.fullName),
    age: ageAt(profile.birthDate, now),
    gender: profile.gender,
    currentCity: profile.currentCity,
    occupation: profile.occupation,
    education: profile.education,
    bio: profile.bio,
    interests: [...profile.interests],
    photos: [...profile.photos],
  };
}
