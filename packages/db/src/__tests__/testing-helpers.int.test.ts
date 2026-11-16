import { ok } from '@tamgiao/kernel';
import { resetDatabase, runConcurrently, testDatabaseUrl, withRollback } from '@tamgiao/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../client.js';
import { asDbTx } from '../tx.js';
import { DrizzleUnitOfWork } from '../unit-of-work.js';

// Test cho chính các helper của @tamgiao/testing (đặt ở db để tránh phụ thuộc vòng testing ↔ db).
let database: Database;
let uow: DrizzleUnitOfWork;

const count = async (query: string): Promise<number> =>
  Number((await database.pool.query<{ n: string }>(query)).rows[0]?.n);

beforeAll(async () => {
  database = createDatabase(testDatabaseUrl());
  uow = new DrizzleUnitOfWork(database.pool);
  await database.pool.query(
    'create schema if not exists helpers; create table if not exists helpers.rows (id serial primary key, v text)',
  );
});

afterAll(() => database.close());

describe('@tamgiao/testing', () => {
  it('resetDatabase xoá dữ liệu bảng ứng dụng nhưng giữ lịch sử migration', async () => {
    await database.pool.query("insert into helpers.rows (v) values ('a'), ('b')");
    const migrationsBefore = await count('select count(*) as n from drizzle.__drizzle_migrations');
    expect(migrationsBefore).toBeGreaterThan(0);

    await resetDatabase(database.pool);

    expect(await count('select count(*) as n from helpers.rows')).toBe(0);
    expect(await count('select count(*) as n from drizzle.__drizzle_migrations')).toBe(migrationsBefore);
    // restart identity: id đánh lại từ 1
    const { rows } = await database.pool.query<{ id: number }>(
      "insert into helpers.rows (v) values ('c') returning id",
    );
    expect(rows[0]?.id).toBe(1);
  });

  it('withRollback trả giá trị của fn và không để lại dữ liệu', async () => {
    await resetDatabase(database.pool);
    const inserted = await withRollback(uow, async (tx) => {
      await asDbTx(tx).execute(sql`insert into helpers.rows (v) values ('temp')`);
      return count('select count(*) as n from helpers.rows'); // ngoài tx → chưa thấy dòng mới
    });
    expect(inserted).toBe(0);
    expect(await count('select count(*) as n from helpers.rows')).toBe(0);
  });

  it('runConcurrently chạy đồng thời và trả kết quả từng lần (kể cả lỗi)', async () => {
    const results = await runConcurrently(4, async (i) => {
      if (i === 3) throw new Error('lần 3 lỗi');
      const r = await uow.run(async (tx) => {
        await asDbTx(tx).execute(sql`select pg_sleep(0.2)`);
        return ok(i);
      });
      return r.unwrapOr(-1);
    });
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled', 'rejected']);
    expect(results.slice(0, 3).map((r) => (r.status === 'fulfilled' ? r.value : null))).toEqual([0, 1, 2]);
  });
});
