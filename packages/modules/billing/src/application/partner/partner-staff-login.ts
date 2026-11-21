import { fail, ok, type Clock, type DomainError, type Result, type UnitOfWork } from '@tamgiao/kernel';
import { ensurePartnerStaffCanOperate, PARTNER_STAFF_TOKEN_TTL_HOURS } from '../../domain/partner-staff.js';
import type { PartnerPinHasher } from '../ports/partner-pin-hasher.js';
import type { PartnerRepository, PartnerStaffRepository } from '../ports/partner-repositories.js';
import type { PartnerTokenService } from '../ports/partner-token-service.js';
import { toPartnerStaffId } from './partner-views.js';

export interface PartnerStaffLoginCommand {
  readonly staffId: string;
  /** PIN gốc — không lưu, không log. */
  readonly pin: string;
  readonly deviceId: string;
}

export interface PartnerStaffSession {
  readonly token: string;
  readonly expiresAt: Date;
  readonly staff: { readonly id: string; readonly name: string };
  readonly partner: { readonly id: string; readonly name: string };
}

export type PartnerStaffLoginError = DomainError<
  'PARTNER_LOGIN_FAILED' | 'PARTNER_STAFF_LOCKED' | 'PARTNER_INACTIVE'
>;

export interface PartnerStaffLoginDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly partners: PartnerRepository;
  readonly staff: PartnerStaffRepository;
  readonly pins: PartnerPinHasher;
  readonly tokens: PartnerTokenService;
}

/**
 * Nhân viên quán đăng nhập bằng mã nhân viên + PIN trên thiết bị đã đăng ký → token partner ngắn hạn
 * (`PARTNER_STAFF_TOKEN_TTL_HOURS`). Sai PIN/thiết bị bị đếm và khoá tạm (domain); quán đã tắt hoặc tài khoản bị
 * vô hiệu hoá → `PARTNER_INACTIVE` (chỉ báo sau khi PIN đúng, không thành "máy dò" trạng thái quán).
 */
export class PartnerStaffLogin {
  constructor(private readonly deps: PartnerStaffLoginDeps) {}

  async execute(cmd: PartnerStaffLoginCommand): Promise<Result<PartnerStaffSession, PartnerStaffLoginError>> {
    const { uow, clock, partners, staff: staffRepo, pins, tokens } = this.deps;
    const staffId = toPartnerStaffId(cmd.staffId);
    const now = clock.now();

    // Lần sai phải được commit dù kết quả là lỗi → transaction luôn trả `ok(<kết quả nghiệp vụ>)`.
    const committed = await uow.run<Result<PartnerStaffSession, PartnerStaffLoginError>, never>(
      async (tx) => {
        const staff = staffId === null ? null : await staffRepo.findByIdForUpdate(tx, staffId);
        if (staff === null) {
          await pins.verify(null, cmd.pin);
          return ok(fail('PARTNER_LOGIN_FAILED'));
        }
        const locked = staff.lockRemainingSeconds(now);
        if (locked > 0) return ok(fail('PARTNER_STAFF_LOCKED', { retryAfterSeconds: locked }));

        const pinMatches = await pins.verify(staff.pinHash, cmd.pin);
        const loggedIn = staff.login({ pinMatches, deviceId: cmd.deviceId }, now);
        if (loggedIn.isErr()) {
          await staffRepo.save(tx, staff);
          return ok(fail(loggedIn.error.code, loggedIn.error.details));
        }

        const partner = await partners.findById(tx, staff.partnerId);
        if (partner === null) throw new Error(`billing.partner_staff ${staff.id}: quán không tồn tại`);
        // Không lưu trạng thái đăng nhập (gắn thiết bị, lastLoginAt) khi quán/tài khoản không còn hoạt động.
        const canOperate = ensurePartnerStaffCanOperate(staff, partner);
        if (canOperate.isErr()) return ok(fail(canOperate.error.code));

        await staffRepo.save(tx, staff);
        const issued = tokens.issue(
          { staffId: staff.id, partnerId: partner.id, tokenVersion: staff.tokenVersion },
          now,
          PARTNER_STAFF_TOKEN_TTL_HOURS * 3_600,
        );
        return ok(
          ok({
            token: issued.token,
            expiresAt: issued.expiresAt,
            staff: { id: staff.id, name: staff.name },
            partner: { id: partner.id, name: partner.name },
          }),
        );
      },
    );
    if (committed.isErr()) throw new Error('unreachable: transaction PartnerStaffLogin không trả Err');
    return committed.value;
  }
}
