import type { Tx } from '@tamgiao/kernel';
import type { CandidateProfile } from '../../domain/candidate-profile.js';

/** Đọc hồ sơ ứng viên đã đồng bộ từ read model `matching.candidate_profiles` (BE-S5-04 dùng khi đề xuất). */
export interface CandidateProfileReader {
  /**
   * Hồ sơ đã đồng bộ (đủ phần hồ sơ + tiêu chí) của các `userIds`, khoá theo `userId`. Người chưa có trong read model
   * hoặc mới chỉ có cờ `verified` → không có trong kết quả. Không xét cờ `verified`.
   */
  findSynced(tx: Tx, userIds: readonly string[]): Promise<ReadonlyMap<string, CandidateProfile>>;
}
