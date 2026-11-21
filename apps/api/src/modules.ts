import { PRESIGNED_URL_TTL_SECONDS } from '@tamgiao/contracts';
import {
  HmacBlindIndexer,
  LocalKeyEncryptor,
  S3ObjectStorage,
  UploadService,
  parseMasterKeyRing,
} from '@tamgiao/db';
import { requireUser, type AppEnv } from '@tamgiao/http';
import type { Clock, Scheduler, UnitOfWork } from '@tamgiao/kernel';
import { FakePaymentGateway, createBillingModule } from '@tamgiao/module-billing';
import { ConsoleSmsSender, createIdentityModule } from '@tamgiao/module-identity';
import { createMatchingModule } from '@tamgiao/module-matching';
import {
  RedisMessageBroadcaster,
  createMessagingModule,
  type UpgradableServer,
} from '@tamgiao/module-messaging';
import { createProfileModule } from '@tamgiao/module-profile';
import { createSafetyModule } from '@tamgiao/module-safety';
import {
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
}

/** Nối hạ tầng dùng chung vào từng module (thứ tự = thứ tự phụ thuộc giữa các module). */
export function buildModules({ config, uow, clock, scheduler, logger }: ModuleDeps): readonly ApiModule[] {
  const encryptor = new LocalKeyEncryptor(
    parseMasterKeyRing(config.crypto.masterKeys, config.crypto.masterKeyVersion),
  );
  const blindIndexer = new HmacBlindIndexer(config.crypto.blindIndexKey);

  const identity = createIdentityModule({
    uow,
    clock,
    encryptor,
    blindIndexer,
    // `SMS_PROVIDER` hiện chỉ có `console` (D4) — config đã chặn giá trị này ở production.
    smsSender: new ConsoleSmsSender(),
    authSecret: config.auth.secret,
  });

  // Upload qua presigned URL (BE-S2-07). `uploads` (UploadRegistry) sẽ truyền vào profile/verification/safety.
  const storage = new S3ObjectStorage({ ...config.storage, presignGetTtlSeconds: PRESIGNED_URL_TTL_SECONDS });
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
  const broadcaster = new RedisMessageBroadcaster({
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
  });

  return [identity, uploadModule, profile, verification, billing, matching, messaging, safety];
}
