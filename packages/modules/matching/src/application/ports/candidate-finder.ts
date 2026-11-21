import type { Tx } from '@tamgiao/kernel';
import type { CandidateProfile } from '../../domain/candidate-profile.js';

export interface CandidatePool {
  /** Hồ sơ của người cần tìm ứng viên (để chấm điểm từng cặp). */
  readonly seeker: CandidateProfile;
  readonly candidates: readonly CandidateProfile[];
}

/**
 * Tìm ứng viên qua bộ lọc cứng hai chiều (`passesHardFilters`) trên read model `matching.candidate_profiles`, loại
 * chính mình, người chưa xác thực, đang bận (`active_slots`), đang cooldown, đã thử cặp (`pair_history`).
 * Không sắp theo điểm — trả tối đa `limit` ứng viên theo thứ tự ổn định (application chấm điểm + chọn top N).
 */
export interface CandidateFinder {
  /**
   * `now` (từ `Clock`) dùng tính tuổi theo ngày lịch Việt Nam và so với `cooldowns.until`.
   * `null` khi người cần tìm chưa có trong read model hoặc chưa đủ hồ sơ + tiêu chí.
   */
  find(tx: Tx, userId: string, limit: number, now: Date): Promise<CandidatePool | null>;
}
