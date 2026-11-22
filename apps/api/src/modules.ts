import { PRESIGNED_URL_TTL_SECONDS } from '@tamgiao/contracts';
import {
  HmacBlindIndexer,
  LocalKeyEncryptor,
  S3ObjectStorage,
  UPLOADS_ERASE_ON_ACCOUNT_DELETION_CONSUMER,
  UploadService,
  parseMasterKeyRing,
} from '@tamgiao/db';
import { requireUser, type AppEnv } from '@tamgiao/http';
import type { Clock, ObjectStorage, Scheduler, UnitOfWork } from '@tamgiao/kernel';
import { createDatingModule } from '@tamgiao/module-dating';
import {
  BILLING_ERASE_ON_ACCOUNT_DELETION_CONSUMER,
  FakePaymentGateway,
  createBillingModule,
} from '@tamgiao/module-billing';
import {
  ConsoleSmsSender,
  createIdentityModule,
  type AccountDeletionStep,
  type SmsSender,
} from '@tamgiao/module-identity';
import { MATCH_ERASE_ON_ACCOUNT_DELETION_CONSUMER, createMatchingModule } from '@tamgiao/module-matching';
import {
  MESSAGING_ERASE_ON_ACCOUNT_DELETION_CONSUMER,
  RedisMessageBroadcaster,
  createMessagingModule,
  type MessageBroadcaster,
  type UpgradableServer,
} from '@tamgiao/module-messaging';
import {
  NOTIFICATION_ERASE_ON_ACCOUNT_DELETION_CONSUMER,
  createNotificationModule,
} from '@tamgiao/module-notification';
import { PROFILE_ERASE_ON_ACCOUNT_DELETION_CONSUMER, createProfileModule } from '@tamgiao/module-profile';
import { SAFETY_ERASE_ON_ACCOUNT_DELETION_CONSUMER, createSafetyModule } from '@tamgiao/module-safety';
import {
  VERIFICATION_ERASE_ON_ACCOUNT_DELETION_CONSUMER,
  FakeEkycProvider,
  ResilientEkycProvider,
  createVerificationModule,
  type ApplicantDirectory,
  type ApplicantProfileReader,
  type PaymentStatusReader,
} from '@tamgiao/module-verification';
import type { Logger } from '@tamgiao/config';
import type { Hono } from 'hono';
import type { ApiConfig } from './config.js';
import { createUploadRoutes } from './http/uploads.js';

/**
 * Hợp đồng giữa composition root và từng module nghiệp vụ.
 * Mỗi module export `createXModule(deps)` từ `packages/modules/<x>/src/index.ts`;
 * route của module tự mang prefix của mình (vd `/me/match`, `/admin/matches`).
 */
export interface ApiModule {
  readonly name: string;
  readonly routes: Hono<AppEnv>;
  /** Endpoint realtime (WS) gắn thẳng vào HTTP server — `main.ts` gọi `attach` sau `serve`, `close` khi tắt. */
  readonly realtime?: RealtimeEndpoint;
}

export interface RealtimeEndpoint {
  attach(server: UpgradableServer): Promise<void>;
  close(): Promise<void>;
}

export interface ModuleDeps {
  readonly config: ApiConfig;
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  /** Ghi job hẹn giờ cùng transaction (`PgBossScheduler` — xem `job-scheduler.ts`). */
  readonly scheduler: Scheduler;
  readonly logger: Logger;
  /**
   * Thay adapter hạ tầng bên ngoài (SMS, object storage, Redis pub/sub) — để test dựng đúng composition thật của API
   * với Fake (test meta route admin, test IDOR — BE-S7-07). Bỏ trống = adapter thật theo `config`.
   */
  readonly adapters?: ModuleAdapterOverrides;
}

export interface ModuleAdapterOverrides {
  readonly smsSender?: SmsSender;
  readonly storage?: ObjectStorage;
  readonly broadcaster?: MessageBroadcaster & { close(): Promise<void> };
}

/**
 * Các module tự xoá/ẩn danh dữ liệu khi nhận `AccountDeletionRequested` (BE-S7-06) — consumer chạy ở worker; API chỉ
 * dùng danh sách này để báo tiến độ (`GET /account-deletions/:id`). Thêm module mới có dữ liệu cá nhân → thêm vào đây.
 */
