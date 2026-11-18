import * as contracts from '@tamgiao/contracts';
import { addDuration, newId } from '@tamgiao/kernel';
import { describe, expect, it } from 'vitest';
import * as partnerDomain from '../domain/partner.js';
import { Partner } from '../domain/partner.js';
import { PARTNER_ERRORS } from '../domain/partner-errors.js';
import {
  ensurePartnerStaffCanOperate,
  isValidPartnerPin,
  PARTNER_LOCK_MINUTES,
  PARTNER_MAX_FAILED_LOGINS,
  PARTNER_PIN_PATTERN,
  PartnerStaff,
} from '../domain/partner-staff.js';

const T0 = new Date('2026-11-18T01:00:00.000Z');
const DEVICE = 'device-aaaa-0001';

const newPartner = (overrides: Partial<Parameters<typeof Partner.create>[0]> = {}) => {
  const r = Partner.create(
    { id: newId<'Partner'>(), name: 'The Running Bean', address: '115 Hồ Tùng Mậu, Q1', ...overrides },
    T0,
  );
  if (r.isErr()) throw new Error(r.error.code);
  return r.value;
};

const newStaff = (partner: Partner, deviceId: string | null = DEVICE) => {
  const r = PartnerStaff.create(
    { id: newId<'PartnerStaff'>(), partnerId: partner.id, name: 'Lan', pinHash: 'h1', deviceId },
    T0,
  );
  if (r.isErr()) throw new Error(r.error.code);
  return r.value;
};

describe('mã lỗi partner', () => {
  it.each(PARTNER_ERRORS)('%s đã đăng ký HTTP status trong contracts', (code) => {
    expect(contracts.errorRegistry.get(code)).toBeDefined();
  });
});

// Domain không được import contracts ngoài `constants` (A1) → giữ bản sao, test này bảo đảm hai nơi khớp nhau.
describe('giới hạn partner khớp contracts', () => {
  it('độ dài + số tag + mẫu PIN', () => {
    expect(partnerDomain.PARTNER_NAME_MAX_LENGTH).toBe(contracts.PARTNER_NAME_MAX_LENGTH);
    expect(partnerDomain.PARTNER_ADDRESS_MAX_LENGTH).toBe(contracts.PARTNER_ADDRESS_MAX_LENGTH);
    expect(partnerDomain.PARTNER_TAG_MAX_LENGTH).toBe(contracts.PARTNER_TAG_MAX_LENGTH);
    expect(partnerDomain.PARTNER_TAGS_MAX).toBe(contracts.PARTNER_TAGS_MAX);
    expect(PARTNER_PIN_PATTERN.source).toBe(contracts.PARTNER_PIN_PATTERN.source);
  });
});

describe('Partner', () => {
  it('tạo mới: active, trim, chuẩn hoá tag (bỏ trùng không phân biệt hoa thường)', () => {
    const p = newPartner({ name: '  RuNam ', tags: [' yên tĩnh ', 'Yên tĩnh', 'có  chỗ đỗ xe'] }).toState();
    expect(p).toMatchObject({ name: 'RuNam', active: true, photoUrl: null, createdAt: T0, updatedAt: T0 });
    expect(p.tags).toEqual(['yên tĩnh', 'có chỗ đỗ xe']);
  });

  it.each([
    ['name', { name: '   ' }],
    ['name', { name: 'x'.repeat(121) }],
    ['address', { address: '' }],
    ['tags', { tags: [''] }],
    ['tags', { tags: ['x'.repeat(31)] }],
    ['tags', { tags: Array.from({ length: 11 }, (_, i) => `t${i}`) }],
  ])('dữ liệu sai %s → PARTNER_INVALID', (field, overrides) => {
    const r = Partner.create({ id: newId<'Partner'>(), name: 'A', address: 'B', ...overrides }, T0);
    expect(r.isErr() && r.error).toEqual({ code: 'PARTNER_INVALID', details: { field } });
  });

  it('update trả các trường thực sự đổi và chạm updatedAt', () => {
    const p = newPartner({ tags: ['a'] });
    const t1 = addDuration(T0, { hours: 1 });
    const r = p.update(
      { name: 'The Running Bean', address: 'Mới', tags: ['a'], active: false, photoUrl: null },
      t1,
    );
    expect(r.isOk() && r.value).toEqual(['address', 'active']);
    expect(p.toState()).toMatchObject({ address: 'Mới', active: false, updatedAt: t1 });
  });

  it('update không đổi gì → không chạm updatedAt', () => {
    const p = newPartner();
    const r = p.update({ name: 'The Running Bean' }, addDuration(T0, { hours: 1 }));
    expect(r.isOk() && r.value).toEqual([]);
    expect(p.toState().updatedAt).toEqual(T0);
  });

  it('update sai → không áp dụng phần nào', () => {
    const p = newPartner();
    const r = p.update({ address: 'Mới', name: ' ' }, addDuration(T0, { hours: 1 }));
    expect(r.isErr() && r.error.code).toBe('PARTNER_INVALID');
    expect(p.toState().address).toBe('115 Hồ Tùng Mậu, Q1');
  });
});

