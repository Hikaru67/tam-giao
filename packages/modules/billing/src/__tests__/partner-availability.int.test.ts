import { createDatabase, DrizzleUnitOfWork, type Database } from '@tamgiao/db';
import { newId } from '@tamgiao/kernel';
import { resetDatabase, testDatabaseUrl } from '@tamgiao/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PartnerAvailabilityQueries } from '../application/partner/partner-availability.js';
import { DrizzlePartnerRepository } from '../infrastructure/drizzle-partner-repositories.js';

const T0 = new Date('2026-12-01T02:00:00.000Z');

let database: Database;
let facade: PartnerAvailabilityQueries;

beforeAll(() => {
  database = createDatabase(testDatabaseUrl(), { maxConnections: 4 });
  facade = new PartnerAvailabilityQueries({
    uow: new DrizzleUnitOfWork(database.pool),
    partners: new DrizzlePartnerRepository(),
  });
});
beforeEach(() => resetDatabase(database.pool));
afterAll(() => database.close());

async function seedPartner(active: boolean): Promise<string> {
  const id = newId();
  await database.pool.query(
    `insert into billing.partners (id, name, address, active, created_at, updated_at) values ($1, $2, $3, $4, $5, $5)`,
    [id, 'The Running Bean', '115 Hồ Tùng Mậu', active, T0],
  );
  return id;
}

describe('BillingPartnerFacade.isActivePartner (BE-S7-01)', () => {
  it('quán active → true; đã tắt / không tồn tại / id sai → false', async () => {
    const active = await seedPartner(true);
    const inactive = await seedPartner(false);
    expect(await facade.isActivePartner(active)).toBe(true);
    expect(await facade.isActivePartner(inactive)).toBe(false);
    expect(await facade.isActivePartner(newId())).toBe(false);
    expect(await facade.isActivePartner('not-a-uuid')).toBe(false);
  });
});
