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
import { ExpireDueVouchers } from './application/voucher/expire-due-vouchers.js';
import { RedeemVoucher } from './application/voucher/redeem-voucher.js';
import { GetVoucherQr, ListMyVouchers } from './application/voucher/voucher-queries.js';
import { DrizzleVoucherLifecycleRepository } from './infrastructure/drizzle-voucher-repository.js';
import { deriveVoucherQrKey, HmacVoucherQrTokenService } from './infrastructure/voucher-qr-token.js';
import { createVoucherRoutes } from './presentation/voucher-routes.js';
// BE-S4-04 — hoàn tiền + consumer verification.
import type { EventBus } from '@tamgiao/db';
import { SetVoucherExpiryOnKycApproved } from './application/kyc-approved/set-voucher-expiry-on-kyc-approved.js';
import { RefundOnKycRejected } from './application/refund/refund-on-kyc-rejected.js';
import { FindOverdueRefunds, ListPendingRefunds } from './application/refund/refund-queries.js';
import { RefundVerificationPayment } from './application/refund/refund-verification-payment.js';
import { RequestManualRefund } from './application/refund/request-manual-refund.js';
import {
  DrizzleRefundPaymentRepository,
  DrizzleRefundVoucherRepository,
} from './infrastructure/drizzle-refund-repositories.js';
import { registerBillingKycConsumers } from './infrastructure/refund-kyc-consumers.js';
import { createRefundAdminRoutes } from './presentation/refund-admin-routes.js';
// BE-S4-07 — đối soát ledger hằng ngày.
import { ListReconciliationReports } from './application/reconciliation/list-reconciliation-reports.js';
import { ReconcileLedger } from './application/reconciliation/reconcile-ledger.js';
import { DrizzleReconciliationRepository } from './infrastructure/drizzle-reconciliation-repository.js';
import { createReconciliationAdminRoutes } from './presentation/reconciliation-admin-routes.js';

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

  // ── Voucher QR & đổi voucher tại quán (BE-S4-05) ──────────────────────────────────────────────
  const voucherLifecycle = new DrizzleVoucherLifecycleRepository(outbox);
  const voucherQrTokens = new HmacVoucherQrTokenService(deriveVoucherQrKey(deps.secret));
  routes.route(
    '/',
    createVoucherRoutes({
      listMyVouchers: new ListMyVouchers({ uow, vouchers: voucherLifecycle }),
      getVoucherQr: new GetVoucherQr({ uow, clock, vouchers: voucherLifecycle, tokens: voucherQrTokens }),
      redeemVoucher: new RedeemVoucher({
        uow,
        clock,
        vouchers: voucherLifecycle,
        ledger: new DrizzleLedgerRepository(),
        tokens: voucherQrTokens,
      }),
      requireUser: deps.requireUser,
      requirePartnerStaff,
    }),
  );

  // ── Hoàn tiền thủ công (BE-S4-04): admin chuyển REFUND_PENDING, job worker gọi cổng ──────────────
  routes.route(
    '/',
    createRefundAdminRoutes({
      requestManualRefund: new RequestManualRefund({
        uow,
        clock,
        auditLogger,
        payments: new DrizzleRefundPaymentRepository(outbox),
        vouchers: new DrizzleRefundVoucherRepository(outbox),
        ledger: new DrizzleLedgerRepository(),
      }),
      requireAdmin: deps.requireAdmin,
    }),
  );

  // ── Báo cáo đối soát ledger (BE-S4-07): job ở worker, admin chỉ đọc ──────────────────────────────
  routes.route(
    '/',
    createReconciliationAdminRoutes({
      listReports: new ListReconciliationReports({
        uow,
        reconciliation: new DrizzleReconciliationRepository(),
      }),
      requireAdmin: deps.requireAdmin,
    }),
  );

  return { name: 'billing', routes, facade };
}

// ── Voucher (BE-S4-05) ─────────────────────────────────────────────────────────────────────────────
export { ActivateVoucher } from './application/voucher/activate-voucher.js';
export type { VoucherExpirySummary } from './application/voucher/expire-due-vouchers.js';
export { VOUCHER_QR_TOKEN_TTL_SECONDS } from './domain/voucher-qr.js';