describe('PartnerStaff', () => {
  it('PIN hợp lệ: đúng 6 chữ số', () => {
    expect(isValidPartnerPin('012345')).toBe(true);
    for (const bad of ['12345', '1234567', '12a456', ' 123456', ''])
      expect(isValidPartnerPin(bad)).toBe(false);
  });

  it('tên trống → PARTNER_INVALID', () => {
    const r = PartnerStaff.create(
      { id: newId<'PartnerStaff'>(), partnerId: newId<'Partner'>(), name: ' ', pinHash: 'h' },
      T0,
    );
    expect(r.isErr() && r.error).toEqual({ code: 'PARTNER_INVALID', details: { field: 'name' } });
  });

  it('đăng nhập đúng → xoá bộ đếm, ghi lastLoginAt', () => {
    const s = newStaff(newPartner());
    s.login({ pinMatches: false, deviceId: DEVICE }, T0);
    const r = s.login({ pinMatches: true, deviceId: DEVICE }, T0);
    expect(r.isOk()).toBe(true);
    expect(s.toState()).toMatchObject({ failedLogins: 0, lockedUntil: null, lastLoginAt: T0 });
  });

  it('chưa gắn thiết bị → gắn ở lần đăng nhập thành công đầu tiên, sau đó thiết bị khác bị từ chối', () => {
    const s = newStaff(newPartner(), null);
    expect(s.login({ pinMatches: true, deviceId: DEVICE }, T0).isOk()).toBe(true);
    expect(s.toState().deviceId).toBe(DEVICE);
    const other = s.login({ pinMatches: true, deviceId: 'device-bbbb-0002' }, T0);
    expect(other.isErr() && other.error.code).toBe('PARTNER_LOGIN_FAILED');
    expect(s.toState().failedLogins).toBe(1);
  });

  it(`sai ${PARTNER_MAX_FAILED_LOGINS} lần → khoá ${PARTNER_LOCK_MINUTES} phút; hết khoá đếm lại từ 0`, () => {
    const s = newStaff(newPartner());
    for (let i = 1; i < PARTNER_MAX_FAILED_LOGINS; i++) {
      const r = s.login({ pinMatches: false, deviceId: DEVICE }, T0);
      expect(r.isErr() && r.error.code).toBe('PARTNER_LOGIN_FAILED');
    }
    const locked = s.login({ pinMatches: false, deviceId: DEVICE }, T0);
    expect(locked.isErr() && locked.error).toEqual({
      code: 'PARTNER_STAFF_LOCKED',
      details: { retryAfterSeconds: PARTNER_LOCK_MINUTES * 60 },
    });
    // Đang khoá: PIN đúng cũng bị chặn.
    const during = s.login({ pinMatches: true, deviceId: DEVICE }, addDuration(T0, { minutes: 1 }));
    expect(during.isErr() && during.error.code).toBe('PARTNER_STAFF_LOCKED');
    expect(s.lockRemainingSeconds(addDuration(T0, { minutes: 1 }))).toBe((PARTNER_LOCK_MINUTES - 1) * 60);

    const after = addDuration(T0, { minutes: PARTNER_LOCK_MINUTES });
    expect(s.lockRemainingSeconds(after)).toBe(0);
    const again = s.login({ pinMatches: false, deviceId: DEVICE }, after);
    expect(again.isErr() && again.error.code).toBe('PARTNER_LOGIN_FAILED');
    expect(s.toState()).toMatchObject({ failedLogins: 1, lockedUntil: null });
  });

  it('đặt lại PIN → mở khoá + tăng tokenVersion', () => {
    const s = newStaff(newPartner());
    for (let i = 0; i < PARTNER_MAX_FAILED_LOGINS; i++) s.login({ pinMatches: false, deviceId: DEVICE }, T0);
    s.resetPin('h2', T0);
    expect(s.toState()).toMatchObject({ pinHash: 'h2', failedLogins: 0, lockedUntil: null, tokenVersion: 2 });
  });

  it('đổi thiết bị / vô hiệu hoá → tăng tokenVersion; không đổi gì → giữ nguyên', () => {
    const s = newStaff(newPartner());
    expect(s.changeDevice(DEVICE, T0)).toBe(false);
    expect(s.changeDevice(null, T0)).toBe(true);
    expect(s.tokenVersion).toBe(2);
    expect(s.setActive(true, T0)).toBe(false);
    expect(s.setActive(false, T0)).toBe(true);
    expect(s.tokenVersion).toBe(3);
    expect(s.setActive(true, T0)).toBe(true);
    expect(s.tokenVersion).toBe(3);
  });

  it('rename: trùng tên → false; khác → true', () => {
    const s = newStaff(newPartner());
    expect(s.rename(' Lan ', T0).unwrapOr(true)).toBe(false);
    expect(s.rename('Hoa', T0).unwrapOr(false)).toBe(true);
  });

  it('ensurePartnerStaffCanOperate: cần cả quán và tài khoản đang active', () => {
    const partner = newPartner();
    const staff = newStaff(partner);
    expect(ensurePartnerStaffCanOperate(staff, partner).isOk()).toBe(true);
    partner.update({ active: false }, T0);
    const r = ensurePartnerStaffCanOperate(staff, partner);
    expect(r.isErr() && r.error.code).toBe('PARTNER_INACTIVE');
    partner.update({ active: true }, T0);
    staff.setActive(false, T0);
    expect(ensurePartnerStaffCanOperate(staff, partner).isErr()).toBe(true);
    expect(() => ensurePartnerStaffCanOperate(staff, newPartner())).toThrow();
  });
});
