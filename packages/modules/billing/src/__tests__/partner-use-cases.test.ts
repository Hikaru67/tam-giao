import { addDuration, FakeClock, newId } from '@tamgiao/kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthenticatePartnerStaff } from '../application/partner/authenticate-partner-staff.js';
import {
  CreatePartnerStaff,
  ListPartnerStaff,
  UpdatePartnerStaff,
} from '../application/partner/manage-partner-staff.js';
import {
  CreatePartner,
  GetPartner,
  ListActivePartners,
  ListPartners,
  UpdatePartner,
} from '../application/partner/manage-partners.js';
import { PartnerStaffLogin } from '../application/partner/partner-staff-login.js';
import { PARTNER_MAX_FAILED_LOGINS, PARTNER_STAFF_TOKEN_TTL_HOURS } from '../domain/partner-staff.js';
import {
  FakePartnerPinHasher,
  FakePartnerTokenService,
  FakePartnerUnitOfWork,
  InMemoryPartnerStore,
  RecordingPartnerAuditLogger,
} from './partner-fakes.js';

const T0 = new Date('2026-11-18T01:00:00.000Z');
const DEVICE = 'device-aaaa-0001';
const PIN = '246810';
const actor = { adminId: newId<'Admin'>(), ip: '10.0.0.1' };

let store: InMemoryPartnerStore;
let clock: FakeClock;
let audit: RecordingPartnerAuditLogger;
let pins: FakePartnerPinHasher;
let uc: ReturnType<typeof build>;

function build() {
  const uow = new FakePartnerUnitOfWork(store);
  const tokens = new FakePartnerTokenService();
  const partnerDeps = { uow, clock, partners: store, auditLogger: audit };
  const staffDeps = { ...partnerDeps, staff: store.staff, pins };
  return {
    createPartner: new CreatePartner(partnerDeps),
    updatePartner: new UpdatePartner(partnerDeps),
    getPartner: new GetPartner({ uow, partners: store }),
    listPartners: new ListPartners({ uow, partners: store }),
    listActive: new ListActivePartners({ uow, partners: store }),
    createStaff: new CreatePartnerStaff(staffDeps),
    updateStaff: new UpdatePartnerStaff(staffDeps),
    listStaff: new ListPartnerStaff({ uow, clock, partners: store, staff: store.staff }),
    login: new PartnerStaffLogin({ uow, clock, partners: store, staff: store.staff, pins, tokens }),
    authenticate: new AuthenticatePartnerStaff({ uow, clock, partners: store, staff: store.staff, tokens }),
  };
}

beforeEach(() => {
  store = new InMemoryPartnerStore();
  clock = new FakeClock(T0);
  audit = new RecordingPartnerAuditLogger();
  pins = new FakePartnerPinHasher();
  uc = build();
});

async function partner(name = 'The Running Bean') {
  const r = await uc.createPartner.execute({ actor, name, address: '115 Hồ Tùng Mậu' });
  if (r.isErr()) throw new Error(r.error.code);
  return r.value;
}

async function staffOf(partnerId: string, deviceId: string | null = DEVICE) {
  const r = await uc.createStaff.execute({ actor, partnerId, name: 'Lan', pin: PIN, deviceId });
  if (r.isErr()) throw new Error(r.error.code);
  return r.value;
}

