import { KYC_APPROVED, KYC_REJECTED, PREFERENCES_UPDATED, PROFILE_COMPLETED } from '@tamgiao/contracts';
import type { EventBus } from '@tamgiao/db';
import type { DomainEvent, Tx } from '@tamgiao/kernel';
import type {
  SetCandidateVerification,
  SyncCandidateProfile,
} from '../application/candidate-profile-sync.js';

/** Tên consumer (duy nhất toàn hệ thống, `<module>.<việc>`) — đổi tên = consumer mới, event cũ bị xử lý lại. */
export const CANDIDATE_ON_PROFILE_COMPLETED_CONSUMER = 'matching.candidate-on-profile-completed';
export const CANDIDATE_ON_PREFERENCES_UPDATED_CONSUMER = 'matching.candidate-on-preferences-updated';
export const CANDIDATE_ON_KYC_APPROVED_CONSUMER = 'matching.candidate-on-kyc-approved';
export const CANDIDATE_ON_KYC_REJECTED_CONSUMER = 'matching.candidate-on-kyc-rejected';

/** Lấy `userId` từ payload event (profile / verification); sai dạng là lỗi lập trình. */
function userIdOf(event: DomainEvent): string {
  const payload = event.payload;
  if (typeof payload === 'object' && payload !== null) {
    const userId = (payload as { userId?: unknown }).userId;
    if (typeof userId === 'string' && userId.length > 0) return userId;
  }
  throw new Error(`${event.type} ${event.eventId}: payload thiếu userId`);
}

export interface CandidateProfileConsumers {
  readonly syncProfile: SyncCandidateProfile;
  readonly setVerification: SetCandidateVerification;
}

/**
 * Đăng ký consumer đồng bộ read model `matching.candidate_profiles` (BE-S5-03) lên `bus`. Handler chạy trong
 * transaction của `deliverOnce` (cùng `processed_events`); bản thân handler cũng idempotent (A9).
 */
export function registerCandidateProfileConsumers(bus: EventBus, consumers: CandidateProfileConsumers): void {
  const sync = (event: DomainEvent, tx: Tx) => consumers.syncProfile.handle(tx, { userId: userIdOf(event) });
  bus.on(PROFILE_COMPLETED, CANDIDATE_ON_PROFILE_COMPLETED_CONSUMER, sync);
  bus.on(PREFERENCES_UPDATED, CANDIDATE_ON_PREFERENCES_UPDATED_CONSUMER, sync);
  bus.on(KYC_APPROVED, CANDIDATE_ON_KYC_APPROVED_CONSUMER, (event, tx) =>
    consumers.setVerification.handle(tx, { userId: userIdOf(event), verified: true }),
  );
  bus.on(KYC_REJECTED, CANDIDATE_ON_KYC_REJECTED_CONSUMER, (event, tx) =>
    consumers.setVerification.handle(tx, { userId: userIdOf(event), verified: false }),
  );
}
