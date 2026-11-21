import {
  err,
  fail,
  newId,
  ok,
  parseId,
  type Clock,
  type DomainError,
  type Result,
  type Scheduler,
  type UnitOfWork,
} from '@tamgiao/kernel';
import type { AuditLogger } from '@tamgiao/module-identity/facade';
import type { VerificationFacade } from '@tamgiao/module-verification/facade';
import { passesHardFilters } from '../domain/candidate-hard-filter.js';
import { CompatibilityScorer } from '../domain/compatibility-scorer.js';
import { Match, type MatchScoreSnapshot, type MatchStatus } from '../domain/match.js';
import type { ProposeMatchErrorCode } from '../domain/propose-errors.js';
import { matchExpiryJob } from './match-expiry.js';
import type { ActiveSlotRepository } from './ports/active-slot-repository.js';
import type { CandidateProfileReader } from './ports/candidate-profile-reader.js';
import type { CooldownRepository } from './ports/cooldown-repository.js';
import type { MatchRepository } from './ports/match-repository.js';
import type { PairHistoryRepository } from './ports/pair-history-repository.js';

export const MATCH_AUDIT_TARGET_TYPE = 'match';
export const MATCH_PROPOSE_AUDIT_ACTION = 'match.propose';

export interface ProposeMatchCommand {
  /** Id chuyên viên (admin) đã qua guard `requireAdmin('match:propose')`. */
  readonly staffId: string;
  readonly userAId: string;
  readonly userBId: string;
  /** Lời nhắn / ghi chú chuyên viên — có thể chứa PII: chỉ lưu ở `matching.matches`, không vào event/audit/log. */
  readonly staffNote: string | null;
  /** IP client cho audit log. */
  readonly ip?: string | null;
}

export interface ProposedMatchView {
  readonly matchId: string;
  readonly status: MatchStatus;
  readonly participantIds: readonly [string, string];
  readonly scoreSnapshot: MatchScoreSnapshot;
  readonly expiresAt: Date;
}

export type ProposeMatchError = DomainError<
  | ProposeMatchErrorCode
  | 'INVALID_ID'
  | 'CANDIDATE_PROFILE_NOT_FOUND'
  | 'USER_COOLING_DOWN'
  | 'PAIR_ALREADY_TRIED'
  | 'USER_BUSY'
>;

export interface ProposeMatchDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly verification: Pick<VerificationFacade, 'isVerified'>;
  readonly profiles: CandidateProfileReader;
  readonly cooldowns: CooldownRepository;
  readonly pairHistory: PairHistoryRepository;
  readonly activeSlots: ActiveSlotRepository;
  readonly matches: MatchRepository;
  readonly scheduler: Scheduler;
  readonly auditLogger: AuditLogger;
  readonly scorer?: CompatibilityScorer;
}

/**
 * Chuyên viên đề xuất ghép đôi — nút "Phê duyệt & Gửi đề xuất ghép đôi" (BE-S5-04, permission `match:propose`).
 *
 * Thứ tự kiểm tra: cùng một người → `MATCH_SAME_USER`; id sai → `INVALID_ID`; chưa xác thực (facade verification,
 * nguồn chân lý, đọc ngoài transaction) → `USER_NOT_VERIFIED`; rồi trong **một transaction**: chưa có hồ sơ đồng bộ ở
 * read model → `CANDIDATE_PROFILE_NOT_FOUND`; vi phạm bộ lọc cứng hai chiều → `HARD_FILTER_MISMATCH`; đang cooldown →
 * `USER_COOLING_DOWN`; cặp đã thử → `PAIR_ALREADY_TRIED`; chấm điểm `CompatibilityScorer` → `Match.offer` →
 * `activeSlots.claim` (bận → `USER_BUSY`, rollback: không match, không job) → `matches.save` (+ `match_events` +
 * outbox `MatchOffered`) → hẹn job hết hạn `matching.expire-match` → audit `match.propose`. Tất cả commit/rollback
 * cùng nhau; hai chuyên viên đề xuất đồng thời cho cùng một người → ràng buộc `active_slots` cho đúng 1 thành công.
 */
