import { err, fail, ok, type Clock, type DomainError, type Result, type UnitOfWork } from '@tamgiao/kernel';
import { ensurePartnerStaffCanOperate } from '../../domain/partner-staff.js';
import type { PartnerRepository, PartnerStaffRepository } from '../ports/partner-repositories.js';
import type { PartnerTokenService } from '../ports/partner-token-service.js';
import { toPartnerId, toPartnerStaffId } from './partner-views.js';

/** Nhân viên quán đã xác thực — gắn vào context bởi `requirePartnerStaff`. */
export interface PartnerStaffAuth {
  readonly staffId: string;
  readonly staffName: string;
  readonly partnerId: string;
  readonly partnerName: string;
}

export type AuthenticatePartnerStaffError = DomainError<'PARTNER_TOKEN_INVALID' | 'PARTNER_INACTIVE'>;

/**
 * Kiểm tra token partner ở **mỗi** request: chữ ký + hạn, rồi đọc lại DB — tài khoản còn tồn tại, đúng quán,
 * `tokenVersion` khớp (chưa đổi PIN/thiết bị), tài khoản và quán còn `active`. Nhờ vậy tắt quán có hiệu lực ngay với
 * token đã cấp (AC1 BE-S4-06).
 */
export class AuthenticatePartnerStaff {
  constructor(
    private readonly deps: {
      readonly uow: UnitOfWork;
      readonly clock: Clock;
      readonly partners: PartnerRepository;
      readonly staff: PartnerStaffRepository;
      readonly tokens: PartnerTokenService;
    },
  ) {}

  async execute(token: string): Promise<Result<PartnerStaffAuth, AuthenticatePartnerStaffError>> {
    const claims = this.deps.tokens.verify(token, this.deps.clock.now());
    if (claims.isErr()) return err(claims.error);
    const staffId = toPartnerStaffId(claims.value.staffId);
    const partnerId = toPartnerId(claims.value.partnerId);
    if (staffId === null || partnerId === null) return fail('PARTNER_TOKEN_INVALID');

    return this.deps.uow.run(async (tx) => {
      const staff = await this.deps.staff.findById(tx, staffId);
      if (
        staff === null ||
        staff.partnerId !== partnerId ||
        staff.tokenVersion !== claims.value.tokenVersion
      ) {
        return fail('PARTNER_TOKEN_INVALID');
      }
      const partner = await this.deps.partners.findById(tx, partnerId);
      if (partner === null) return fail('PARTNER_TOKEN_INVALID');
      const canOperate = ensurePartnerStaffCanOperate(staff, partner);
      if (canOperate.isErr()) return err(canOperate.error);
      return ok({
        staffId: staff.id,
        staffName: staff.name,
        partnerId: partner.id,
        partnerName: partner.name,
      });
    });
  }
}
