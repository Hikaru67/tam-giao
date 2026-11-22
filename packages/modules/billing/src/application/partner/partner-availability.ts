import { ok, parseId, type UnitOfWork } from '@tamgiao/kernel';
import type { PartnerId } from '../../domain/partner.js';
import type { BillingPartnerFacade } from '../facade.js';
import type { PartnerRepository } from '../ports/partner-repositories.js';

/**
 * Hiện thực `BillingPartnerFacade` (BE-S7-01): dating hỏi "quán còn hoạt động không" trước khi tạo lịch hẹn, không đọc
 * bảng `billing.partners` (A3). Một transaction ngắn, chỉ đọc.
 */
export class PartnerAvailabilityQueries implements BillingPartnerFacade {
  constructor(private readonly deps: { readonly uow: UnitOfWork; readonly partners: PartnerRepository }) {}

  async isActivePartner(partnerId: string): Promise<boolean> {
    const id = parseId<'Partner'>(partnerId);
    if (id.isErr()) return false;
    const partnerIdValue: PartnerId = id.value;
    const result = await this.deps.uow.run(async (tx) =>
      ok(await this.deps.partners.findById(tx, partnerIdValue)),
    );
    return result.unwrapOr(null)?.active === true;
  }
}
