import { ok, parseId, type UnitOfWork } from '@tamgiao/kernel';
import type { MatchBetweenSummary, MatchingFacade } from './facade.js';
import type { MatchRepository } from './ports/match-repository.js';

/**
 * Hiện thực `MatchingFacade` (BE-S6-05): tra match gần nhất giữa hai người cho module safety kiểm tra luật "chỉ báo
 * cáo người đang/đã từng ghép với mình". Một transaction ngắn, chỉ đọc.
 */
export class MatchPairLookup implements MatchingFacade {
  constructor(private readonly deps: { readonly uow: UnitOfWork; readonly matches: MatchRepository }) {}

  async findLatestMatchBetween(userA: string, userB: string): Promise<MatchBetweenSummary | null> {
    const a = parseId(userA);
    const b = parseId(userB);
    if (a.isErr() || b.isErr() || a.value === b.value) return null;
    const result = await this.deps.uow.run(async (tx) =>
      ok(await this.deps.matches.findLatestBetween(tx, a.value, b.value)),
    );
    const match = result.unwrapOr(null);
    if (match === null) return null;
    return { matchId: match.id, status: match.status, isOpen: match.isOpen() };
  }
}
