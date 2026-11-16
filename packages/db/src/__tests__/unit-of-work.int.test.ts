import { newId, err, fail, ok, type DomainEvent, type Tx } from '@tamgiao/kernel';
import { resetDatabase, runConcurrently, testDatabaseUrl } from '@tamgiao/testing';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../client.js';
import { runMigrations } from '../migrate.js';
import { OutboxWriter } from '../outbox/outbox-writer.js';
import { outbox } from '../schema/platform.js';
import { asDbTx } from '../tx.js';
import { DrizzleUnitOfWork } from '../unit-of-work.js';

let database: Database;
let uow: DrizzleUnitOfWork;
const writer = new OutboxWriter();

/** Bảng nháp giả lập "dữ liệu nghiệp vụ" ghi cùng transaction với outbox. */
async function insertItem(tx: Tx, id: string): Promise<void> {
  await asDbTx(tx).execute(sql`insert into scratch.items (id) values (${id})`);
}

async function itemCount(): Promise<number> {
  const { rows } = await database.pool.query<{ n: string }>('select count(*) as n from scratch.items');
  return Number(rows[0]?.n);
}

async function outboxCount(): Promise<number> {
  return (await database.db.select().from(outbox)).length;
}

function event(aggregateId: string, version: number): DomainEvent {
  return {
    eventId: newId<'DomainEvent'>(),
    type: 'ItemCreated',
    aggregateType: 'Item',
    aggregateId,
    version,
    occurredAt: new Date('2026-11-16T00:00:00.000Z'),
    payload: { aggregateId, note: 'không chứa PII' },
  };
}

beforeAll(async () => {
  database = createDatabase(testDatabaseUrl(), { maxConnections: 5 });
  uow = new DrizzleUnitOfWork(database.pool);
  await database.pool.query(
    'create schema if not exists scratch; create table if not exists scratch.items (id text primary key)',
  );
});

beforeEach(() => resetDatabase(database.pool));

afterAll(() => database.close());

describe('DrizzleUnitOfWork + OutboxWriter', () => {
  it('Ok → commit cả dữ liệu và outbox (AC2)', async () => {
    const result = await uow.run(async (tx) => {
      await insertItem(tx, 'a');
      await writer.append(tx, [event('a', 1)]);
      return ok('done');
    });
    expect(result.isOk() && result.value).toBe('done');
    expect(await itemCount()).toBe(1);
    const [row] = await database.db.select().from(outbox);
    expect(row).toMatchObject({
      eventType: 'ItemCreated',
      aggregateType: 'Item',
      aggregateId: 'a',
      aggregateVersion: 1,
      payload: { aggregateId: 'a', note: 'không chứa PII' },
      occurredAt: new Date('2026-11-16T00:00:00.000Z'),
      publishedAt: null,
    });
  });

  it('work trả Err → rollback toàn bộ và trả lại đúng Err (AC1)', async () => {
    const result = await uow.run(async (tx) => {
      await insertItem(tx, 'b');
      await writer.append(tx, [event('b', 1)]);
      return fail('USER_BUSY', { reason: 'test' });
    });
    expect(result.isErr() && result.error).toEqual({ code: 'USER_BUSY', details: { reason: 'test' } });
    expect(await itemCount()).toBe(0);
    expect(await outboxCount()).toBe(0);
  });

  it('work throw → rollback toàn bộ và ném lại lỗi (AC1)', async () => {
    await expect(
      uow.run(async (tx) => {
        await insertItem(tx, 'c');
        await writer.append(tx, [event('c', 1)]);
        throw new Error('hạ tầng lỗi');
      }),
    ).rejects.toThrow('hạ tầng lỗi');
    expect(await itemCount()).toBe(0);
    expect(await outboxCount()).toBe(0);
  });

  it('hàm lồng nhau dùng lại cùng tx → rollback cùng nhau', async () => {
    const saveAggregate = async (tx: Tx, id: string) => {
      await insertItem(tx, id);
      await writer.append(tx, [event(id, 1)]);
    };
    const result = await uow.run(async (tx) => {
      await saveAggregate(tx, 'd1');
      await saveAggregate(tx, 'd2');
      return err('LATER_STEP_FAILED' as const);
    });
    expect(result.isErr()).toBe(true);
    expect(await itemCount()).toBe(0);
    expect(await outboxCount()).toBe(0);
  });

  it('append mảng rỗng là no-op', async () => {
    const result = await uow.run(async (tx) => {
      await writer.append(tx, []);
      return ok();
    });
    expect(result.isOk()).toBe(true);
    expect(await outboxCount()).toBe(0);
  });

  it('2 transaction đồng thời ghi cùng version của aggregate → đúng 1 thành công (A10)', async () => {
    const results = await runConcurrently(2, (i) =>
      uow.run(async (tx) => {
        await insertItem(tx, `race-${i}`);
        await writer.append(tx, [event('same-aggregate', 1)]);
        return ok();
      }),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(await itemCount()).toBe(1);
    expect(
      await database.db.select().from(outbox).where(eq(outbox.aggregateId, 'same-aggregate')),
    ).toHaveLength(1);
  });
});

describe('migration', () => {
  it('tạo schema platform trên DB trắng và chạy lại không lỗi (AC3)', async () => {
    const { rows } = await database.pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'platform' order by table_name`,
    );
    expect(rows.map((r) => r.table_name)).toEqual(['outbox', 'processed_events']);
    await expect(runMigrations(database.db)).resolves.toBeUndefined();
  });
});