describe('quản lý quán (admin)', () => {
  it('tạo quán → active, audit partner.create', async () => {
    const p = await partner();
    expect(p.active).toBe(true);
    expect(audit.entries).toEqual([
      {
        actor: { type: 'admin', id: actor.adminId },
        ip: actor.ip,
        action: 'partner.create',
        targetType: 'partner',
        targetId: p.id,
        meta: { active: true },
      },
    ]);
  });

  it('tạo quán dữ liệu sai → PARTNER_INVALID, không ghi gì', async () => {
    const r = await uc.createPartner.execute({ actor, name: ' ', address: 'x' });
    expect(r.isErr() && r.error.code).toBe('PARTNER_INVALID');
    expect(store.partners.size).toBe(0);
    expect(audit.entries).toHaveLength(0);
  });

  it('tắt quán → audit fields; không đổi gì → không audit', async () => {
    const p = await partner();
    audit.entries = [];
    const r = await uc.updatePartner.execute({ actor, partnerId: p.id, patch: { active: false } });
    expect(r.isOk() && r.value.active).toBe(false);
    expect(audit.entries[0]).toMatchObject({
      action: 'partner.update',
      meta: { fields: ['active'], active: false },
    });
    await uc.updatePartner.execute({ actor, partnerId: p.id, patch: { active: false } });
    expect(audit.entries).toHaveLength(1);
  });

  it('audit bị từ chối → throw, rollback thao tác', async () => {
    const p = await partner();
    audit.failWith = 'AUDIT_ENTRY_INVALID';
    await expect(
      uc.updatePartner.execute({ actor, partnerId: p.id, patch: { name: 'Khác' } }),
    ).rejects.toThrow();
    expect(store.partners.get(p.id)?.name).toBe('The Running Bean');
  });

  it('id không tồn tại / không phải UUID v7 → PARTNER_NOT_FOUND', async () => {
    for (const id of [newId<'Partner'>(), 'not-a-uuid']) {
      const u = await uc.updatePartner.execute({ actor, partnerId: id, patch: { active: false } });
      expect(u.isErr() && u.error.code).toBe('PARTNER_NOT_FOUND');
      const g = await uc.getPartner.execute(id);
      expect(g.isErr() && g.error.code).toBe('PARTNER_NOT_FOUND');
      const s = await uc.listStaff.execute(id);
      expect(s.isErr() && s.error.code).toBe('PARTNER_NOT_FOUND');
    }
  });

  it('danh sách: admin lọc theo active; người dùng chỉ thấy quán active', async () => {
    const a = await partner('A quán');
    const b = await partner('B quán');
    await uc.updatePartner.execute({ actor, partnerId: b.id, patch: { active: false } });
    expect((await uc.listPartners.execute({})).map((p) => p.id)).toEqual([a.id, b.id]);
    expect((await uc.listPartners.execute({ active: false })).map((p) => p.id)).toEqual([b.id]);
    expect((await uc.listActive.execute()).map((p) => p.id)).toEqual([a.id]);
  });
});

describe('quản lý nhân viên quán (admin)', () => {
  it('tạo nhân viên: lưu hash PIN, không trả hash, audit không chứa PIN', async () => {
    const p = await partner();
    const s = await staffOf(p.id);
    expect(store.staffRows.get(s.id)?.pinHash).toBe(`hashed:${PIN}`);
    expect(JSON.stringify(s)).not.toContain(PIN);
    expect(JSON.stringify(audit.entries)).not.toContain(PIN);
    expect(audit.entries.at(-1)).toMatchObject({
      action: 'partner.staff_create',
      targetType: 'partner_staff',
      meta: { partnerId: p.id, deviceBound: true },
    });
  });

  it('PIN sai định dạng → PARTNER_PIN_INVALID; quán không tồn tại → PARTNER_NOT_FOUND', async () => {
    const p = await partner();
    const bad = await uc.createStaff.execute({ actor, partnerId: p.id, name: 'Lan', pin: '12' });
    expect(bad.isErr() && bad.error.code).toBe('PARTNER_PIN_INVALID');
    const missing = await uc.createStaff.execute({ actor, partnerId: newId(), name: 'Lan', pin: PIN });
    expect(missing.isErr() && missing.error.code).toBe('PARTNER_NOT_FOUND');
    expect(store.staffRows.size).toBe(0);
  });

  it('cập nhật nhân viên sai quán → PARTNER_STAFF_NOT_FOUND', async () => {
    const p = await partner();
    const other = await partner('Khác');
    const s = await staffOf(p.id);
    const r = await uc.updateStaff.execute({ actor, partnerId: other.id, staffId: s.id, name: 'X' });
    expect(r.isErr() && r.error.code).toBe('PARTNER_STAFF_NOT_FOUND');
  });

  it('đặt lại PIN + đổi thiết bị → audit fields (không có giá trị PIN)', async () => {
    const p = await partner();
    const s = await staffOf(p.id);
    const r = await uc.updateStaff.execute({
      actor,
      partnerId: p.id,
      staffId: s.id,
      pin: '135790',
      deviceId: null,
    });
    expect(r.isOk() && r.value.deviceId).toBeNull();
    expect(audit.entries.at(-1)).toMatchObject({
      action: 'partner.staff_update',
      meta: { partnerId: p.id, fields: ['pin', 'deviceId'], active: true },
    });
    expect(JSON.stringify(audit.entries)).not.toContain('135790');
    expect((await uc.listStaff.execute(p.id)).unwrapOr([])).toHaveLength(1);
  });
});

