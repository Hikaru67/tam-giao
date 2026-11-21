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
import { Partner, type PartnerInvalid, type PartnerPatch } from '../../domain/partner.js';
import type { PartnerListFilter, PartnerRepository } from '../ports/partner-repositories.js';
import {
  auditPartnerAction,
  toPartnerId,
  toPartnerView,
  type PartnerAdminActor,
  type PartnerView,
} from './partner-views.js';

export const PARTNER_AUDIT_TARGET_TYPE = 'partner';

interface PartnerAdminDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly partners: PartnerRepository;
  readonly auditLogger: AuditLogger;
}

export interface CreatePartnerCommand {
  readonly actor: PartnerAdminActor;
  readonly name: string;
  readonly address: string;
  readonly photoUrl?: string | null | undefined;
  readonly tags?: readonly string[] | undefined;
}

/** Admin thêm quán đối tác (mặc định `active`), ghi audit `partner.create` cùng transaction. */
export class CreatePartner {
  constructor(private readonly deps: PartnerAdminDeps) {}

  async execute(cmd: CreatePartnerCommand): Promise<Result<PartnerView, PartnerInvalid>> {
    const created = Partner.create(
      {
        id: newId<'Partner'>(),
        name: cmd.name,
        address: cmd.address,
        ...(cmd.photoUrl === undefined ? {} : { photoUrl: cmd.photoUrl }),
        ...(cmd.tags === undefined ? {} : { tags: cmd.tags }),
      },
      this.deps.clock.now(),
    );
    if (created.isErr()) return err(created.error);
    const partner = created.value;
    return this.deps.uow.run(async (tx) => {
      await this.deps.partners.save(tx, partner);
      await auditPartnerAction(this.deps.auditLogger, tx, cmd.actor, {
        action: 'partner.create',
        targetType: PARTNER_AUDIT_TARGET_TYPE,
        targetId: partner.id,
        meta: { active: partner.active },
      });
      return ok(toPartnerView(partner));
    });
  }
}

export interface UpdatePartnerCommand {
  readonly actor: PartnerAdminActor;
  readonly partnerId: string;
  readonly patch: PartnerPatch;
}

/**
 * Admin sửa thông tin / bật-tắt quán. Tắt quán (`active: false`) có hiệu lực ngay: quán biến khỏi danh sách,
 * nhân viên không đăng nhập được và token đã cấp bị từ chối ở request kế tiếp (guard đọc lại `active` từ DB).
 */
export class UpdatePartner {
  constructor(private readonly deps: PartnerAdminDeps) {}

  async execute(
    cmd: UpdatePartnerCommand,
  ): Promise<Result<PartnerView, PartnerInvalid | DomainError<'PARTNER_NOT_FOUND'>>> {
    const id = toPartnerId(cmd.partnerId);
    if (id === null) return fail('PARTNER_NOT_FOUND');
    return this.deps.uow.run(async (tx) => {
      const partner = await this.deps.partners.findByIdForUpdate(tx, id);
      if (partner === null) return fail('PARTNER_NOT_FOUND');
      const changed = partner.update(cmd.patch, this.deps.clock.now());
      if (changed.isErr()) return err(changed.error);
      if (changed.value.length > 0) {
        await this.deps.partners.save(tx, partner);
        await auditPartnerAction(this.deps.auditLogger, tx, cmd.actor, {
          action: 'partner.update',
          targetType: PARTNER_AUDIT_TARGET_TYPE,
          targetId: partner.id,
          meta: { fields: changed.value, active: partner.active },
        });
      }
      return ok(toPartnerView(partner));
    });
  }
}

interface PartnerQueryDeps {
  readonly uow: UnitOfWork;
  readonly partners: PartnerRepository;
}

/** Admin xem một quán (kể cả đã tắt). */
export class GetPartner {
  constructor(private readonly deps: PartnerQueryDeps) {}

  async execute(partnerId: string): Promise<Result<PartnerView, DomainError<'PARTNER_NOT_FOUND'>>> {
    const id = toPartnerId(partnerId);
    if (id === null) return fail('PARTNER_NOT_FOUND');
    return this.deps.uow.run(async (tx) => {
      const partner = await this.deps.partners.findById(tx, id);
      return partner === null ? fail('PARTNER_NOT_FOUND') : ok(toPartnerView(partner));
    });
  }
}

/** Admin liệt kê quán, lọc theo `active` (bỏ trống = tất cả). */
export class ListPartners {
  constructor(private readonly deps: PartnerQueryDeps) {}

  async execute(filter: PartnerListFilter): Promise<readonly PartnerView[]> {
    const result = await this.deps.uow.run(async (tx) => ok(await this.deps.partners.list(tx, filter)));
    return result.unwrapOr([]).map(toPartnerView);
  }
}

/** Quán đang hoạt động cho người dùng app chọn nơi hẹn (màn đặt hẹn). Quán đã tắt không bao giờ xuất hiện. */
export class ListActivePartners {
  constructor(private readonly deps: PartnerQueryDeps) {}

  async execute(): Promise<readonly PartnerView[]> {
    const result = await this.deps.uow.run(async (tx) =>
      ok(await this.deps.partners.list(tx, { active: true })),
    );
    return result.unwrapOr([]).map(toPartnerView);
  }
}
