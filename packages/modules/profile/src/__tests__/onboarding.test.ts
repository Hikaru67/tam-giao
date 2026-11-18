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
    expect(onboardingStep({ profileStatus, hasPreferences })).toBe(step);
  });

  it('steps match the published contract', () => {
    expect(ONBOARDING_STEPS).toEqual(contracts.ONBOARDING_STEPS);
  });
});
