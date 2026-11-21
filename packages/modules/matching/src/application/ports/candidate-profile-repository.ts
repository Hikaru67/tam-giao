import type { Tx } from '@tamgiao/kernel';
import type { CandidateProfile } from '../../domain/candidate-profile.js';

/** Bản chụp hồ sơ + tiêu chí từ module profile kèm version nguồn (chống ghi đè bằng bản cũ hơn). */
export interface CandidateProfileSnapshot {
  readonly profile: CandidateProfile;
  readonly profileVersion: number;
  readonly preferencesVersion: number;
}

/** Ghi read model `matching.candidate_profiles` (BE-S5-03). Mọi thao tác idempotent (A9). */
export interface CandidateProfileRepository {
  /**
   * Upsert phần hồ sơ/tiêu chí; chỉ ghi đè khi cả hai version nguồn ≥ bản đang lưu (consumer chạy song song đọc
   * facade ở thời điểm khác nhau không được ghi lùi). Không đụng cờ `verified`.
   */
  upsertProfile(tx: Tx, snapshot: CandidateProfileSnapshot, now: Date): Promise<void>;
  /** Đặt cờ `verified` (tạo dòng rỗng phần hồ sơ nếu chưa có). */
  setVerified(tx: Tx, userId: string, verified: boolean, now: Date): Promise<void>;
}
