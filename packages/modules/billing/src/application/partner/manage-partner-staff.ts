import {
  err,
  fail,
  newId,
  ok,
  type Clock,
  type DomainError,
  type Result,
  type UnitOfWork,
} from '@tamgiao/kernel';
import type { AuditLogger } from '@tamgiao/module-identity/facade';
import { isValidPartnerPin, PartnerStaff } from '../../domain/partner-staff.js';
import type { PartnerPinHasher } from '../ports/partner-pin-hasher.js';
import type { PartnerRepository, PartnerStaffRepository } from '../ports/partner-repositories.js';
import {
  auditPartnerAction,
  toPartnerId,
  toPartnerStaffId,
  toPartnerStaffView,
  type PartnerAdminActor,
  type PartnerStaffView,
} from './partner-views.js';

export const PARTNER_STAFF_AUDIT_TARGET_TYPE = 'partner_staff';

interface StaffAdminDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly partners: PartnerRepository;
  readonly staff: PartnerStaffRepository;
  readonly pins: PartnerPinHasher;
  readonly auditLogger: AuditLogger;
}

export interface CreatePartnerStaffCommand {
  readonly actor: PartnerAdminActor;
  readonly partnerId: string;
  readonly name: string;
  /** PIN gốc — chỉ đi tới `PartnerPinHasher`, không lưu, không log, không ghi audit. */
  readonly pin: string;
  readonly deviceId?: string | null | undefined;
}

export type CreatePartnerStaffError = DomainError<
  'PARTNER_NOT_FOUND' | 'PARTNER_INVALID' | 'PARTNER_PIN_INVALID'
>;

/** Admin tạo tài khoản nhân viên quán (PIN 6 số, băm trước khi lưu), audit `partner.staff_create`. */
export class CreatePartnerStaff {
  constructor(private readonly deps: StaffAdminDeps) {}

  async execute(cmd: CreatePartnerStaffCommand): Promise<Result<PartnerStaffView, CreatePartnerStaffError>> {
    const partnerId = toPartnerId(cmd.partnerId);
    if (partnerId === null) return fail('PARTNER_NOT_FOUND');
    if (!isValidPartnerPin(cmd.pin)) return fail('PARTNER_PIN_INVALID');
    // Băm ngoài transaction (scrypt tốn CPU/RAM) — không giữ connection DB trong lúc băm.
    const pinHash = await this.deps.pins.hash(cmd.pin);
    const now = this.deps.clock.now();
    const created = PartnerStaff.create(
      { id: newId<'PartnerStaff'>(), partnerId, name: cmd.name, pinHash, deviceId: cmd.deviceId ?? null },
      now,
    );
    if (created.isErr()) return err(created.error);
    const staff = created.value;

    return this.deps.uow.run(async (tx) => {
      if ((await this.deps.partners.findById(tx, partnerId)) === null) return fail('PARTNER_NOT_FOUND');
      await this.deps.staff.save(tx, staff);
      await auditPartnerAction(this.deps.auditLogger, tx, cmd.actor, {
        action: 'partner.staff_create',
        targetType: PARTNER_STAFF_AUDIT_TARGET_TYPE,
        targetId: staff.id,
        meta: { partnerId, deviceBound: staff.toState().deviceId !== null },
      });
      return ok(toPartnerStaffView(staff, now));
    });
  }
}

export interface UpdatePartnerStaffCommand {
  readonly actor: PartnerAdminActor;
  readonly partnerId: string;
  readonly staffId: string;
  readonly name?: string | undefined;
  /** Đặt lại PIN — mở khoá + thu hồi token cũ. */
  readonly pin?: string | undefined;
  /** Đổi thiết bị; `null` = gỡ, gắn lại ở lần đăng nhập tới. Thu hồi token cũ. */
  readonly deviceId?: string | null | undefined;
  readonly active?: boolean | undefined;
}

export type UpdatePartnerStaffError = DomainError<
  'PARTNER_STAFF_NOT_FOUND' | 'PARTNER_INVALID' | 'PARTNER_PIN_INVALID'
>;

/** Admin đổi tên / đặt lại PIN / đổi thiết bị / bật-tắt tài khoản nhân viên quán, audit `partner.staff_update`. */
export class UpdatePartnerStaff {
  constructor(private readonly deps: StaffAdminDeps) {}

  async execute(cmd: UpdatePartnerStaffCommand): Promise<Result<PartnerStaffView, UpdatePartnerStaffError>> {
    const partnerId = toPartnerId(cmd.partnerId);
    const staffId = toPartnerStaffId(cmd.staffId);
    if (partnerId === null || staffId === null) return fail('PARTNER_STAFF_NOT_FOUND');
    if (cmd.pin !== undefined && !isValidPartnerPin(cmd.pin)) return fail('PARTNER_PIN_INVALID');
    const pinHash = cmd.pin === undefined ? undefined : await this.deps.pins.hash(cmd.pin);

    return this.deps.uow.run(async (tx) => {
      const staff = await this.deps.staff.findByIdForUpdate(tx, staffId);
      if (staff === null || staff.partnerId !== partnerId) return fail('PARTNER_STAFF_NOT_FOUND');
      const now = this.deps.clock.now();
      const fields: string[] = [];
      if (cmd.name !== undefined) {
        const renamed = staff.rename(cmd.name, now);
        if (renamed.isErr()) return err(renamed.error);
        if (renamed.value) fields.push('name');
      }
      if (pinHash !== undefined) {
        staff.resetPin(pinHash, now);
        fields.push('pin');
      }
      if (cmd.deviceId !== undefined && staff.changeDevice(cmd.deviceId, now)) fields.push('deviceId');
      if (cmd.active !== undefined && staff.setActive(cmd.active, now)) fields.push('active');

      if (fields.length > 0) {
        await this.deps.staff.save(tx, staff);
        await auditPartnerAction(this.deps.auditLogger, tx, cmd.actor, {
          action: 'partner.staff_update',
          targetType: PARTNER_STAFF_AUDIT_TARGET_TYPE,
          targetId: staff.id,
          meta: { partnerId, fields, active: staff.active },
        });
      }
      return ok(toPartnerStaffView(staff, now));
    });
  }
}

/** Admin xem danh sách nhân viên của một quán. */
export class ListPartnerStaff {
  constructor(
    private readonly deps: {
      readonly uow: UnitOfWork;
      readonly clock: Clock;
      readonly partners: PartnerRepository;
      readonly staff: PartnerStaffRepository;
    },
  ) {}

  async execute(
    rawPartnerId: string,
  ): Promise<Result<readonly PartnerStaffView[], DomainError<'PARTNER_NOT_FOUND'>>> {
    const partnerId = toPartnerId(rawPartnerId);
    if (partnerId === null) return fail('PARTNER_NOT_FOUND');
    return this.deps.uow.run(async (tx) => {
      if ((await this.deps.partners.findById(tx, partnerId)) === null) return fail('PARTNER_NOT_FOUND');
      const now = this.deps.clock.now();
      const items = await this.deps.staff.listByPartner(tx, partnerId);
      return ok(items.map((s) => toPartnerStaffView(s, now)));
    });
  }
}