describe('PartnerStaffLogin', () => {
  it('đúng PIN + thiết bị → token TTL ca làm việc, xác thực được', async () => {
    const p = await partner();
    const s = await staffOf(p.id);
    const r = await uc.login.execute({ staffId: s.id, pin: PIN, deviceId: DEVICE });
    if (r.isErr()) throw new Error(r.error.code);
    expect(r.value.expiresAt).toEqual(addDuration(T0, { hours: PARTNER_STAFF_TOKEN_TTL_HOURS }));
    expect(r.value.partner).toEqual({ id: p.id, name: p.name });
    const auth = await uc.authenticate.execute(r.value.token);
    expect(auth.isOk() && auth.value).toEqual({
      staffId: s.id,
      staffName: 'Lan',
      partnerId: p.id,
      partnerName: p.name,
    });
  });

  it('mã nhân viên không tồn tại → PARTNER_LOGIN_FAILED (vẫn chạy so khớp PIN giả)', async () => {
    for (const staffId of [newId(), 'garbage']) {
      const r = await uc.login.execute({ staffId, pin: PIN, deviceId: DEVICE });
      expect(r.isErr() && r.error.code).toBe('PARTNER_LOGIN_FAILED');
    }
    expect(pins.verifiedWithNull).toBe(2);
  });

  it('sai PIN được lưu dù trả lỗi; đủ số lần → khoá, PIN đúng cũng bị chặn', async () => {
    const p = await partner();
    const s = await staffOf(p.id);
    for (let i = 1; i < PARTNER_MAX_FAILED_LOGINS; i++) {
      const r = await uc.login.execute({ staffId: s.id, pin: '000000', deviceId: DEVICE });
      expect(r.isErr() && r.error.code).toBe('PARTNER_LOGIN_FAILED');
    }
    expect(store.staffRows.get(s.id)?.failedLogins).toBe(PARTNER_MAX_FAILED_LOGINS - 1);
    const locked = await uc.login.execute({ staffId: s.id, pin: '000000', deviceId: DEVICE });
    expect(locked.isErr() && locked.error.code).toBe('PARTNER_STAFF_LOCKED');
    const right = await uc.login.execute({ staffId: s.id, pin: PIN, deviceId: DEVICE });
    expect(right.isErr() && right.error.code).toBe('PARTNER_STAFF_LOCKED');
  });

  it('thiết bị khác thiết bị đã đăng ký → PARTNER_LOGIN_FAILED', async () => {
    const p = await partner();
    const s = await staffOf(p.id);
    const r = await uc.login.execute({ staffId: s.id, pin: PIN, deviceId: 'device-bbbb-0002' });
    expect(r.isErr() && r.error.code).toBe('PARTNER_LOGIN_FAILED');
  });

  it('AC1: quán bị tắt → PARTNER_INACTIVE (không gắn thiết bị); nhân viên bị vô hiệu hoá cũng vậy', async () => {
    const p = await partner();
    const s = await staffOf(p.id, null);
    await uc.updatePartner.execute({ actor, partnerId: p.id, patch: { active: false } });
    const r = await uc.login.execute({ staffId: s.id, pin: PIN, deviceId: DEVICE });
    expect(r.isErr() && r.error.code).toBe('PARTNER_INACTIVE');
    expect(store.staffRows.get(s.id)?.deviceId).toBeNull();

    await uc.updatePartner.execute({ actor, partnerId: p.id, patch: { active: true } });
    await uc.updateStaff.execute({ actor, partnerId: p.id, staffId: s.id, active: false });
    const r2 = await uc.login.execute({ staffId: s.id, pin: PIN, deviceId: DEVICE });
    expect(r2.isErr() && r2.error.code).toBe('PARTNER_INACTIVE');
  });
});

describe('AuthenticatePartnerStaff', () => {
  async function loggedIn() {
    const p = await partner();
    const s = await staffOf(p.id);
    const r = await uc.login.execute({ staffId: s.id, pin: PIN, deviceId: DEVICE });
    if (r.isErr()) throw new Error(r.error.code);
    return { p, s, token: r.value.token };
  }

  it('AC1: quán bị tắt sau khi cấp token → token cũ bị từ chối (PARTNER_INACTIVE)', async () => {
    const { p, token } = await loggedIn();
    await uc.updatePartner.execute({ actor, partnerId: p.id, patch: { active: false } });
    const r = await uc.authenticate.execute(token);
    expect(r.isErr() && r.error.code).toBe('PARTNER_INACTIVE');
  });

  it('đặt lại PIN / vô hiệu hoá nhân viên → token cũ PARTNER_TOKEN_INVALID', async () => {
    const { p, s, token } = await loggedIn();
    await uc.updateStaff.execute({ actor, partnerId: p.id, staffId: s.id, pin: '135790' });
    const r = await uc.authenticate.execute(token);
    expect(r.isErr() && r.error.code).toBe('PARTNER_TOKEN_INVALID');
  });

  it('token hết hạn hoặc rác → PARTNER_TOKEN_INVALID', async () => {
    const { token } = await loggedIn();
    clock.set(addDuration(T0, { hours: PARTNER_STAFF_TOKEN_TTL_HOURS }));
    const expired = await uc.authenticate.execute(token);
    expect(expired.isErr() && expired.error.code).toBe('PARTNER_TOKEN_INVALID');
    const garbage = await uc.authenticate.execute('nope');
    expect(garbage.isErr() && garbage.error.code).toBe('PARTNER_TOKEN_INVALID');
  });
});
