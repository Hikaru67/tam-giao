import { auditLogListResponseSchema, problemSchema } from '@tamgiao/contracts';
import { err, newId } from '@tamgiao/kernel';
import { resetDatabase } from '@tamgiao/testing';
import { DrizzleUnitOfWork, asDbTx } from '@tamgiao/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AuditLogInput } from '../application/facade.js';
import { Rfc6238Totp } from '../infrastructure/rfc6238-totp.js';
import { auditLogs } from '../infrastructure/schema.js';
import { createIdentityHarness, type IdentityHarness } from './harness.js';

const PASSWORD = 'correct horse battery staple';
const totp = new Rfc6238Totp();
let h: IdentityHarness;

beforeAll(() => {
  h = createIdentityHarness();
});
beforeEach(async () => {
  await resetDatabase(h.database.pool);
});
afterAll(() => h.database.close());

const adminActor = newId<'AdminUser'>();
const entry = (patch: Partial<AuditLogInput> = {}): AuditLogInput => ({
  actor: { type: 'admin', id: adminActor },
  action: 'kyc.view_detail',
  targetType: 'kyc_submission',
  targetId: 'sub-1',
  ip: '203.0.113.7',
  meta: { step: 'id_card' },
  ...patch,
});

async function logOk(input: AuditLogInput): Promise<void> {
  const r = await h.module.auditLogger.log(input);
  if (r.isErr()) throw new Error(r.error.code);
}

const count = async (): Promise<number> =>
  (await h.database.pool.query<{ n: number }>('select count(*)::int as n from identity.audit_logs')).rows[0]
    ?.n ?? -1;

/** Lỗi Postgres do trigger append-only ném ra (`pg` ném trực tiếp, Drizzle bọc trong `cause`). */
const expectAppendOnlyViolation = async (run: () => Promise<unknown>) => {
  const error: unknown = await run().then(
    () => undefined,
    (e: unknown) => e,
  );
  const pgError = error instanceof Error && error.cause instanceof Error ? error.cause : error;
  expect(pgError).toMatchObject({ code: '42501', message: expect.stringContaining('append-only') });
};

describe('identity.audit_logs append-only (AC1)', () => {
  it('the app DB role can INSERT and SELECT', async () => {
    await logOk(entry());
    const { rows } = await h.database.pool.query(
      'select actor_type, actor_id, action, target_type, target_id, ip, meta from identity.audit_logs',
    );
    expect(rows).toEqual([
      {
        actor_type: 'admin',
        actor_id: adminActor,
        action: 'kyc.view_detail',
        target_type: 'kyc_submission',
        target_id: 'sub-1',
        ip: '203.0.113.7',
        meta: { step: 'id_card' },
      },
    ]);
  });

  it('the app DB role cannot UPDATE or DELETE rows (raw SQL)', async () => {
    await logOk(entry());
    await expectAppendOnlyViolation(() =>
      h.database.pool.query(`update identity.audit_logs set action = 'kyc.tampered'`),
    );
    await expectAppendOnlyViolation(() => h.database.pool.query('delete from identity.audit_logs'));
    // Câu lệnh không khớp dòng nào cũng bị chặn (trigger cấp câu lệnh).
    await expectAppendOnlyViolation(() =>
      h.database.pool.query(`delete from identity.audit_logs where target_id = 'does-not-exist'`),
    );
    expect(await count()).toBe(1);
    const { rows } = await h.database.pool.query<{ action: string }>(
      'select action from identity.audit_logs',
    );
    expect(rows[0]?.action).toBe('kyc.view_detail');
  });

  it('the app DB role cannot UPDATE or DELETE through Drizzle inside a UnitOfWork', async () => {
    await logOk(entry());
    const uow = new DrizzleUnitOfWork(h.database.pool);
    await expectAppendOnlyViolation(() =>
      uow.run(async (tx) => {
        await asDbTx(tx).update(auditLogs).set({ meta: {} });
        return err('UNREACHABLE');
      }),
    );
    await expectAppendOnlyViolation(() =>
      uow.run(async (tx) => {
        await asDbTx(tx)
          .delete(auditLogs)
          .where(sql`true`);
        return err('UNREACHABLE');
      }),
    );
    expect(await count()).toBe(1);
  });

  it('UPDATE/DELETE/TRUNCATE are revoked from PUBLIC', async () => {
    const { rows } = await h.database.pool.query<{ privilege: string }>(
      `select privilege_type as privilege from information_schema.role_table_grants
        where table_schema = 'identity' and table_name = 'audit_logs' and grantee = 'PUBLIC'`,
    );
    expect(rows.map((r) => r.privilege)).not.toEqual(expect.arrayContaining(['UPDATE']));
    expect(rows.map((r) => r.privilege)).not.toEqual(expect.arrayContaining(['DELETE']));
    expect(rows.map((r) => r.privilege)).not.toEqual(expect.arrayContaining(['TRUNCATE']));
  });
});

