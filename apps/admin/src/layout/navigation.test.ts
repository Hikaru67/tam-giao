import { describe, it, expect } from 'vitest';
import { ADMIN_PERMISSIONS } from '@tamgiao/contracts/identity';
import { NAV_ITEMS, visibleNavItems } from './navigation';
import { ROLE_PERMISSIONS_FIXTURE } from '../test-utils/fixtures';

describe('navigation', () => {
  it('bảng permission → menu theo từng vai trò', () => {
    const reviewerItems = visibleNavItems(ROLE_PERMISSIONS_FIXTURE.REVIEWER);
    expect(reviewerItems.map((item) => item.id)).toEqual(['overview', 'kyc', 'interviews']);

    const matchmakerItems = visibleNavItems(ROLE_PERMISSIONS_FIXTURE.MATCHMAKER);
    expect(matchmakerItems.map((item) => item.id)).toEqual(['overview', 'matching']);
    expect(matchmakerItems.some((item) => item.id === 'kyc')).toBe(false);

    const supervisorItems = visibleNavItems(ROLE_PERMISSIONS_FIXTURE.SUPERVISOR);
    expect(supervisorItems.map((item) => item.id)).toEqual([
      'overview',
      'kyc',
      'interviews',
      'matching',
      'moderation',
      'audit',
    ]);

    const adminItems = visibleNavItems(ROLE_PERMISSIONS_FIXTURE.ADMIN);
    expect(adminItems.map((item) => item.id)).toEqual([
      'overview',
      'kyc',
      'interviews',
      'matching',
      'moderation',
      'partners',
      'audit',
    ]);
    expect(adminItems.some((item) => item.id === 'partners')).toBe(true);
    expect(supervisorItems.some((item) => item.id === 'partners')).toBe(false);
    expect(reviewerItems.some((item) => item.id === 'partners')).toBe(false);
    expect(matchmakerItems.some((item) => item.id === 'partners')).toBe(false);

    const emptyItems = visibleNavItems([]);
    expect(emptyItems.map((item) => item.id)).toEqual(['overview']);
  });

  it('mọi NAV_ITEMS có permission thuộc ADMIN_PERMISSIONS hoặc null', () => {
    for (const item of NAV_ITEMS) {
      if (item.permission !== null) {
        expect(ADMIN_PERMISSIONS).toContain(item.permission);
      } else {
        expect(item.permission).toBeNull();
      }
    }
  });
});