export class ProposeMatch {
  private readonly scorer: CompatibilityScorer;

  constructor(private readonly deps: ProposeMatchDeps) {
    this.scorer = deps.scorer ?? new CompatibilityScorer();
  }

  async execute(cmd: ProposeMatchCommand): Promise<Result<ProposedMatchView, ProposeMatchError>> {
    const userA = parseId<'User'>(cmd.userAId);
    const userB = parseId<'User'>(cmd.userBId);
    if (userA.isOk() && userB.isOk() && userA.value === userB.value) return fail('MATCH_SAME_USER');
    if (userA.isErr() || userB.isErr()) return fail('INVALID_ID');
    const participants = [userA.value, userB.value] as const;

    const verified = await Promise.all(participants.map((id) => this.deps.verification.isVerified(id)));
    const unverified = participants.filter((_, i) => !verified[i]);
    if (unverified.length > 0) return fail('USER_NOT_VERIFIED', { userIds: unverified });

    const staffNote = cmd.staffNote?.trim() ? cmd.staffNote.trim() : null;

    return this.deps.uow.run(async (tx) => {
      const now = this.deps.clock.now();
      const profiles = await this.deps.profiles.findSynced(tx, participants);
      const missing = participants.filter((id) => !profiles.has(id));
      const profileA = profiles.get(participants[0]);
      const profileB = profiles.get(participants[1]);
      if (missing.length > 0 || profileA === undefined || profileB === undefined) {
        return fail('CANDIDATE_PROFILE_NOT_FOUND', { userIds: missing });
      }
      if (!passesHardFilters(profileA, profileB, now)) return fail('HARD_FILTER_MISMATCH');

      const cooling: string[] = [];
      for (const id of participants) {
        if (await this.deps.cooldowns.isCooling(tx, id, now)) cooling.push(id);
      }
      if (cooling.length > 0) return fail('USER_COOLING_DOWN', { userIds: cooling });
      if (await this.deps.pairHistory.hasTried(tx, participants[0], participants[1])) {
        return fail('PAIR_ALREADY_TRIED');
      }

      const score = this.scorer.score(profileA, profileB, now);
      const scoreSnapshot: MatchScoreSnapshot = { total: score.total, pillars: { ...score.pillars } };
      const match = Match.offer(
        { id: newId<'Match'>(), participants, createdBy: cmd.staffId, scoreSnapshot, staffNote },
        now,
      );

      // Độc quyền 1-1 (A10): claim trước mọi ghi khác; bận → Err → UnitOfWork rollback toàn bộ.
      const claimed = await this.deps.activeSlots.claim(tx, participants, match.id, now);
      if (claimed.isErr()) return err(claimed.error);

      await this.deps.matches.save(tx, match);
      const job = matchExpiryJob(match);
      if (job === null) throw new Error('match OFFERED phải có hạn');
      await this.deps.scheduler.schedule(tx, job);

      const audited = await this.deps.auditLogger.log(tx, {
        actor: { type: 'admin', id: cmd.staffId },
        action: MATCH_PROPOSE_AUDIT_ACTION,
        targetType: MATCH_AUDIT_TARGET_TYPE,
        targetId: match.id,
        ip: cmd.ip ?? null,
        // Không ghi staffNote (có thể chứa PII).
        meta: {
          participantIds: [...participants],
          scoreTotal: score.total,
          hasStaffNote: staffNote !== null,
        },
      });
      // Audit bị từ chối là lỗi lập trình → throw để rollback (không tạo match mà thiếu vết).
      if (audited.isErr()) {
        throw new Error(`audit log ${MATCH_PROPOSE_AUDIT_ACTION} rejected: ${audited.error.code}`);
      }

      return ok({
        matchId: match.id,
        status: match.status,
        participantIds: participants,
        scoreSnapshot,
        expiresAt: job.runAt,
      });
    });
  }
}
