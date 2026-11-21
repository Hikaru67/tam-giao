import { describe, expect, it } from 'vitest';
import { passesHardFilters } from '../domain/candidate-hard-filter.js';
import { ageAt, cityKey, vnDate, type CandidateProfile } from '../domain/candidate-profile.js';
import { bornAged, candidate, NOW } from './candidate-fixtures.js';

/** Người tìm `a` là nam; ứng viên mặc định (fixture) là nữ — cặp khác giới hợp lệ. */
const man = (...args: Parameters<typeof candidate>): CandidateProfile =>
  candidate(args[0], { gender: 'male', ...args[1] });
const A = man('a');

describe('passesHardFilters — hai chiều (AC1)', () => {
  it.each<[string, CandidateProfile, CandidateProfile, boolean]>([
    ['cả hai thoả nhau', A, candidate('b'), true],
    // Giới tính — chỉ ghép khác giới
    ['cùng giới nữ', candidate('x'), candidate('b'), false],
    ['cùng giới nam', A, man('b'), false],
    ['nữ tìm nam', candidate('x'), man('b'), true],
    // Tuổi
    ['B quá tuổi tối đa của A', A, candidate('b', { birthDate: bornAged(36) }), false],
    ['A ngoài khoảng tuổi B muốn', A, candidate('b', { criteria: { ageMin: 31, ageMax: 40 } }), false],
    [
      'đúng mép khoảng tuổi (cả hai chiều)',
      A,
      candidate('b', { birthDate: bornAged(35), criteria: { ageMin: 30 } }),
      true,
    ],
    // Khu vực
    ['A chỉ muốn Huế, B ở Hà Nội', man('a', { criteria: { cityKey: 'huế' } }), candidate('b'), false],
    ['B chỉ muốn Huế, A ở Hà Nội', A, candidate('b', { criteria: { cityKey: 'huế' } }), false],
    [
      'cả hai muốn đúng nơi người kia sống',
      man('a', { criteria: { cityKey: 'hà nội' } }),
      candidate('b', { criteria: { cityKey: 'hà nội' } }),
      true,
    ],
    // Tôn giáo (đối xứng)
    [
      'tôn giáo khác nhau',
      man('a', { criteria: { religion: 'buddhism' } }),
      candidate('b', { criteria: { religion: 'catholicism' } }),
      false,
    ],
    [
      'tôn giáo khác nhau (đảo chiều)',
      man('a', { criteria: { religion: 'catholicism' } }),
      candidate('b', { criteria: { religion: 'buddhism' } }),
      false,
    ],
    [
      'một bên "không quan trọng" tôn giáo',
      man('a', { criteria: { religion: 'buddhism' } }),
      candidate('b'),
      true,
    ],
    [
      'cùng tôn giáo',
      man('a', { criteria: { religion: 'none' } }),
      candidate('b', { criteria: { religion: 'none' } }),
      true,
    ],
    // Kế hoạch con cái (đối xứng)
    ['muốn con vs không muốn con', A, candidate('b', { criteria: { childrenPlan: 'no_children' } }), false],
    [
      'không muốn con vs muốn con',
      man('a', { criteria: { childrenPlan: 'no_children' } }),
      candidate('b'),
      false,
    ],
    ['một bên để ngỏ', A, candidate('b', { criteria: { childrenPlan: 'open' } }), true],
    [
      'một bên không quan trọng',
      man('a', { criteria: { childrenPlan: 'no_children' } }),
      candidate('b', { criteria: { childrenPlan: 'not_important' } }),
      true,
    ],
  ])('%s → %s', (_name, a, b, expected) => {
    expect(passesHardFilters(a, b, NOW)).toBe(expected);
    expect(passesHardFilters(b, a, NOW)).toBe(expected);
  });
});

describe('candidate-profile helpers', () => {
  it('ageAt tính theo ngày lịch Việt Nam (UTC+7)', () => {
    // 2026-01-14T17:30Z = 00:30 ngày 15/01 giờ VN → vừa tròn tuổi.
    expect(ageAt('2000-01-15', new Date('2026-01-14T17:30:00Z'))).toBe(26);
    expect(ageAt('2000-01-15', new Date('2026-01-14T16:59:00Z'))).toBe(25);
    expect(ageAt('2004-02-29', new Date('2025-02-28T05:00:00Z'))).toBe(20);
    expect(vnDate(new Date('2026-01-14T17:30:00Z'))).toBe('2026-01-15');
  });

  it('cityKey chuẩn hoá khoảng trắng, hoa/thường, Unicode', () => {
    expect(cityKey('  Hà   Nội ')).toBe('hà nội');
    expect(cityKey('Hà Nội'.normalize('NFD'))).toBe(cityKey('Hà Nội'));
  });
});
