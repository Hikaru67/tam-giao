import { OutboxWriter } from '@tamgiao/db';
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
import { CreateVerificationCheckout } from './application/payment/create-verification-checkout.js';
import { HandlePaymentWebhook } from './application/payment/handle-payment-webhook.js';
import { BillingFacadeQueries, GetMyPayments } from './application/payment/payment-queries.js';
import type { BillingFacade } from './application/facade.js';
import type { PaymentGateway } from './application/ports/payment-gateway.js';
import {
  DrizzleLedgerRepository,
  DrizzleVerificationPaymentRepository,
  DrizzleVoucherRepository,
} from './infrastructure/drizzle-payment-repositories.js';
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
import { createPaymentRoutes, type DevPaymentSimulator } from './presentation/payment-routes.js';

/**
 * Module billing (Sprint 4): thanh toán xác thực, ledger chỉ ghi thêm, voucher hẹn hò, quán đối tác.
 * Composition root `createBillingModule(deps)` được bổ sung dần theo task BE-S4-xx.
 */
export type { PartnerStaffAuth } from './application/partner/authenticate-partner-staff.js';
export type { PartnerEnv, RequirePartnerStaff } from './presentation/partner-auth-middleware.js';
export type { BillingFacade } from './application/facade.js';
export type { DevPaymentSimulator } from './presentation/payment-routes.js';
export {
  PaymentGatewayError,
  WEBHOOK_INVALID,
  type CheckoutSession,
  type PaymentGateway,
  type WebhookEvent,
  type WebhookHeaders,
} from './application/ports/payment-gateway.js';
export {
  FAKE_SIGNATURE_HEADER,
  FakePaymentGateway,
  type FakePaymentGatewayOptions,
  type SignedWebhook,
} from './infrastructure/gateway/fake-payment-gateway.js';

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
  /** Cổng thanh toán (D3 chưa chốt — hiện chỉ `FakePaymentGateway`). */
  readonly paymentGateway: PaymentGateway;
  /** Tên cổng (`PAYMENT_GATEWAY`) — khớp tham số `:gateway` của route webhook. */
  readonly paymentGatewayName: string;
  /** URL cổng chuyển người dùng về sau khi thanh toán. */
  readonly paymentReturnUrl: string;
  /** Chỉ truyền khi gateway `fake` và không phải production → mount `POST /dev/payments/fake/:orderId`. */
  readonly devPaymentSimulator?: DevPaymentSimulator | undefined;
}

export interface BillingModule {
  readonly name: 'billing';
  readonly routes: Hono<AppEnv>;
  /** Facade read-only cho module khác (BE-S4-03). */
  readonly facade: BillingFacade;
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

  // ── Thanh toán xác thực + webhook (BE-S4-03) ──────────────────────────────────────────────────
  const outbox = new OutboxWriter();
  const payments = new DrizzleVerificationPaymentRepository(outbox);
  const gateway = deps.paymentGateway;
  routes.route(
    '/',
    createPaymentRoutes({
      createCheckout: new CreateVerificationCheckout({
        uow,
        clock,
        payments,
        gateway,
        returnUrl: deps.paymentReturnUrl,
      }),
      getMyPayments: new GetMyPayments({ uow, payments }),
      handleWebhook: new HandlePaymentWebhook({
        uow,
        clock,
        gateway,
        payments,
        vouchers: new DrizzleVoucherRepository(outbox),
        ledger: new DrizzleLedgerRepository(),
      }),
      gatewayName: deps.paymentGatewayName,
      requireUser: deps.requireUser,
      devSimulator: deps.devPaymentSimulator,
    }),
  );
  const facade: BillingFacade = new BillingFacadeQueries({ uow, payments });

  return { name: 'billing', routes, facade };
}
