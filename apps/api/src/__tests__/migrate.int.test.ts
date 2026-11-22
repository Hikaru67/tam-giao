import { readFileSync } from 'node:fs';
import path from 'node:path';
import { MIGRATIONS_FOLDER, createDatabase, type Database } from '@tamgiao/db';
import { runConcurrently, testDatabaseUrl } from '@tamgiao/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATION_LOCK_KEY, migrateWithLock } from '../migrate.js';

/** Mỗi test dùng một database trống riêng trong cùng container (không đụng DB dùng chung đã migrate sẵn). */
const FRESH_DB = `migrate_lock_${process.pid}`;
const silent = { info: () => undefined };

function urlFor(database: string): string {
  const url = new URL(testDatabaseUrl());
  url.pathname = `/${database}`;
  return url.toString();
}

const journalEntries = (): number =>
  (
    JSON.parse(readFileSync(path.join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8')) as {
      entries: unknown[];
    }
  ).entries.length;

describe('migrateWithLock (advisory lock khi deploy)', () => {
  let admin: Database;

  beforeAll(async () => {
    admin = createDatabase(testDatabaseUrl(), { maxConnections: 2 });
    await admin.pool.query(`drop database if exists ${FRESH_DB}`);
    await admin.pool.query(`create database ${FRESH_DB}`);
  });

  afterAll(async () => {
    await admin.pool.query(`drop database if exists ${FRESH_DB} with (force)`);
    await admin.close();
  });

  it('3 tiến trình chạy đồng thời trên DB trống → đều thành công, mỗi migration áp dụng đúng một lần', async () => {
    const databases: Database[] = Array.from({ length: 3 }, () =>
      createDatabase(urlFor(FRESH_DB), { maxConnections: 3 }),
    );
    try {
      const results = await runConcurrently(3, (i) =>
        migrateWithLock({ database: databases[i] as Database, logger: silent }),
      );
      expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled']);

      const check = databases[0] as Database;
      const { rows } = await check.pool.query<{ count: number }>(
        'select count(*)::int as count from drizzle.__drizzle_migrations',
      );
      expect(rows[0]?.count).toBe(journalEntries());
      // Khoá đã được nhả.
      const { rows: locks } = await check.pool.query<{ count: number }>(
        `select count(*)::int as count from pg_locks
          where locktype = 'advisory' and database = (select oid from pg_database where datname = current_database())`,
      );
      expect(locks[0]?.count).toBe(0);
    } finally {
      await Promise.all(databases.map((d) => d.close()));
    }
  });

  it('khoá đang bị giữ quá lockTimeoutMs → lỗi lock timeout, không chạy migration', async () => {
    const holderDb = createDatabase(urlFor(FRESH_DB), { maxConnections: 1 });
    const holder = await holderDb.pool.connect();
    const database = createDatabase(urlFor(FRESH_DB), { maxConnections: 2 });
    try {
      await holder.query('select pg_advisory_lock(hashtext($1))', [MIGRATION_LOCK_KEY]);
      await expect(migrateWithLock({ database, logger: silent, lockTimeoutMs: 1_000 })).rejects.toThrow(
        /lock timeout/i,
      );
      await holder.query('select pg_advisory_unlock(hashtext($1))', [MIGRATION_LOCK_KEY]);
      // Khoá được nhả → chạy lại được (đã migrate xong ở test trước → không còn gì để chạy).
      await expect(migrateWithLock({ database, logger: silent })).resolves.toBeUndefined();
    } finally {
      holder.release();
      await holderDb.close();
      await database.close();
    }
  });
});