export const ACCOUNT_DELETION_STEPS: readonly AccountDeletionStep[] = [
  { module: 'profile', consumer: PROFILE_ERASE_ON_ACCOUNT_DELETION_CONSUMER },
  { module: 'verification', consumer: VERIFICATION_ERASE_ON_ACCOUNT_DELETION_CONSUMER },
  { module: 'billing', consumer: BILLING_ERASE_ON_ACCOUNT_DELETION_CONSUMER },
  { module: 'matching', consumer: MATCH_ERASE_ON_ACCOUNT_DELETION_CONSUMER },
  { module: 'messaging', consumer: MESSAGING_ERASE_ON_ACCOUNT_DELETION_CONSUMER },
  { module: 'safety', consumer: SAFETY_ERASE_ON_ACCOUNT_DELETION_CONSUMER },
  { module: 'notification', consumer: NOTIFICATION_ERASE_ON_ACCOUNT_DELETION_CONSUMER },
  { module: 'uploads', consumer: UPLOADS_ERASE_ON_ACCOUNT_DELETION_CONSUMER },
];

/** Nối hạ tầng dùng chung vào từng module (thứ tự = thứ tự phụ thuộc giữa các module). */
export function buildModules({
  config,
  uow,
  clock,
  scheduler,
  logger,
  adapters = {},
}: ModuleDeps): readonly ApiModule[] {
  const encryptor = new LocalKeyEncryptor(
    parseMasterKeyRing(config.crypto.masterKeys, config.crypto.masterKeyVersion),
  );
  const blindIndexer = new HmacBlindIndexer(config.crypto.blindIndexKey);
  const storage =
    adapters.storage ??
    new S3ObjectStorage({ ...config.storage, presignGetTtlSeconds: PRESIGNED_URL_TTL_SECONDS });

  const identity = createIdentityModule({
    uow,
    clock,
    encryptor,
    blindIndexer,
    // `SMS_PROVIDER` hiện chỉ có `console` (D4) — config đã chặn giá trị này ở production.
    smsSender: adapters.smsSender ?? new ConsoleSmsSender(),
    authSecret: config.auth.secret,
    // Quyền dữ liệu cá nhân (BE-S7-06): xuất dữ liệu + xoá tài khoản; tiến độ xoá theo consumer của từng module (worker).
    dataRights: { storage, accountDeletionSteps: ACCOUNT_DELETION_STEPS },
  });

  // Upload qua presigned URL (BE-S2-07). `uploads` (UploadRegistry) sẽ truyền vào profile/verification/safety.
  const uploads = new UploadService({ uow, clock, storage, putTtlSeconds: PRESIGNED_URL_TTL_SECONDS });
  const userGuard = requireUser(identity.facade.authenticateUser);
  const uploadModule: ApiModule = {
    name: 'uploads',
    routes: createUploadRoutes({ uploads, requireUser: userGuard }),
  };

  // Billing (Sprint 4): quán đối tác + nhân viên quán (BE-S4-06), thanh toán xác thực + webhook (BE-S4-03).
  // Khoá partner dẫn xuất từ AUTH_SECRET (HKDF, tách miền). Billing không phụ thuộc module nào khác nên tạo trước
  // verification/profile — hai module này đọc `billing.facade` (chặn nộp eKYC khi chưa thanh toán, `GET /me`).
  // `PAYMENT_GATEWAY` hiện chỉ có `fake` (D3) — config đã chặn ở production; endpoint giả lập chỉ mount ngoài production.
  const paymentGateway = new FakePaymentGateway({ secret: config.payment.webhookSecret, clock });
  const billing = createBillingModule({
    uow,
    clock,
    secret: config.auth.secret,
    requireUser: userGuard,
    requireAdmin: identity.requireAdmin,
    auditLogger: identity.auditLogger,
    paymentGateway,
    paymentGatewayName: config.payment.gateway,
    paymentReturnUrl: config.payment.returnUrl,
    devPaymentSimulator:
      config.payment.gateway === 'fake' && config.nodeEnv !== 'production' ? paymentGateway : undefined,
  });
  const paymentStatus: PaymentStatusReader = {
    hasPaidVerification: (userId) => billing.facade.hasPaidVerification(userId),
  };

  // Profile ↔ verification cần facade của nhau ở runtime (không phụ thuộc vòng ở package): verification đọc họ tên
  // để đối chiếu OCR, profile đọc trạng thái xác thực cho `GET /me`. Tạo verification trước; `applicants` chuyển
  // tiếp sang `profile.facade` lúc xử lý request (khi đó `profile` đã được khởi tạo).
  const applicants: ApplicantProfileReader = {
    getApplicantIdentity: (userId) => profile.facade.getApplicantIdentity(userId),
  };
  const applicantDirectory: ApplicantDirectory = {
    searchUserIds: (text, limit) => profile.facade.searchUserIds(text, limit),
    getApplicantSummaries: (userIds) => profile.facade.getApplicantSummaries(userIds),
  };

  // eKYC (D2 chưa chốt): `EKYC_PROVIDER=fake` — mỗi người dùng một số CCCD giả khác nhau (theo key ảnh).
  const ekyc = new ResilientEkycProvider(new FakeEkycProvider({ deriveCccdFromKey: true }), {
    timeoutMs: config.ekyc.timeoutMs,
    maxAttempts: config.ekyc.maxAttempts,
    backoffMs: config.ekyc.backoffMs,
  });
  const verification = createVerificationModule({
    uow,
    clock,
    encryptor,
    blindIndexer,
    uploads,
    ekyc,
    applicants,
    payments: paymentStatus,
    applicantDirectory,
    storage,
    requireUser: userGuard,
    requireAdmin: identity.requireAdmin,
    auditLogger: identity.auditLogger,
  });
  const profile = createProfileModule({
    uow,
    clock,
    encryptor,
    uploads,
    storage,
    verification: verification.facade,
    billing: billing.facade,
    requireUser: userGuard,
  });

  // Matching (Sprint 5): đề xuất ghép đôi, phản hồi lời ngỏ, màn ghép đôi user + admin (route BE-S5-07).
  const matching = createMatchingModule({
    uow,
    clock,
    verification: verification.facade,
    auditLogger: identity.auditLogger,
    requireAdmin: identity.requireAdmin,
    requireUser: userGuard,
    scheduler,
    profiles: profile.facade,
  });

  // Messaging (Sprint 6): hội thoại mở/đóng ở worker theo event matching (BE-S6-01). WS `/ws` + Redis pub/sub đa
  // instance, `GET /me/conversations/:id/messages?after=` (BE-S6-02); bộ lọc nội dung (`screener`) ở BE-S6-03.
  // Handshake WS xác thực bằng cùng `authenticateUser` với guard REST.
  const broadcaster =
    adapters.broadcaster ??
    new RedisMessageBroadcaster({
      url: config.redis.url,
      onError: (error) => logger.warn({ err: error }, 'messaging redis error'),
    });
  const messagingModule = createMessagingModule({
    uow,
    clock,
    requireUser: userGuard,
    authenticateUser: identity.facade.authenticateUser,
    broadcaster,
    logger,
  });
  const messaging: ApiModule = {
    name: messagingModule.name,
    routes: messagingModule.routes,
    realtime: {
      attach: (server) => messagingModule.realtime.attach(server),
      close: async () => {
        await messagingModule.realtime.close();
        await broadcaster.close();
      },
    },
  };

  // Safety (Sprint 6): báo cáo vi phạm `POST /me/reports` (BE-S6-05) — chỉ báo cáo người đang/đã từng ghép (facade
  // matching), ảnh bằng chứng xác nhận qua `uploads`. Khoá match chạy ở worker (consumer `ReportFiled` của matching).
  const safety = createSafetyModule({
    uow,
    clock,
    uploads,
    matching: matching.facade,
    requireUser: userGuard,
    // BE-S6-06: route admin kiểm duyệt (báo cáo, tin gắn cờ qua facade messaging, khoá tài khoản).
    requireAdmin: identity.requireAdmin,
    auditLogger: identity.auditLogger,
    storage,
    messaging: messagingModule.facade,
  });

  // Notification (BE-S7-05): đăng ký thiết bị push + cài đặt nhận thông báo. Gửi push/SMS chạy ở worker.
  const notification = createNotificationModule({ uow, clock, requireUser: userGuard });

  // Dating (Sprint 7): đặt lịch gặp tại quán đối tác (BE-S7-01) — match phải `DATING` (facade matching), quán đang
  // hoạt động (facade quán của billing). Hết hạn xác nhận chạy ở worker; voucher kích hoạt qua event `DateConfirmed`.
  // Check-in an toàn (BE-S7-02): vị trí mã hoá qua `encryptor`.
  const dating = createDatingModule({
    uow,
    clock,
    scheduler,
    encryptor,
    requireUser: userGuard,
    matching: matching.facade,
    partners: billing.partnerFacade,
    // BE-S7-03: hàng chờ cờ "khác biệt eKYC" + xem đánh giá kín (audit).
    requireAdmin: identity.requireAdmin,
    auditLogger: identity.auditLogger,
  });

  return [
    identity,
    uploadModule,
    profile,
    verification,
    billing,
    matching,
    messaging,
    safety,
    notification,
    dating,
  ];
}
