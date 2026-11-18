import { ADMIN_PERMISSIONS as CONTRACT_PERMISSIONS, ADMIN_ROLES as CONTRACT_ROLES } from '@tamgiao/contracts';
import { FakeClock, newId } from '@tamgiao/kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthenticateAdmin } from '../application/queries/authenticate-admin.js';
import { AdminLogin } from '../application/use-cases/admin-login.js';
import { AdminLogout } from '../application/use-cases/admin-logout.js';
import { CreateAdminUser } from '../application/use-cases/create-admin-user.js';
import { ADMIN_REMEMBERED_SESSION_TTL_HOURS, ADMIN_SESSION_TTL_HOURS } from '../domain/admin-session.js';
import {
  ADMIN_LOCK_MINUTES,
  ADMIN_MAX_FAILED_LOGINS,
  AdminEmail,
  AdminUser,
  type AdminUserId,
} from '../domain/admin-user.js';
import { ADMIN_PERMISSIONS, ADMIN_ROLES, ROLE_PERMISSIONS, hasPermission } from '../domain/permissions.js';
import {
  FakePasswordHasher,
  FakeRefreshTokenSecrets,
  FakeTotp,
  FakeUnitOfWork,
  InMemoryAdminSessionRepository,
  InMemoryAdminUserRepository,
} from './fakes.js';

const EMAIL = 'Ops@TamGiao.vn';
const PASSWORD = 'correct horse battery';
const codeOf = (r: { isErr(): boolean; error?: { code: string } }) => (r.isErr() ? r.error?.code : undefined);

function setup() {
  const clock = new FakeClock(new Date('2026-11-16T08:00:00.000Z'));
  const admins = new InMemoryAdminUserRepository();
  const sessions = new InMemoryAdminSessionRepository();
  const passwords = new FakePasswordHasher();
  const totp = new FakeTotp();
  const tokens = new FakeRefreshTokenSecrets();
  const uow = new FakeUnitOfWork([admins.table, sessions.table]);
  return {
    clock,
    admins,
    sessions,
    passwords,
    create: new CreateAdminUser({ uow, clock, admins, passwords, totp }),
    login: new AdminLogin({ uow, clock, admins, sessions, passwords, totp, tokens }),
    logout: new AdminLogout({ uow, clock, sessions, tokens }),
    authenticate: new AuthenticateAdmin({ uow, clock, admins, sessions, tokens }),
    code: () => FakeTotp.codeAt(clock.now()),
  };
}

let t: ReturnType<typeof setup>;
beforeEach(async () => {
  t = setup();
});

const seed = async (role = 'ADMIN') => {
  const r = await t.create.execute({ email: EMAIL, password: PASSWORD, role });
  if (r.isErr()) throw new Error(r.error.code);
  return r.value;
};

describe('Bảng permission', () => {
  it('khớp với danh sách ở contracts', () => {
    expect([...ADMIN_PERMISSIONS]).toEqual([...CONTRACT_PERMISSIONS]);
    expect([...ADMIN_ROLES]).toEqual([...CONTRACT_ROLES]);
  });

  it('MATCHMAKER không có kyc:review; REVIEWER có; ADMIN có mọi quyền', () => {
    expect(hasPermission('MATCHMAKER', 'kyc:review')).toBe(false);
    expect(hasPermission('REVIEWER', 'kyc:review')).toBe(true);
    expect([...ROLE_PERMISSIONS.ADMIN]).toEqual([...ADMIN_PERMISSIONS]);
    expect(hasPermission('ADMIN', 'not:exists')).toBe(false);
  });
});

