import * as contracts from '@tamgiao/contracts';
import { describe, expect, it } from 'vitest';
import { ONBOARDING_STEPS, onboardingStep } from '../domain/onboarding.js';

describe('onboardingStep', () => {
  it.each([
    [null, false, 'PROFILE'],
    [null, true, 'PROFILE'],
    ['DRAFT', false, 'PROFILE'],
    ['DRAFT', true, 'PROFILE'],
    ['COMPLETED', false, 'CRITERIA'],
    ['COMPLETED', true, 'VERIFICATION'],
  ] as const)('profile=%s, preferences=%s → %s', (profileStatus, hasPreferences, step) => {
    expect(onboardingStep({ profileStatus, hasPreferences, verification: 'NOT_SUBMITTED' })).toBe(step);
  });

  it.each([
    ['NOT_SUBMITTED', 'VERIFICATION'],
    ['IN_PROGRESS', 'UNDER_REVIEW'],
    ['APPROVED', 'ACTIVE'],
    ['REJECTED', 'REJECTED'],
  ] as const)('completed profile + criteria, verification=%s → %s', (verification, step) => {
    expect(onboardingStep({ profileStatus: 'COMPLETED', hasPreferences: true, verification })).toBe(step);
  });

  it('profile and criteria come before verification status', () => {
    expect(onboardingStep({ profileStatus: 'DRAFT', hasPreferences: true, verification: 'APPROVED' })).toBe(
      'PROFILE',
    );
    expect(
      onboardingStep({ profileStatus: 'COMPLETED', hasPreferences: false, verification: 'APPROVED' }),
    ).toBe('CRITERIA');
  });

  it('steps match the published contract', () => {
    expect(ONBOARDING_STEPS).toEqual(contracts.ONBOARDING_STEPS);
  });
});
