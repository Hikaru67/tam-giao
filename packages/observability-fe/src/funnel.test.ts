import { describe, expect, it } from 'vitest';
import { createFunnelTracker, type FunnelStep } from './funnel.js';

describe('createFunnelTracker', () => {
  it('emits signed_in and payment_completed only for valid path transitions', () => {
    const calls: FunnelStep[] = [];
    const tracker = createFunnelTracker((step) => calls.push(step));

    tracker.onPathChange('/phone');
    tracker.onPathChange('/');
    expect(calls).toEqual([]);

    tracker.onPathChange('/otp');
    tracker.onPathChange('/');
    expect(calls).toEqual(['signed_in']);

    tracker.onPathChange('/start');
    tracker.onPathChange('/kyc');
    expect(calls).toEqual(['signed_in']);

    tracker.onPathChange('/payment');
    tracker.onPathChange('/kyc');
    expect(calls).toEqual(['signed_in', 'payment_completed']);
  });

  it('tracks progressive onboarding steps and ignores initial observation or backward moves', () => {
    const calls: FunnelStep[] = [];
    const tracker = createFunnelTracker((step) => calls.push(step));

    tracker.onOnboardingStep('CRITERIA');
    expect(calls).toEqual([]);

    tracker.onOnboardingStep('VERIFICATION');
    expect(calls).toEqual(['preferences_completed']);

    tracker.onOnboardingStep('CRITERIA');
    expect(calls).toEqual(['preferences_completed']);

    tracker.onOnboardingStep('UNDER_REVIEW');
    expect(calls).toEqual(['preferences_completed', 'ekyc_submitted']);
  });

  it('emits intermediate steps in ascending order when jumping across onboarding stages', () => {
    const calls: FunnelStep[] = [];
    const tracker = createFunnelTracker((step) => calls.push(step));

    tracker.onOnboardingStep('PROFILE');
    tracker.onOnboardingStep('CRITERIA');
    expect(calls).toEqual(['profile_completed']);

    tracker.reset();
    calls.length = 0;

    tracker.onOnboardingStep('PROFILE');
    tracker.onOnboardingStep('VERIFICATION');
    expect(calls).toEqual(['profile_completed', 'preferences_completed']);
  });

  it('deduplicates repeated steps within a session and resets cleanly on logout', () => {
    const calls: FunnelStep[] = [];
    const tracker = createFunnelTracker((step) => calls.push(step));

    tracker.onPathChange('/otp');
    tracker.onPathChange('/');
    tracker.onPathChange('/otp');
    tracker.onPathChange('/');
    expect(calls).toEqual(['signed_in']);

    tracker.onOnboardingStep('PROFILE');
    tracker.onOnboardingStep('CRITERIA');
    expect(calls).toEqual(['signed_in', 'profile_completed']);

    tracker.reset();

    // Sau reset, lần đầu quan sát bước onboarding không được tự emit.
    tracker.onOnboardingStep('CRITERIA');
    expect(calls).toEqual(['signed_in', 'profile_completed']);

    tracker.onPathChange('/otp');
    tracker.onPathChange('/');
    expect(calls).toEqual(['signed_in', 'profile_completed', 'signed_in']);
  });
});
