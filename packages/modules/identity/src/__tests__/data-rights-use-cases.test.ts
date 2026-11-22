import { OTP_MAX_ATTEMPTS } from '@tamgiao/contracts/constants';
import { FakeClock, newId, type Tx } from '@tamgiao/kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import type { PersonalDataSource } from '../application/ports/data-rights.js';
import { DownloadDataExport } from '../application/queries/download-data-export.js';
import { GetAccountDeletionStatus } from '../application/queries/get-account-deletion-status.js';
import { GetDataExport } from '../application/queries/get-data-export.js';
import { BuildDataExport } from '../application/use-cases/build-data-export.js';
import { DeleteAccount } from '../application/use-cases/delete-account.js';
import { PurgeExpiredDataExports } from '../application/use-cases/purge-expired-data-exports.js';
import { RequestAccountDeletionOtp } from '../application/use-cases/request-account-deletion-otp.js';
import { RequestDataExport } from '../application/use-cases/request-data-export.js';
import { PhoneNumber } from '../domain/phone-number.js';
import { Session, type SessionId } from '../domain/session.js';
import { User } from '../domain/user.js';
import {
  FakeConsumerProgressReader,
  FakeLinkSigner,
  FakeObjectStorage,
  InMemoryAccountDeletionRepository,
  InMemoryDataExportRepository,
  RecordingAuditLogger,
} from './data-rights-fakes.js';
import {
  FakeBlindIndexer,
  FakeOtpSecrets,
  FakeUnitOfWork,
  InMemoryOtpChallengeRepository,
  InMemoryRateLimiter,
  InMemorySessionRepository,
  InMemoryUserRepository,
  RecordingSmsSender,
} from './fakes.js';

const IP = '203.0.113.7';
const STEPS = [
  { module: 'profile', consumer: 'profile.erase-on-account-deletion' },
  { module: 'matching', consumer: 'matching.erase-on-account-deletion' },
];

function setup() {
  const clock = new FakeClock(new Date('2026-11-20T08:00:00.000Z'));
  const users = new InMemoryUserRepository();
  const challenges = new InMemoryOtpChallengeRepository();
  const rateLimiter = new InMemoryRateLimiter();
  const sms = new RecordingSmsSender();
  const otpSecrets = new FakeOtpSecrets();
  const blindIndexer = new FakeBlindIndexer();
  const sessions = new InMemorySessionRepository();
  const dataExports = new InMemoryDataExportRepository();
  const deletions = new InMemoryAccountDeletionRepository();
  const progress = new FakeConsumerProgressReader();
  const signer = new FakeLinkSigner();
  const auditLogger = new RecordingAuditLogger();
  const storage = new FakeObjectStorage(() => clock.now());
  const uow = new FakeUnitOfWork([
    users.table,
    users.deleted,
    challenges.table,
    rateLimiter.table,
    sessions.table,
    dataExports.table,
    dataExports.payloads,
    dataExports.events,
    deletions.table,
    deletions.events,
  ]);
  const deps = { uow, clock, users, dataExports, signer };
  return {
    clock,
    users,
    challenges,
    sms,
    sessions,
    dataExports,
    deletions,
    progress,
    auditLogger,
    storage,
    requestDataExport: new RequestDataExport(deps),
    getDataExport: new GetDataExport({ uow, clock, dataExports, signer }),
    downloadDataExport: new DownloadDataExport({ uow, clock, dataExports, signer, storage }),
    purge: new PurgeExpiredDataExports({ uow, clock, dataExports }),
    requestOtp: new RequestAccountDeletionOtp({
      uow,
      clock,
      users,
      challenges,
      rateLimiter,
      otpSecrets,
      sms,
      blindIndexer,
    }),
    deleteAccount: new DeleteAccount({
      uow,
      clock,
      users,
      challenges,
      otpSecrets,
      sessions,
      deletions,
      dataExports,
      auditLogger,
      steps: STEPS,
    }),
    status: new GetAccountDeletionStatus({ uow, deletions, progress, steps: STEPS }),
  };
}

