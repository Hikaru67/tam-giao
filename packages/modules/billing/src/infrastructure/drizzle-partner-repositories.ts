import { asDbTx } from '@tamgiao/db';
import type { Tx } from '@tamgiao/kernel';
import { asc, eq } from 'drizzle-orm';
import type {
  PartnerListFilter,
  PartnerRepository,
  PartnerStaffRepository,
} from '../application/ports/partner-repositories.js';
import { Partner, type PartnerId } from '../domain/partner.js';
import { PartnerStaff, type PartnerStaffId } from '../domain/partner-staff.js';
import { partners, partnerStaff } from './schema.js';

type PartnerRow = typeof partners.$inferSelect;
type StaffRow = typeof partnerStaff.$inferSelect;

const toPartner = (row: PartnerRow): Partner =>
  Partner.restore({
    id: row.id as PartnerId,
    name: row.name,
    address: row.address,
    photoUrl: row.photoUrl,
    tags: row.tags,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

const toStaff = (row: StaffRow): PartnerStaff =>
  PartnerStaff.restore({
    id: row.id as PartnerStaffId,
    partnerId: row.partnerId as PartnerId,
    name: row.name,
    pinHash: row.pinHash,
    deviceId: row.deviceId,
    active: row.active,
    failedLogins: row.failedLogins,
    lockedUntil: row.lockedUntil,
    tokenVersion: row.tokenVersion,
    lastLoginAt: row.lastLoginAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

/** Hiện thực `PartnerRepository` bằng Drizzle + PostgreSQL (`billing.partners`). */
export class DrizzlePartnerRepository implements PartnerRepository {
  async findById(tx: Tx, id: PartnerId): Promise<Partner | null> {
    const [row] = await asDbTx(tx).select().from(partners).where(eq(partners.id, id));
    return row ? toPartner(row) : null;
  }

  async findByIdForUpdate(tx: Tx, id: PartnerId): Promise<Partner | null> {
    const [row] = await asDbTx(tx).select().from(partners).where(eq(partners.id, id)).for('update');
    return row ? toPartner(row) : null;
  }

  async save(tx: Tx, partner: Partner): Promise<void> {
    const s = partner.toState();
    const values = {
      name: s.name,
      address: s.address,
      photoUrl: s.photoUrl,
      tags: [...s.tags],
      active: s.active,
      updatedAt: s.updatedAt,
    };
    await asDbTx(tx)
      .insert(partners)
      .values({ id: s.id, createdAt: s.createdAt, ...values })
      .onConflictDoUpdate({ target: partners.id, set: values });
  }

  async list(tx: Tx, filter: PartnerListFilter): Promise<Partner[]> {
    const rows = await asDbTx(tx)
      .select()
      .from(partners)
      .where(filter.active === undefined ? undefined : eq(partners.active, filter.active))
      .orderBy(asc(partners.name), asc(partners.id));
    return rows.map(toPartner);
  }
}

/** Hiện thực `PartnerStaffRepository` bằng Drizzle + PostgreSQL (`billing.partner_staff`). */
export class DrizzlePartnerStaffRepository implements PartnerStaffRepository {
  async findById(tx: Tx, id: PartnerStaffId): Promise<PartnerStaff | null> {
    const [row] = await asDbTx(tx).select().from(partnerStaff).where(eq(partnerStaff.id, id));
    return row ? toStaff(row) : null;
  }

  async findByIdForUpdate(tx: Tx, id: PartnerStaffId): Promise<PartnerStaff | null> {
    const [row] = await asDbTx(tx).select().from(partnerStaff).where(eq(partnerStaff.id, id)).for('update');
    return row ? toStaff(row) : null;
  }

  async save(tx: Tx, staff: PartnerStaff): Promise<void> {
    const s = staff.toState();
    const values = {
      name: s.name,
      pinHash: s.pinHash,
      deviceId: s.deviceId,
      active: s.active,
      failedLogins: s.failedLogins,
      lockedUntil: s.lockedUntil,
      tokenVersion: s.tokenVersion,
      lastLoginAt: s.lastLoginAt,
      updatedAt: s.updatedAt,
    };
    await asDbTx(tx)
      .insert(partnerStaff)
      .values({ id: s.id, partnerId: s.partnerId, createdAt: s.createdAt, ...values })
      .onConflictDoUpdate({ target: partnerStaff.id, set: values });
  }

  async listByPartner(tx: Tx, partnerId: PartnerId): Promise<PartnerStaff[]> {
    const rows = await asDbTx(tx)
      .select()
      .from(partnerStaff)
      .where(eq(partnerStaff.partnerId, partnerId))
      .orderBy(asc(partnerStaff.createdAt), asc(partnerStaff.id));
    return rows.map(toStaff);
  }
}
