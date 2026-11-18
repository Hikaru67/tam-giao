import { FakeClock, err, newId, type Tx } from '@tamgiao/kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AuditLogInput } from '../application/facade.js';
import { SearchAuditLogs } from '../application/queries/search-audit-logs.js';
import { RecordAuditEntry } from '../application/use-cases/record-audit-entry.js';
import { FakeUnitOfWork, InMemoryAuditLogRepository } from './fakes.js';

const adminA = newId<'AdminUser'>();
const adminB = newId<'AdminUser'>();
const entry = (patch: Partial<AuditLogInput> = {}): AuditLogInput => ({
  actor: { type: 'admin', id: adminA },
  action: 'kyc.view_detail',
  targetType: 'kyc_submission',
  targetId: 'sub-1',
  ip: '203.0.113.7',
  ...patch,
});

let clock: FakeClock;
let repo: InMemoryAuditLogRepository;
let uow: FakeUnitOfWork;
let logger: RecordAuditEntry;
let search: SearchAuditLogs;

beforeEach(() => {
  clock = new FakeClock(new Date('2026-11-18T00:00:00.000Z'));
  repo = new InMemoryAuditLogRepository();
  uow = new FakeUnitOfWork([repo.table]);
  logger = new RecordAuditEntry({ uow, clock, auditLogs: repo });
  search = new SearchAuditLogs({ uow, auditLogs: repo });
});

describe('RecordAuditEntry', () => {
  it('without tx: opens its own transaction and appends', async () => {
    const r = await logger.log(entry());
    expect(r.isOk()).toBe(true);
    const [row] = [...repo.table.rows.values()];
    expect(row).toMatchObject({ action: 'kyc.view_detail', occurredAt: clock.now() });
  });

  it('with tx: appends inside the caller transaction and rolls back with it', async () => {
    const r = await uow.run(async (tx: Tx) => {
      const logged = await logger.log(tx, entry());
      expect(logged.isOk()).toBe(true);
      expect(repo.table.rows.size).toBe(1);
      return err('BUSINESS_FAILED');
    });
    expect(r.isErr()).toBe(true);
    expect(repo.table.rows.size).toBe(0);
  });

  it('meta with a PII key → AUDIT_ENTRY_INVALID, nothing written', async () => {
    const r = await logger.log(entry({ meta: { phone: '0912345678' } }));
    expect(r.isErr() && r.error).toMatchObject({
      code: 'AUDIT_ENTRY_INVALID',
      details: { field: 'meta.phone', reason: 'FORBIDDEN_KEY' },
    });
    // Không lộ giá trị PII trong lỗi.
    expect(JSON.stringify(r)).not.toContain('0912345678');
    expect(repo.table.rows.size).toBe(0);
  });
});

describe('SearchAuditLogs', () => {
  async function seed(): Promise<void> {
    for (let i = 0; i < 5; i++) {
      await logger.log(
        entry({ targetId: `sub-${i}`, actor: { type: 'admin', id: i % 2 ? adminB : adminA } }),
      );
      clock.advance({ minutes: 1 });
    }
    await logger.log(entry({ actor: { type: 'system' }, action: 'kyc.purge_media', targetId: 'sub-0' }));
  }

  it('returns newest first and pages with a cursor until exhausted', async () => {
    await seed();
    const p1 = (await search.execute({ filter: {}, cursor: null, limit: 4 })).unwrapOr(undefined as never);
    expect(p1.items.map((e) => e.targetId)).toEqual(['sub-0', 'sub-4', 'sub-3', 'sub-2']);
    expect(p1.nextCursor).not.toBeNull();
    const p2 = (await search.execute({ filter: {}, cursor: p1.nextCursor, limit: 4 })).unwrapOr(
      undefined as never,
    );
    expect(p2.items.map((e) => e.targetId)).toEqual(['sub-1', 'sub-0']);
    expect(p2.nextCursor).toBeNull();
  });

  it('filters by actor, target and time range', async () => {
    await seed();
    const run = async (filter: Parameters<SearchAuditLogs['execute']>[0]['filter']) =>
      (await search.execute({ filter, cursor: null }))
        .unwrapOr(undefined as never)
        .items.map((e) => e.targetId);

    expect(await run({ actorId: adminB })).toEqual(['sub-3', 'sub-1']);
    expect(await run({ actorType: 'system' })).toEqual(['sub-0']);
    expect(await run({ targetType: 'kyc_submission', targetId: 'sub-0' })).toHaveLength(2);
    expect(
      await run({ from: new Date('2026-11-18T00:01:00.000Z'), to: new Date('2026-11-18T00:03:00.000Z') }),
    ).toEqual(['sub-2', 'sub-1']);
  });

  it('clamps limit to [1, 100]', async () => {
    await seed();
    const page = (await search.execute({ filter: {}, cursor: null, limit: 0 })).unwrapOr(undefined as never);
    expect(page.items).toHaveLength(1);
  });
});