let t: ReturnType<typeof setup>;
const tx = {} as Tx;

async function seedUser(phone = '0912345678'): Promise<User> {
  const parsed = PhoneNumber.parse(phone);
  if (parsed.isErr()) throw new Error('phone');
  const user = User.register(parsed.value, t.clock.now());
  await t.users.save(tx, user);
  return user;
}

async function seedSession(userId: User['id']): Promise<SessionId> {
  const id = newId<'Session'>();
  await t.sessions.save(
    tx,
    Session.restore({
      id,
      userId,
      deviceName: 'iPhone',
      createdAt: t.clock.now(),
      lastUsedAt: t.clock.now(),
      revokedAt: null,
      revokeReason: null,
    }),
  );
  return id;
}

beforeEach(() => {
  t = setup();
});

describe('RequestDataExport / BuildDataExport / GetDataExport (BE-S7-06)', () => {
  it('tạo yêu cầu PENDING + DataExportRequested; gọi lại khi đang dựng → trả lại đúng yêu cầu đó', async () => {
    const user = await seedUser();
    const first = await t.requestDataExport.execute({ userId: user.id });
    expect(first.isOk() && first.value.created).toBe(true);
    expect(first.isOk() && first.value.view).toMatchObject({ status: 'PENDING', downloadUrl: null });
    const again = await t.requestDataExport.execute({ userId: user.id });
    expect(again.isOk() && again.value).toMatchObject({ created: false });
    expect(again.isOk() && first.isOk() && again.value.view.exportId).toBe(
      first.isOk() ? first.value.view.exportId : '',
    );
    expect([...t.dataExports.events.rows.values()].map((e) => e.type)).toEqual(['DataExportRequested']);
  });

  it('tài khoản đã xoá không yêu cầu xuất được', async () => {
    const user = await seedUser();
    await t.users.anonymize(tx, user.id, t.clock.now());
    const r = await t.requestDataExport.execute({ userId: user.id });
    expect(r.isErr() && r.error.code).toBe('UNAUTHENTICATED');
  });

  it('AC2: build gom mục của mọi nguồn cho đúng chủ yêu cầu → READY + link ký; tải trả JSON + presigned ảnh', async () => {
    const user = await seedUser();
    const r = await t.requestDataExport.execute({ userId: user.id });
    const exportId = r.isOk() ? r.value.view.exportId : '';
    const askedFor: string[] = [];
    const sources: PersonalDataSource[] = [
      {
        section: 'profile',
        collect: async (_tx, userId) => {
          askedFor.push(userId);
          return {
            data: { fullName: 'Nguyễn Văn A' },
            files: [
              { bucket: 'publicProfile', key: `profile_photo/${userId}/1.jpg`, label: 'profile_photo_1' },
            ],
          };
        },
      },
      { section: 'billing', collect: async () => ({ data: { payments: [] }, files: [] }) },
    ];
    const build = new BuildDataExport({ clock: t.clock, dataExports: t.dataExports, sources });
    expect(await build.handle(tx, { exportId })).toBe('BUILT');
    expect(await build.handle(tx, { exportId })).toBe('ALREADY_BUILT');
    expect(await build.handle(tx, { exportId: newId() })).toBe('NOT_FOUND');
    expect(askedFor).toEqual([user.id]);

    const view = await t.getDataExport.execute({ userId: user.id, exportId });
    expect(view.isOk() && view.value.status).toBe('READY');
    const url = view.isOk() ? (view.value.downloadUrl ?? '') : '';
    const parsed = new URL(url, 'http://api.test');
    expect(parsed.pathname).toBe(`/data-exports/${exportId}/download`);

    const doc = await t.downloadDataExport.execute({
      exportId,
      expires: Number(parsed.searchParams.get('expires')),
      signature: parsed.searchParams.get('sig') ?? '',
    });
    expect(doc.isOk() && doc.value).toMatchObject({
      exportId,
      userId: user.id,
      sections: { profile: { fullName: 'Nguyễn Văn A' }, billing: { payments: [] } },
      files: [{ section: 'profile', label: 'profile_photo_1' }],
    });
    expect(doc.isOk() && doc.value.files[0]?.url).toContain(`publicProfile/profile_photo/${user.id}/1.jpg`);
  });

  it('xem yêu cầu của người khác → NOT_FOUND; id sai → INVALID_ID', async () => {
    const owner = await seedUser();
    const other = await seedUser('0987654321');
    const r = await t.requestDataExport.execute({ userId: owner.id });
    const exportId = r.isOk() ? r.value.view.exportId : '';
    const view = await t.getDataExport.execute({ userId: other.id, exportId });
    expect(view.isErr() && view.error.code).toBe('NOT_FOUND');
    const bad = await t.getDataExport.execute({ userId: owner.id, exportId: 'x' });
    expect(bad.isErr() && bad.error.code).toBe('INVALID_ID');
  });

  it('tải: sai chữ ký / sửa expires → LINK_INVALID; chưa xong → NOT_READY; quá 24h → EXPIRED; purge xoá nội dung', async () => {
    const user = await seedUser();
    const r = await t.requestDataExport.execute({ userId: user.id });
    const exportId = r.isOk() ? r.value.view.exportId : '';
    const signer = new FakeLinkSigner();
    const pending = await t.downloadDataExport.execute({
      exportId,
      expires: 1,
      signature: signer.sign(exportId, 1),
    });
    expect(pending.isErr() && pending.error.code).toBe('DATA_EXPORT_NOT_READY');

    await new BuildDataExport({ clock: t.clock, dataExports: t.dataExports, sources: [] }).handle(tx, {
      exportId,
    });
    const expires = Math.floor(t.clock.now().getTime() / 1000) + 24 * 3600;
    const forged = await t.downloadDataExport.execute({
      exportId,
      expires,
      signature: 'sig-forged-0000000000',
    });
    expect(forged.isErr() && forged.error.code).toBe('DATA_EXPORT_LINK_INVALID');
    const shifted = await t.downloadDataExport.execute({
      exportId,
      expires: expires + 3600,
      signature: signer.sign(exportId, expires + 3600),
    });
    expect(shifted.isErr() && shifted.error.code).toBe('DATA_EXPORT_LINK_INVALID');
    const okNow = await t.downloadDataExport.execute({
      exportId,
      expires,
      signature: signer.sign(exportId, expires),
    });
    expect(okNow.isOk()).toBe(true);

    t.clock.advance({ hours: 24 });
    const late = await t.downloadDataExport.execute({
      exportId,
      expires,
      signature: signer.sign(exportId, expires),
    });
    expect(late.isErr() && late.error.code).toBe('DATA_EXPORT_EXPIRED');
    const view = await t.getDataExport.execute({ userId: user.id, exportId });
    expect(view.isOk() && view.value).toMatchObject({ status: 'EXPIRED', downloadUrl: null });
    expect(await t.purge.execute()).toBe(1);
    expect(await t.purge.execute()).toBe(0);
  });
});

