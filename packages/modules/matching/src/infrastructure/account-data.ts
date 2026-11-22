import { ACCOUNT_DELETION_REQUESTED } from '@tamgiao/contracts';
import { asDbTx, type EventBus } from '@tamgiao/db';
import type { DomainEvent, Tx } from '@tamgiao/kernel';
import type { PersonalDataSection, PersonalDataSource } from '@tamgiao/module-identity/facade';
import { and, asc, eq, isNotNull, or } from 'drizzle-orm';
import type { MatchRepository } from '../application/ports/match-repository.js';
import type { LockMatch } from '../application/responses/lock-match.js';
import { candidateProfiles, cooldowns, matches } from './schema.js';

/**
 * Quyền dữ liệu cá nhân của module matching (BE-S7-06): consumer khi người dùng xoá tài khoản + nguồn dữ liệu cho file
 * xuất.
 */

/** Tên consumer (duy nhất toàn hệ thống) — đổi tên = consumer mới, event cũ bị xử lý lại. */
export const MATCH_ERASE_ON_ACCOUNT_DELETION_CONSUMER = 'matching.erase-on-account-deletion';

/** Mã lý do khoá match khi một bên xoá tài khoản — lưu `matches.lock_reason`, nằm trong `MatchLocked`. */
export const MATCH_LOCK_REASON_ACCOUNT_DELETED = 'ACCOUNT_DELETED';

export interface AccountDeletionConsumerDeps {
  readonly matches: Pick<MatchRepository, 'findOpenByUser'>;
  readonly lockMatch: LockMatch;
}

function userIdOf(event: DomainEvent): string {
  const payload = event.payload;
  if (typeof payload === 'object' && payload !== null) {
    const userId = (payload as { userId?: unknown }).userId;
    if (typeof userId === 'string' && userId.length > 0) return userId;
  }
  throw new Error(`${event.type} ${event.eventId}: payload thiếu userId`);
}

/**
 * `AccountDeletionRequested` → (1) **đóng match đang mở** qua use case `LockMatch` (lý do `ACCOUNT_DELETED`: khoá
 * `FOR UPDATE`, trả active slot cho người kia, ghi `pair_history`, `MatchLocked` vào outbox → messaging đóng hội thoại);
 * (2) xoá read model `candidate_profiles` (bản sao hồ sơ: giới tính, ngày sinh, tôn giáo…) + cooldown; (3) trên các match
 * cũ: xoá lý do từ chối do người này nhập và ghi chú của chuyên viên về cặp (có thể chứa PII). Giữ lịch sử match / cặp
 * (id, trạng thái, thời điểm) — là lịch sử của cả người kia. Idempotent (A9): không còn match mở, dòng đã xoá.
 */
export function registerAccountDeletionConsumer(bus: EventBus, deps: AccountDeletionConsumerDeps): void {
  bus.on(ACCOUNT_DELETION_REQUESTED, MATCH_ERASE_ON_ACCOUNT_DELETION_CONSUMER, async (event, tx) => {
    const userId = userIdOf(event);
    const open = await deps.matches.findOpenByUser(tx, userId);
    if (open !== null) {
      await deps.lockMatch.executeIn(tx, { matchId: open.id, reason: MATCH_LOCK_REASON_ACCOUNT_DELETED });
    }
    const db = asDbTx(tx);
    await db.delete(candidateProfiles).where(eq(candidateProfiles.userId, userId));
    await db.delete(cooldowns).where(eq(cooldowns.userId, userId));
    await db
      .update(matches)
      .set({ declineReason: null })
      .where(and(eq(matches.declinedBy, userId), isNotNull(matches.declineReason)));
    await db
      .update(matches)
      .set({ staffNote: null })
      .where(and(or(eq(matches.userA, userId), eq(matches.userB, userId)), isNotNull(matches.staffNote)));
  });
}

/**
 * Mục `matching` của file xuất: các lần được ghép (trạng thái, mốc thời gian, mình đã đồng ý / từ chối, lý do từ chối do
 * mình nhập). Không gồm thông tin của người được ghép (dữ liệu của người khác) ngoài id match.
 */
export function createMatchingPersonalDataSource(): PersonalDataSource {
  return {
    section: 'matching',
    async collect(tx: Tx, userId: string): Promise<PersonalDataSection> {
      const rows = await asDbTx(tx)
        .select()
        .from(matches)
        .where(or(eq(matches.userA, userId), eq(matches.userB, userId)))
        .orderBy(asc(matches.offeredAt));
      return {
        data: {
          matches: rows.map((m) => ({
            matchId: m.id,
            status: m.status,
            offeredAt: m.offeredAt.toISOString(),
            datingStartedAt: m.datingStartedAt?.toISOString() ?? null,
            closedAt: m.closedAt?.toISOString() ?? null,
            acceptedByMe: m.acceptedBy.includes(userId),
            declinedByMe: m.declinedBy === userId,
            myDeclineReason: m.declinedBy === userId ? m.declineReason : null,
          })),
        },
        files: [],
      };
    },
  };
}
