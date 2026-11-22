import { ONBOARDING_STEPS } from '@tamgiao/contracts/profile';
import { ONBOARDING_ROUTES, routeForOnboarding } from './onboarding-route.js';

describe('routeForOnboarding & ONBOARDING_ROUTES (FE-S2-02)', () => {
  it.each(ONBOARDING_STEPS)('bước %s điều hướng về đúng route', (step) => {
    const route = routeForOnboarding(step);
    expect(route).toBe(ONBOARDING_ROUTES[step]);
    expect(typeof route).toBe('string');
    expect(route.startsWith('/')).toBe(true);
  });

  it('mọi bước trong ONBOARDING_STEPS đều có route cấu hình trong ONBOARDING_ROUTES', () => {
    for (const step of ONBOARDING_STEPS) {
      expect(ONBOARDING_ROUTES[step]).toBeDefined();
    }
    expect(Object.keys(ONBOARDING_ROUTES)).toHaveLength(ONBOARDING_STEPS.length);
  });

  it('khớp chính xác các đường dẫn theo bảng điều hướng đặc tả', () => {
    expect(routeForOnboarding('PROFILE')).toBe('/(onboarding)/profile');
    expect(routeForOnboarding('CRITERIA')).toBe('/(onboarding)/preferences');
    expect(routeForOnboarding('VERIFICATION')).toBe('/(verification)/start');
    expect(routeForOnboarding('UNDER_REVIEW')).toBe('/(verification)/status');
    expect(routeForOnboarding('REJECTED')).toBe('/(verification)/status');
    expect(routeForOnboarding('ACTIVE')).toBe('/(main)/home');
  });
});