describe('RequestAccountDeletionOtp / DeleteAccount / GetAccountDeletionStatus (BE-S7-06)', () => {
  it('gửi OTP xoá tài khoản tới SĐT của chính tài khoản; challenge tách khỏi đăng nhập', async () => {
    const user = await seedUser();
    const r = await t.requestOtp.execute({ userId: user.id, ip: IP });
    expect(r.isOk()).toBe(true);
    expect(t.sms.sent[0]?.to).toBe('+84912345678');
    expect(t.sms.sent[0]?.text).toContain('XOA TAI KHOAN');
    expect([...t.challenges.table.rows.keys()]).toEqual([`account-deletion:${user.id}`]);
  });

  it('OTP sai → OTP_INVALID và lần sai được commit; sai quá số lần → OTP_LOCKED; không xoá gì', async () => {
    const user = await seedUser();
    await t.requestOtp.execute({ userId: user.id, ip: IP });
    const wrong = await t.deleteAccount.execute({ userId: user.id, code: '999999' });
    expect(wrong.isErr() && wrong.error.code).toBe('OTP_INVALID');
    expect([...t.challenges.table.rows.values()][0]?.failedAttempts).toBe(1);
    for (let i = 1; i < OTP_MAX_ATTEMPTS; i++)
      await t.deleteAccount.execute({ userId: user.id, code: '999999' });
    const locked = await t.deleteAccount.execute({ userId: user.id, code: t.sms.lastCode() });
    expect(locked.isErr() && locked.error.code).toBe('OTP_LOCKED');
    expect(t.deletions.table.rows.size).toBe(0);
    expect(await t.users.findActiveById(tx, user.id)).not.toBeNull();
  });

  it('chưa yêu cầu OTP xoá → OTP_INVALID (mã đăng nhập không dùng được)', async () => {
    const user = await seedUser();
    const r = await t.deleteAccount.execute({ userId: user.id, code: '000000' });
    expect(r.isErr() && r.error.code).toBe('OTP_INVALID');
  });

  it('OTP đúng → yêu cầu + AccountDeletionRequested, ẩn danh SĐT, thu hồi mọi phiên, xoá file xuất, audit', async () => {
    const user = await seedUser();
    const sessionId = await seedSession(user.id);
    await t.requestDataExport.execute({ userId: user.id });
    await t.requestOtp.execute({ userId: user.id, ip: IP });
    const r = await t.deleteAccount.execute({ userId: user.id, code: t.sms.lastCode(), ip: IP });
    expect(r.isOk() && r.value).toMatchObject({
      status: 'PROCESSING',
      steps: [
        { module: 'profile', done: false },
        { module: 'matching', done: false },
      ],
    });
    const requestId = r.isOk() ? r.value.requestId : '';
    const [event] = [...t.deletions.events.rows.values()];
    expect(event).toMatchObject({
      type: 'AccountDeletionRequested',
      payload: { requestId, userId: user.id },
    });
    expect(await t.users.findActiveById(tx, user.id)).toBeNull();
    expect(t.users.deleted.rows.has(user.id)).toBe(true);
    expect((await t.sessions.findById(tx, sessionId))?.toState().revokeReason).toBe('ACCOUNT_DELETED');
    expect(t.dataExports.table.rows.size).toBe(0);
    expect(t.auditLogger.entries).toEqual([
      expect.objectContaining({
        action: 'identity.account_delete',
        actor: { type: 'user', id: user.id },
        meta: { requestId },
      }),
    ]);
  });

  it('tiến độ: PROCESSING tới khi mọi module xử lý xong event → COMPLETED; id sai / không có', async () => {
    const user = await seedUser();
    await t.requestOtp.execute({ userId: user.id, ip: IP });
    const r = await t.deleteAccount.execute({ userId: user.id, code: t.sms.lastCode() });
    const requestId = r.isOk() ? r.value.requestId : '';
    const eventId = [...t.deletions.events.rows.values()][0]?.eventId ?? '';

    t.progress.processed.add(`profile.erase-on-account-deletion|${eventId}`);
    const partial = await t.status.execute(requestId);
    expect(partial.isOk() && partial.value).toMatchObject({
      status: 'PROCESSING',
      steps: [
        { module: 'profile', done: true },
        { module: 'matching', done: false },
      ],
    });
    t.progress.processed.add(`matching.erase-on-account-deletion|${eventId}`);
    const done = await t.status.execute(requestId);
    expect(done.isOk() && done.value.status).toBe('COMPLETED');

    const bad = await t.status.execute('nope');
    expect(bad.isErr() && bad.error.code).toBe('INVALID_ID');
    const missing = await t.status.execute(newId());
    expect(missing.isErr() && missing.error.code).toBe('NOT_FOUND');
  });

  it('tài khoản đã xoá không yêu cầu được OTP xoá nữa', async () => {
    const user = await seedUser();
    await t.users.anonymize(tx, user.id, t.clock.now());
    const r = await t.requestOtp.execute({ userId: user.id, ip: IP });
    expect(r.isErr() && r.error.code).toBe('UNAUTHENTICATED');
    expect(t.sms.sent).toHaveLength(0);
  });
});
