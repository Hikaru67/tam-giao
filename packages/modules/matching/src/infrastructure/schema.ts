/**
 * Điểm vào schema Drizzle của module matching (drizzle-kit đọc file này). Bảng tách theo vùng để các task chạy song
 * song không sửa chung một file: `schema-slots.ts` (active_slots, cooldowns, pair_history — BE-S5-02),
 * `schema-candidates.ts` (candidate_profiles — BE-S5-03), `schema-matches.ts` (matches, match_events — BE-S5-04).
 */
export * from './schema-base.js';
export * from './schema-slots.js';
export * from './schema-candidates.js';
export * from './schema-matches.js';