describe('AuditLogger facade', () => {
  it('log(tx, …) commits/rolls back together with the business transaction', async () => {
    const uow = new DrizzleUnitOfWork(h.database.pool);
    await uow.run(async (tx) => {
      await h.module.auditLogger.log(tx, entry({ targetId: 'rolled-back' }));
      return err('BUSINESS_FAILED');
    });
    expect(await count()).toBe(0);
  });

  it('meta with a PII key is rejected before touching the DB (AC2)', async () => {
    const r = await h.module.auditLogger.log(entry({ meta: { cccdNumber: '001099012345' } }));
    expect(r.isErr() && r.error.code).toBe('AUDIT_ENTRY_INVALID');
    expect(await count()).toBe(0);
  });
});

describe('GET /admin/audit-logs', () => {
  async function adminToken(email: string, role: string): Promise<string> {
    const created = await h.module.commands.createAdminUser.execute({ email, password: PASSWORD, role });
    if (created.isErr()) throw new Error(created.error.code);
    const secret = new URL(created.value.otpauthUri).searchParams.get('secret') ?? '';
    const res = await h.post('/admin/auth/login', {
      email,
      password: PASSWORD,
      totpCode: totp.generate(secret, h.clock.now()),
    });
    expect(res.status).toBe(200);
    return ((await res.json()) as { token: string }).token;
  }
  const get = (path: string, token?: string) =>
    h.app.request(path, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  const list = async (path: string, token: string) => {
    const res = await get(path, token);
    expect(res.status).toBe(200);
    return auditLogListResponseSchema.parse(await res.json());
  };

  it('requires login and the audit:read permission', async () => {
    expect((await get('/admin/audit-logs')).status).toBe(401);
    const reviewer = await adminToken('reviewer@tamgiao.vn', 'REVIEWER');
    const res = await get('/admin/audit-logs', reviewer);
    expect(res.status).toBe(403);
    expect(problemSchema.parse(await res.json()).code).toBe('FORBIDDEN');
  });

  it('lists newest first, filters by actor/target/time and pages with a cursor', async () => {
    const supervisor = await adminToken('lead@tamgiao.vn', 'SUPERVISOR');
    const otherAdmin = newId<'AdminUser'>();
    const start = h.clock.now();
    for (let i = 0; i < 5; i++) {
      await logOk(
        entry({ targetId: `sub-${i}`, actor: { type: 'admin', id: i % 2 ? otherAdmin : adminActor } }),
      );
      h.clock.advance({ minutes: 1 });
    }
    await logOk(entry({ actor: { type: 'system' }, action: 'kyc.purge_media', targetId: 'sub-0', ip: null }));

    const p1 = await list('/admin/audit-logs?limit=4', supervisor);
    expect(p1.items.map((e) => e.targetId)).toEqual(['sub-0', 'sub-4', 'sub-3', 'sub-2']);
    expect(p1.items[0]).toMatchObject({
      actor: { type: 'system', id: null },
      action: 'kyc.purge_media',
      ip: null,
    });
    expect(p1.nextCursor).not.toBeNull();
    const p2 = await list(`/admin/audit-logs?limit=4&cursor=${p1.nextCursor ?? ''}`, supervisor);
    expect(p2.items.map((e) => e.targetId)).toEqual(['sub-1', 'sub-0']);
    expect(p2.nextCursor).toBeNull();

    const byActor = await list(`/admin/audit-logs?actorId=${otherAdmin}`, supervisor);
    expect(byActor.items.map((e) => e.targetId)).toEqual(['sub-3', 'sub-1']);

    const byTarget = await list('/admin/audit-logs?targetType=kyc_submission&targetId=sub-0', supervisor);
    expect(byTarget.items).toHaveLength(2);

    const from = new Date(start.getTime() + 60_000).toISOString();
    const to = new Date(start.getTime() + 3 * 60_000).toISOString();
    const byTime = await list(`/admin/audit-logs?from=${from}&to=${to}`, supervisor);
    expect(byTime.items.map((e) => e.targetId)).toEqual(['sub-2', 'sub-1']);
  });

  it('rejects an invalid query with 422 VALIDATION_FAILED', async () => {
    const supervisor = await adminToken('lead@tamgiao.vn', 'SUPERVISOR');
    for (const qs of [
      'cursor=garbage',
      'limit=500',
      'actorId=nope',
      'from=2026-11-18T00:00:00Z&to=2026-11-17T00:00:00Z',
    ]) {
      const res = await get(`/admin/audit-logs?${qs}`, supervisor);
      expect(res.status, qs).toBe(422);
      expect(problemSchema.parse(await res.json()).code).toBe('VALIDATION_FAILED');
    }
  });
});
