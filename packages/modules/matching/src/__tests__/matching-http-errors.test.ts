import { errorRegistry, MATCHING_SLOT_ERROR_CODES } from '@tamgiao/contracts';
import { describe, expect, it } from 'vitest';
import { CANDIDATE_ERROR_CODES } from '../domain/candidate-errors.js';
import { MATCHING_DOMAIN_ERRORS } from '../domain/errors.js';
import { PROPOSE_MATCH_ERROR_CODES } from '../domain/propose-errors.js';
import { MATCH_RESPONSE_ERROR_CODES } from '../index.js';

/** AC2 (BE-S5-07): mọi mã lỗi matching có HTTP status trong registry (không rơi về 500 "quên đăng ký"). */
describe('mapping HTTP status mã lỗi matching', () => {
  const ownedByMatching = errorRegistry.list().filter((e) => e.owner === 'matching');

  it('registry có mã lỗi của owner matching', () => {
    expect(ownedByMatching.length).toBeGreaterThan(0);
  });

  it.each(ownedByMatching.map((e) => [e.code, e.status] as const))(
    '%s (owner matching) → status %i là lỗi client 4xx',
    (_code, status) => {
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(500);
    },
  );

  const moduleCodes = [
    ...MATCHING_DOMAIN_ERRORS,
    ...MATCHING_SLOT_ERROR_CODES,
    ...MATCH_RESPONSE_ERROR_CODES,
    ...PROPOSE_MATCH_ERROR_CODES,
    ...CANDIDATE_ERROR_CODES,
  ];

  it.each(moduleCodes)('%s (mã của module matching) đã đăng ký bởi matching, status ≠ 500', (code) => {
    expect(errorRegistry.get(code)?.owner).toBe('matching');
    expect(errorRegistry.statusOf(code)).not.toBe(500);
  });

  it('mã module matching phủ toàn bộ mã owner matching trong registry', () => {
    expect([...new Set(moduleCodes)].sort()).toEqual(ownedByMatching.map((e) => e.code).sort());
  });

  it('mã chung route matching trả ra (id sai, không tìm thấy, body sai) có status ≠ 500', () => {
    for (const code of ['INVALID_ID', 'NOT_FOUND', 'VALIDATION_FAILED', 'UNAUTHENTICATED', 'FORBIDDEN']) {
      expect(errorRegistry.statusOf(code)).not.toBe(500);
    }
  });
});
