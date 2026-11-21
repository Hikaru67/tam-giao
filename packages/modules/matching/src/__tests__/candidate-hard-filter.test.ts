import { describe, expect, it } from 'vitest';
import { passesHardFilters } from '../domain/candidate-hard-filter.js';
import { ageAt, cityKey, vnDate, type CandidateProfile } from '../domain/candidate-profile.js';
import { bornAged, candidate, NOW } from './candidate-fixtures.js';

/** Người tìm `a` là nam; ứng viên mặc định (fixture) là nữ — cặp khác giới hợp lệ. */
const man = (...args: Parameters<typeof candidate>): CandidateProfile =>
  candidate(args[0], { gender: 'male', ...args[1] });
const A = man('a');

describe('passesHardFilters — hai chiều, hồ sơ ↔ tiêu chí (BE-S5-03 AC1, BE-S6-07 AC1/AC2)', () => {
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
    // Tôn giáo — hồ sơ người kia ↔ tiêu chí của mình (BE-S6-07). Fixture: hồ sơ Phật giáo, tiêu chí "không quan trọng".
    [
      'AC1: A muốn Phật giáo, B là Công giáo',
      man('a', { criteria: { religion: 'buddhism' } }),
      candidate('b', { religion: 'catholicism' }),
      false,
    ],
    [
      'A muốn Phật giáo, B là Phật giáo',
      man('a', { criteria: { religion: 'buddhism' } }),
      candidate('b', { religion: 'buddhism' }),
      true,
    ],
    [
      'B muốn Công giáo, A là Phật giáo (chiều B→A)',
      A,
      candidate('b', { criteria: { religion: 'catholicism' } }),
      false,
    ],
    [
      'tiêu chí hai bên khác nhau nhưng mỗi hồ sơ thoả tiêu chí bên kia',
      man('a', { religion: 'catholicism', criteria: { religion: 'buddhism' } }),
      candidate('b', { religion: 'buddhism', criteria: { religion: 'catholicism' } }),
      true,
    ],
    ['tiêu chí "không quan trọng" → nhận mọi tôn giáo', A, candidate('b', { religion: 'other' }), true],
    [
      'A muốn "không tôn giáo", B không tôn giáo',
      man('a', { criteria: { religion: 'none' } }),
      candidate('b', { religion: 'none' }),
      true,
    ],
    [
      'A muốn "không tôn giáo", B là Phật giáo',
      man('a', { criteria: { religion: 'none' } }),
      candidate('b'),
      false,
    ],
    // Kế hoạch con cái — hồ sơ người kia ↔ tiêu chí. Fixture: hồ sơ muốn con, tiêu chí muốn con.
    ['hồ sơ trùng tiêu chí', A, candidate('b'), true],
    ['A muốn bạn đời muốn con, B không muốn con', A, candidate('b', { childrenPlan: 'no_children' }), false],
    [
      'B muốn bạn đời không con, A muốn con (chiều B→A)',
      A,
      candidate('b', { criteria: { childrenPlan: 'no_children' } }),
      false,
    ],
    [
      'cả hai không muốn con, tiêu chí không con',
      man('a', { childrenPlan: 'no_children', criteria: { childrenPlan: 'no_children' } }),
      candidate('b', { childrenPlan: 'no_children', criteria: { childrenPlan: 'no_children' } }),
      true,
    ],
    ['hồ sơ B "để ngỏ" hợp mọi tiêu chí', A, candidate('b', { childrenPlan: 'open' }), true],
    [
      'tiêu chí A "để ngỏ" nhận mọi hồ sơ',
      man('a', { criteria: { childrenPlan: 'open' } }),
      candidate('b', { childrenPlan: 'no_children', criteria: { childrenPlan: 'not_important' } }),
      true,
    ],
    [
      'tiêu chí A "không quan trọng" nhận mọi hồ sơ',
      man('a', { criteria: { childrenPlan: 'not_important' } }),
      candidate('b', { childrenPlan: 'no_children', criteria: { childrenPlan: 'open' } }),
      true,
    ],
    // AC2 — hồ sơ cũ chưa khai (null) → không bị loại vì tiêu chí tôn giáo / con cái.
    [
      'hồ sơ B chưa khai tôn giáo (null), A muốn Phật giáo',
      man('a', { criteria: { religion: 'buddhism' } }),
      candidate('b', { religion: null }),
      true,
    ],
    ['hồ sơ B chưa khai con cái (null), A muốn con', A, candidate('b', { childrenPlan: null }), true],
    [
      'hồ sơ B null nhưng tuổi vẫn bị loại',
      A,
      candidate('b', { religion: null, childrenPlan: null, birthDate: bornAged(40) }),
      false,
    ],
    [
      'hồ sơ A null không cứu được hồ sơ B vi phạm tiêu chí của A',
      man('a', { religion: null, childrenPlan: null, criteria: { religion: 'buddhism' } }),
      candidate('b', { religion: 'catholicism' }),
      false,
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
