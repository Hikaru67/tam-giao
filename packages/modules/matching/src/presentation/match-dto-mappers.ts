import type { MatchScoreDto } from '@tamgiao/contracts';
import type { ProposedMatchView } from '../application/propose-match.js';
import { toScoreView, type MatchScoreView } from '../application/queries/match-display-rules.js';

/** Ảnh presigned → DTO (`expiresAt` ISO). */
export const toPhotoDto = (p: { readonly url: string; readonly expiresAt: Date }) => ({
  url: p.url,
  expiresAt: p.expiresAt.toISOString(),
});

export function toScoreDto(score: MatchScoreView): MatchScoreDto;
export function toScoreDto(score: MatchScoreView | null): MatchScoreDto | null;
export function toScoreDto(score: MatchScoreView | null): MatchScoreDto | null {
  if (score === null) return null;
  return {
    total: score.total,
    pillars: {
      VALUES_FAMILY: score.pillars.VALUES_FAMILY,
      PLANS_TIMING: score.pillars.PLANS_TIMING,
      LIFESTYLE_FINANCE: score.pillars.LIFESTYLE_FINANCE,
    },
  };
}

/** Snapshot điểm vừa chấm lúc đề xuất (luôn đủ 3 trụ cột) → DTO. */
export function snapshotToScoreDto(snapshot: ProposedMatchView['scoreSnapshot']): MatchScoreDto {
  const view = toScoreView(snapshot);
  if (view === null) throw new Error('snapshot điểm đề xuất không được null');
  return toScoreDto(view);
}