describe('AdminUser (domain)', () => {
  const now = new Date('2026-11-16T08:00:00.000Z');
  const make = () => {
    const email = AdminEmail.parse(EMAIL);
    if (email.isErr()) throw new Error('email');
    return AdminUser.create(
      {
        id: newId<'AdminUser'>() as AdminUserId,
        email: email.value,
        passwordHash: 'h',
        totpSecret: 's',
        role: 'REVIEWER',
      },
      now,
    );
  };

  it('đúng mật khẩu + TOTP → ok, ghi bước TOTP', () => {
    const a = make();
    expect(a.login({ passwordMatches: true, totpStep: 100 }, now).isOk()).toBe(true);
    expect(a.toState().lastTotpStep).toBe(100);
  });

  it('đúng mật khẩu nhưng TOTP sai → INVALID_CREDENTIALS (AC1)', () => {
    expect(codeOf(make().login({ passwordMatches: true, totpStep: null }, now))).toBe('INVALID_CREDENTIALS');
  });

  it('dùng lại mã TOTP cùng bước hoặc cũ hơn → INVALID_CREDENTIALS', () => {
    const a = make();
    a.login({ passwordMatches: true, totpStep: 100 }, now);
    expect(codeOf(a.login({ passwordMatches: true, totpStep: 100 }, now))).toBe('INVALID_CREDENTIALS');
    expect(codeOf(a.login({ passwordMatches: true, totpStep: 99 }, now))).toBe('INVALID_CREDENTIALS');
    expect(a.login({ passwordMatches: true, totpStep: 101 }, now).isOk()).toBe(true);
  });

  it(`sai ${ADMIN_MAX_FAILED_LOGINS} lần → khoá ${ADMIN_LOCK_MINUTES} phút, hết khoá thì đăng nhập lại được (AC3)`, () => {
    const a = make();
    for (let i = 1; i < ADMIN_MAX_FAILED_LOGINS; i++) {
      expect(codeOf(a.login({ passwordMatches: false, totpStep: 1 }, now))).toBe('INVALID_CREDENTIALS');
    }
    const locked = a.login({ passwordMatches: false, totpStep: 1 }, now);
    expect(locked.isErr() && locked.error).toEqual({
      code: 'ADMIN_LOCKED',
      details: { retryAfterSeconds: ADMIN_LOCK_MINUTES * 60 },
    });
    // Đang khoá: kể cả đúng cũng bị từ chối.
    const almost = new Date(now.getTime() + (ADMIN_LOCK_MINUTES * 60 - 1) * 1_000);
    expect(codeOf(a.login({ passwordMatches: true, totpStep: 5 }, almost))).toBe('ADMIN_LOCKED');
    const after = new Date(now.getTime() + ADMIN_LOCK_MINUTES * 60_000);
    expect(a.login({ passwordMatches: true, totpStep: 5 }, after).isOk()).toBe(true);
  });

  it('đăng nhập thành công reset bộ đếm lần sai', () => {
    const a = make();
    for (let i = 1; i < ADMIN_MAX_FAILED_LOGINS; i++) a.login({ passwordMatches: false, totpStep: 1 }, now);
    a.login({ passwordMatches: true, totpStep: 2 }, now);
    expect(a.toState().failedLogins).toBe(0);
  });

  it('AdminEmail chuẩn hoá chữ thường, từ chối sai định dạng', () => {
    const e = AdminEmail.parse('  Ops@TamGiao.VN ');
    expect(e.isOk() && e.value.value).toBe('ops@tamgiao.vn');
    expect(AdminEmail.parse('not-an-email').isErr()).toBe(true);
  });
});

describe('CreateAdminUser', () => {
  it('tạo admin, trả otpauth URI; email trùng (khác hoa/thường) → ADMIN_EMAIL_TAKEN', async () => {
    const created = await seed();
    expect(created.otpauthUri).toContain('ops@tamgiao.vn');
    const dup = await t.create.execute({ email: 'ops@tamgiao.vn', password: PASSWORD, role: 'REVIEWER' });
    expect(codeOf(dup)).toBe('ADMIN_EMAIL_TAKEN');
  });

  it('mật khẩu ngắn → PASSWORD_TOO_WEAK; role lạ → VALIDATION_FAILED', async () => {
    expect(codeOf(await t.create.execute({ email: EMAIL, password: 'short', role: 'ADMIN' }))).toBe(
      'PASSWORD_TOO_WEAK',
    );
    expect(codeOf(await t.create.execute({ email: EMAIL, password: PASSWORD, role: 'ROOT' }))).toBe(
      'VALIDATION_FAILED',
    );
  });
});

