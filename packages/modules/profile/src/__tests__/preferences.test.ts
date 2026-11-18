import { MIN_AGE } from '@tamgiao/contracts/constants';
import { describe, expect, it } from 'vitest';
import { Preferences, type PreferenceCriteria } from '../domain/preferences.js';

const NOW = new Date('2026-11-18T00:00:00.000Z');
const valid: PreferenceCriteria = {
  ageMin: 25,
  ageMax: 35,
  area: { city: 'Hà Nội', radiusKm: 30 },
  childrenPlan: 'want_children',
  religion: 'not_important',
  lifestyle: {
    smoking: 'never',
    drinking: 'occasionally',
    dailyRhythm: 'not_important',
    sports: 'sometimes',
  },
  minEducation: 'bachelor',
  financialIndependence: 'required',
  coreTraits: ['honest', 'kind', 'responsible'],
};

const createErr = (c: Partial<PreferenceCriteria>) => {
  const r = Preferences.create('u1', { ...valid, ...c }, NOW);
  if (r.isOk()) throw new Error('expected Err');
  return r.error;
};

describe('Preferences', () => {
  it('create records PreferencesUpdated; replace records it again with a bumped version', () => {
    const r = Preferences.create('u1', valid, NOW);
    const p = r.unwrapOr(undefined as never);
    expect(p.pullEvents()).toMatchObject([
      { type: 'PreferencesUpdated', version: 1, payload: { userId: 'u1' } },
    ]);
    expect(p.replace({ ...valid, ageMax: 40 }, NOW).isOk()).toBe(true);
    expect(p.pullEvents()).toMatchObject([{ type: 'PreferencesUpdated', version: 2 }]);
    expect(p.toState().criteria.ageMax).toBe(40);
  });

  it.each([
    [['honest', 'kind']],
    [['honest', 'kind', 'loyal', 'patient']],
    [['honest', 'honest', 'kind']],
    [[]],
  ] as const)('core traits %o (≠ 3 distinct) → INVALID_CORE_TRAITS (AC1)', (coreTraits) => {
    expect(createErr({ coreTraits }).code).toBe('INVALID_CORE_TRAITS');
  });

  it.each([
    { ageMin: 36, ageMax: 35 },
    { ageMin: MIN_AGE - 1, ageMax: 30 },
    { ageMin: 30, ageMax: 81 },
    { ageMin: 25.5, ageMax: 30 },
  ])('age range %o → VALIDATION_FAILED (AC2)', (ages) => {
    expect(createErr(ages).code).toBe('VALIDATION_FAILED');
  });

  it('boundary ages MIN_AGE..80 and equal min/max are accepted', () => {
    expect(Preferences.create('u1', { ...valid, ageMin: MIN_AGE, ageMax: 80 }, NOW).isOk()).toBe(true);
    expect(Preferences.create('u1', { ...valid, ageMin: 30, ageMax: 30 }, NOW).isOk()).toBe(true);
  });

  it('radius out of range → VALIDATION_FAILED; null radius/city allowed', () => {
    expect(createErr({ area: { city: 'Huế', radiusKm: 0 } }).code).toBe('VALIDATION_FAILED');
    expect(createErr({ area: { city: 'Huế', radiusKm: 501 } }).code).toBe('VALIDATION_FAILED');
    expect(Preferences.create('u1', { ...valid, area: { city: null, radiusKm: null } }, NOW).isOk()).toBe(
      true,
    );
  });

  it('invalid replace leaves state and version unchanged', () => {
    const p = Preferences.create('u1', valid, NOW).unwrapOr(undefined as never);
    p.pullEvents();
    expect(p.replace({ ...valid, coreTraits: ['honest'] }, NOW).isErr()).toBe(true);
    expect(p.toState()).toMatchObject({ version: 1, criteria: valid });
    expect(p.pullEvents()).toEqual([]);
  });
});