export interface VoucherExpiryJobDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
}

/**
 * Use case job hết hạn voucher (BE-S4-05) cho worker — tách khỏi `createBillingModule` để worker không phải nối
 * route/gateway/identity.
 */
export function createVoucherExpiryJob(deps: VoucherExpiryJobDeps): ExpireDueVouchers {
  return new ExpireDueVouchers({
    uow: deps.uow,
    clock: deps.clock,
    vouchers: new DrizzleVoucherLifecycleRepository(new OutboxWriter()),
  });
}

// ── Worker billing (BE-S4-04): consumer KycRejected/KycApproved + job hoàn tiền ─────────────────
export {
  REFUND_ON_KYC_REJECTED_CONSUMER,
  SET_VOUCHER_EXPIRY_CONSUMER,
} from './infrastructure/refund-kyc-consumers.js';
export type { RefundVerificationPaymentOutcome } from './application/refund/refund-verification-payment.js';
export type { OverdueRefund } from './application/refund/refund-queries.js';
export type { PendingRefund } from './application/ports/refund-repositories.js';

export interface BillingWorkerDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  /** Cổng thanh toán dùng để gọi `refund` (worker — xem `apps/worker/src/main.ts`). */
  readonly paymentGateway: PaymentGateway;
}

export interface BillingWorker {
  /** Đăng ký consumer `billing.refund-on-kyc-rejected` + `billing.set-voucher-expiry` (trước `registerConsumers`). */
  registerConsumers(bus: EventBus): void;
  /** Job hoàn tiền một khoản `REFUND_PENDING` (gọi cổng ngoài transaction). */
  readonly refundPayment: RefundVerificationPayment;
  /** Liệt kê khoản `REFUND_PENDING` để điều phối job hoàn tiền. */
  readonly listPendingRefunds: ListPendingRefunds;
  /** Khoản `REFUND_PENDING` quá `REFUND_SLA_HOURS` (cảnh báo). */
  readonly findOverdueRefunds: FindOverdueRefunds;
}

/** Composition root phần worker của billing — `apps/worker` nối vào pg-boss. */
export function createBillingWorker(deps: BillingWorkerDeps): BillingWorker {
  const { uow, clock } = deps;
  const outbox = new OutboxWriter();
  const payments = new DrizzleRefundPaymentRepository(outbox);
  const vouchers = new DrizzleRefundVoucherRepository(outbox);
  const ledger = new DrizzleLedgerRepository();
  const consumers = {
    refundOnKycRejected: new RefundOnKycRejected({ clock, payments, vouchers, ledger }),
    setVoucherExpiry: new SetVoucherExpiryOnKycApproved({ clock, vouchers }),
  };
  return {
    registerConsumers: (bus) => registerBillingKycConsumers(bus, consumers),
    refundPayment: new RefundVerificationPayment({
      uow,
      clock,
      gateway: deps.paymentGateway,
      payments,
      ledger,
    }),
    listPendingRefunds: new ListPendingRefunds({ uow, payments }),
    findOverdueRefunds: new FindOverdueRefunds({ uow, clock, payments }),
  };
}

// ── Đối soát ledger hằng ngày (BE-S4-07) ───────────────────────────────────────────────────────────
export type { ReconcileLedgerOutcome } from './application/reconciliation/reconcile-ledger.js';
export type {
  ReconciliationMismatch,
  ReconciliationReportView,
} from './application/reconciliation/reconciliation-views.js';

export interface LedgerReconciliationJobDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
}

/** Use case job đối soát ledger (BE-S4-07) cho worker — không cần nối route/gateway/identity. */
export function createLedgerReconciliationJob(deps: LedgerReconciliationJobDeps): ReconcileLedger {
  return new ReconcileLedger({
    uow: deps.uow,
    clock: deps.clock,
    reconciliation: new DrizzleReconciliationRepository(),
  });
}