describe('AdminLogin / AuthenticateAdmin / AdminLogout', () => {
  it('đúng mật khẩu + TOTP → token phiên 8h, xác thực ra role + permission', async () => {
    const { adminId } = await seed('REVIEWER');
    const r = await t.login.execute({ email: EMAIL, password: PASSWORD, totpCode: t.code() });
    if (!r.isOk()) throw new Error('login phải thành công');
    expect(r.value.expiresAt.getTime() - t.clock.now().getTime()).toBe(ADMIN_SESSION_TTL_HOURS * 3_600_000);
    expect(r.value.admin).toMatchObject({ id: adminId, role: 'REVIEWER', email: 'ops@tamgiao.vn' });

    const auth = await t.authenticate.execute(r.value.token);
    expect(auth.isOk() && auth.value).toMatchObject({
      adminId,
      role: 'REVIEWER',
      permissions: ['kyc:review', 'kyc:decide'],
    });
  });

  it('ghi nhớ thiết bị → phiên 12h; quá hạn → UNAUTHENTICATED', async () => {
    await seed();
    const r = await t.login.execute({
      email: EMAIL,
      password: PASSWORD,
      totpCode: t.code(),
      rememberDevice: true,
    });
    if (!r.isOk()) throw new Error('login');
    t.clock.advance({ hours: ADMIN_REMEMBERED_SESSION_TTL_HOURS - 1 });
    expect((await t.authenticate.execute(r.value.token)).isOk()).toBe(true);
    t.clock.advance({ hours: 1 });
    expect(codeOf(await t.authenticate.execute(r.value.token))).toBe('UNAUTHENTICATED');
  });

  it('thiếu TOTP → MFA_REQUIRED, không kiểm tra mật khẩu, không tính lần sai (AC1)', async () => {
    await seed();
    const r = await t.login.execute({ email: EMAIL, password: PASSWORD });
    expect(codeOf(r)).toBe('MFA_REQUIRED');
    expect([...t.admins.table.rows.values()][0]?.failedLogins).toBe(0);
  });

  it('đúng mật khẩu, sai TOTP → INVALID_CREDENTIALS, không có phiên (AC1)', async () => {
    await seed();
    const r = await t.login.execute({ email: EMAIL, password: PASSWORD, totpCode: '999999' });
    expect(codeOf(r)).toBe('INVALID_CREDENTIALS');
    expect(t.sessions.table.rows.size).toBe(0);
  });

  it('email không tồn tại → INVALID_CREDENTIALS và vẫn chạy so khớp giả (chống dò email)', async () => {
    const r = await t.login.execute({ email: 'nobody@tamgiao.vn', password: PASSWORD, totpCode: t.code() });
    expect(codeOf(r)).toBe('INVALID_CREDENTIALS');
    expect(t.passwords.dummyChecks).toBe(1);
  });

  it('sai 5 lần → ADMIN_LOCKED (lần sai được commit qua từng request); 15 phút sau đăng nhập được (AC3)', async () => {
    await seed();
    for (let i = 1; i < ADMIN_MAX_FAILED_LOGINS; i++) {
      const r = await t.login.execute({ email: EMAIL, password: 'wrong password!', totpCode: t.code() });
      expect(codeOf(r)).toBe('INVALID_CREDENTIALS');
    }
    const locked = await t.login.execute({ email: EMAIL, password: 'wrong password!', totpCode: t.code() });
    expect(codeOf(locked)).toBe('ADMIN_LOCKED');
    expect(codeOf(await t.login.execute({ email: EMAIL, password: PASSWORD, totpCode: t.code() }))).toBe(
      'ADMIN_LOCKED',
    );
    t.clock.advance({ minutes: ADMIN_LOCK_MINUTES });
    expect((await t.login.execute({ email: EMAIL, password: PASSWORD, totpCode: t.code() })).isOk()).toBe(
      true,
    );
  });

  it('logout thu hồi phiên ngay; token rác → UNAUTHENTICATED', async () => {
    await seed();
    const r = await t.login.execute({ email: EMAIL, password: PASSWORD, totpCode: t.code() });
    if (!r.isOk()) throw new Error('login');
    await t.logout.execute(r.value.token);
    expect(codeOf(await t.authenticate.execute(r.value.token))).toBe('UNAUTHENTICATED');
    expect(codeOf(await t.authenticate.execute('garbage'))).toBe('UNAUTHENTICATED');
  });
});
