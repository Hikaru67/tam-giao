import type { AppEnv, RequireAdmin } from '@tamgiao/http';
import type { Clock, UnitOfWork } from '@tamgiao/kernel';
import type { AuditLogger } from '@tamgiao/module-identity/facade';
import { Hono, type MiddlewareHandler } from 'hono';
import { AuthenticatePartnerStaff } from './application/partner/authenticate-partner-staff.js';
import {
  CreatePartnerStaff,
  ListPartnerStaff,
  UpdatePartnerStaff,
} from './application/partner/manage-partner-staff.js';
import {
  CreatePartner,
  GetPartner,
  ListActivePartners,
  ListPartners,
  UpdatePartner,
} from './application/partner/manage-partners.js';
import { PartnerStaffLogin } from './application/partner/partner-staff-login.js';
import {
  DrizzlePartnerRepository,
  DrizzlePartnerStaffRepository,
} from './infrastructure/drizzle-partner-repositories.js';
import {
  derivePartnerKey,
  HmacPartnerTokenService,
  ScryptPartnerPinHasher,
} from './infrastructure/partner-crypto.js';
import { createPartnerAdminRoutes } from './presentation/partner-admin-routes.js';
import { createRequirePartnerStaff } from './presentation/partner-auth-middleware.js';
import { createPartnerRoutes } from './presentation/partner-routes.js';

/**
 * Module billing (Sprint 4): thanh toán xác thực, ledger chỉ ghi thêm, voucher hẹn hò, quán đối tác.
 * Composition root `createBillingModule(deps)` được bổ sung dần theo task BE-S4-xx.
 */
export type { PartnerStaffAuth } from './application/partner/authenticate-partner-staff.js';
export type { PartnerEnv, RequirePartnerStaff } from './presentation/partner-auth-middleware.js';

export interface BillingModuleDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  /** Bí mật gốc (≥ 32 bytes, `AUTH_SECRET`) — dẫn xuất khoá ký token partner + pepper PIN (HKDF, tách miền). */
  readonly secret: Buffer;
  /** Guard người dùng app — `requireUser(identity.facade.authenticateUser)`. */
  readonly requireUser: MiddlewareHandler<AppEnv>;
  /** Guard admin — `identity.requireAdmin`. */
  readonly requireAdmin: RequireAdmin;
  /** Ghi audit log — `identity.auditLogger`. */
  readonly auditLogger: AuditLogger;
}

export interface BillingModule {
  readonly name: 'billing';
  readonly routes: Hono<AppEnv>;
}

/** Composition root của module billing. */
export function createBillingModule(deps: BillingModuleDeps): BillingModule {
  const { uow, clock, auditLogger } = deps;
  const routes = new Hono<AppEnv>();

  // ── Quán đối tác + nhân viên quán (BE-S4-06) ───────────────────────────────────────────────────
  const partners = new DrizzlePartnerRepository();
  const staff = new DrizzlePartnerStaffRepository();
  const pins = new ScryptPartnerPinHasher(derivePartnerKey(deps.secret, 'pin-pepper'));
  const tokens = new HmacPartnerTokenService(derivePartnerKey(deps.secret, 'token'));
  // Guard nhân viên quán — route partner của task sau (vd `POST /partner/vouchers/redeem`, BE-S4-05) dùng lại.
  const requirePartnerStaff = createRequirePartnerStaff(
    new AuthenticatePartnerStaff({ uow, clock, partners, staff, tokens }),
  );
  const partnerAdmin = { uow, clock, partners, auditLogger };
  const staffAdmin = { uow, clock, partners, staff, pins, auditLogger };
  routes.route(
    '/',
    createPartnerAdminRoutes({
      createPartner: new CreatePartner(partnerAdmin),
      updatePartner: new UpdatePartner(partnerAdmin),
      getPartner: new GetPartner({ uow, partners }),
      listPartners: new ListPartners({ uow, partners }),
      createStaff: new CreatePartnerStaff(staffAdmin),
      updateStaff: new UpdatePartnerStaff(staffAdmin),
      listStaff: new ListPartnerStaff({ uow, clock, partners, staff }),
      requireAdmin: deps.requireAdmin,
    }),
  );
  routes.route(
    '/',
    createPartnerRoutes({
      listActivePartners: new ListActivePartners({ uow, partners }),
      login: new PartnerStaffLogin({ uow, clock, partners, staff, pins, tokens }),
      requireUser: deps.requireUser,
      requirePartnerStaff,
    }),
  );

  return { name: 'billing', routes };
}
