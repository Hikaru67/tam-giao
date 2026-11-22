import { createLogger } from '@tamgiao/config';
import {
  DrizzleUnitOfWork,
  EventBus,
  HmacBlindIndexer,
  LocalKeyEncryptor,
  OutboxRelay,
  PgBossScheduler,
  S3ObjectStorage,
  createDatabase,
  parseMasterKeyRing,
  registerConsumers,
  registerJob,
} from '@tamgiao/db';
import { PRESIGNED_URL_TTL_SECONDS } from '@tamgiao/contracts';
import { SystemClock } from '@tamgiao/kernel';
import {
  createBillingWorker,
  createLedgerReconciliationJob,
  createVoucherExpiryJob,
  FakePaymentGateway,
} from '@tamgiao/module-billing';
import { createExpireDatePlanJob } from '@tamgiao/module-dating';
import {
  ConsoleSmsSender,
  createDataExportPurgeJob,
  createIdentityModule,
  createIdentityWorker,
} from '@tamgiao/module-identity';
import { createExpireMatchJob, createMatchingWorker } from '@tamgiao/module-matching';
import { createMessagingWorker } from '@tamgiao/module-messaging';
import { createNotificationWorker, ExpoPushSender, FakePushSender } from '@tamgiao/module-notification';
import { createMatchingProfileReader } from '@tamgiao/module-profile';
import { createKycMediaRetention } from '@tamgiao/module-verification';
import { PgBoss } from 'pg-boss';
import { loadWorkerConfig } from './config.js';
import { personalDataSources, registerAccountDeletionConsumers } from './data-rights.js';
import { registerBillingRefundJobs } from './jobs/billing-refund.js';
import { registerDatePlanExpiryJob } from './jobs/date-plan-expiry.js';
import { registerDataExportPurgeJob } from './jobs/data-export-purge.js';
import { registerKycMediaRetentionJob } from './jobs/kyc-media-retention.js';
import { registerLedgerReconciliationJob } from './jobs/ledger-reconciliation.js';
import { registerMatchExpiryJob } from './jobs/match-expiry.js';
import { registerNotificationSendJob } from './jobs/notification-send.js';
import { registerVoucherExpiryJob } from './jobs/voucher-expiry.js';
import { registerWorkers } from './registry.js';

/** Composition root của worker: relay outbox → hàng đợi consumer, và chạy job hẹn giờ. */
const SHUTDOWN_TIMEOUT_MS = 15_000;
const RELAY_INTERVAL_MS = 1_000;

const config = loadWorkerConfig();
const logger = createLogger({ service: 'worker', level: config.logLevel });
const database = createDatabase(config.database.url);
const uow = new DrizzleUnitOfWork(database.pool);

const boss = new PgBoss({ connectionString: config.database.url });
boss.on('error', (error) => logger.error({ err: error }, 'pg-boss error'));
await boss.start();

const clock = new SystemClock();
const encryptor = new LocalKeyEncryptor(
  parseMasterKeyRing(config.crypto.masterKeys, config.crypto.masterKeyVersion),
);
const storage = new S3ObjectStorage({ ...config.storage, presignGetTtlSeconds: PRESIGNED_URL_TTL_SECONDS });

const bus = new EventBus();
const jobs = registerWorkers(bus);
// Billing (BE-S4-04): consumer KycRejected (hoàn tiền) + KycApproved (đặt hạn voucher), job hoàn tiền bên dưới.
// BE-S7-01: consumer DateConfirmed (dating) → kích hoạt voucher của người mời.
// Fake trong worker là instance khác với API → không biết giao dịch do API tạo; `acceptUnknownRefunds` để hoàn
// được ở dev. Config đã cấm `fake` ở production.
const billingWorker = createBillingWorker({
  uow,
  clock: new SystemClock(),
  paymentGateway: new FakePaymentGateway({
    secret: config.payment.webhookSecret,
    acceptUnknownRefunds: true,
  }),
});
billingWorker.registerConsumers(bus);
// Matching (BE-S5-03): read model `matching.candidate_profiles` từ ProfileCompleted / PreferencesUpdated (đọc lại
// facade profile) + KycApproved / KycRejected (cờ verified). BE-S6-05: ReportFiled (safety) → khoá match (`LOCKED`).
createMatchingWorker({
  clock: new SystemClock(),
  profiles: createMatchingProfileReader({ uow }),
  scheduler: new PgBossScheduler(boss),
}).registerConsumers(bus);
// Messaging (BE-S6-01): MatchStartedDating → mở hội thoại; MatchClosed / MatchLocked → đóng.
createMessagingWorker({ clock: new SystemClock() }).registerConsumers(bus);
// Identity (BE-S6-06): UserBanned (safety) → chặn đăng nhập + thu hồi mọi phiên. Matching xử lý cùng event ở trên
// (loại khỏi ứng viên + khoá match đang mở).
// BE-S7-06: DataExportRequested → dựng file xuất dữ liệu từ nguồn của mọi module.
createIdentityWorker({
  clock: new SystemClock(),
  dataExport: { encryptor, sources: personalDataSources({ encryptor }) },
}).registerConsumers(bus);
// BE-S7-06: AccountDeletionRequested → mỗi module tự xoá/ẩn danh dữ liệu của mình (matching + messaging đăng ký ở trên).
registerAccountDeletionConsumers(bus, { clock, encryptor, storage });
// Notification (BE-S7-05): consumer event → `notification.deliveries` + hẹn job `notification.send` (push Expo; SMS thay
// thế cho thông báo giao dịch). SMS dùng lại adapter của identity (D4); chưa có facade identity tra SĐT nên `phones`
// bỏ trống → chưa gửi SMS thay thế (xem báo cáo BE-S7-05).
const notificationWorker = createNotificationWorker({
  uow,
  clock: new SystemClock(),
  scheduler: new PgBossScheduler(boss),
  push:
    config.push.provider === 'expo'
      ? new ExpoPushSender(
          config.push.expoAccessToken === undefined ? {} : { accessToken: config.push.expoAccessToken },
        )
      : new FakePushSender(),
  sms: new ConsoleSmsSender(),
});
notificationWorker.registerConsumers(bus);
await registerNotificationSendJob({ boss, logger, sender: notificationWorker.sendNotification });
await registerConsumers({ boss, uow, bus, logger });
for (const job of jobs) {
  await registerJob({ boss, uow, logger, ...job });
}

// Job xoá ảnh eKYC hết thời hạn lưu (BE-S3-06): storage S3 + audit log của identity.
const identity = createIdentityModule({
  uow,
  clock,
  encryptor,
  blindIndexer: new HmacBlindIndexer(config.crypto.blindIndexKey),
  // Worker không gửi OTP; identity chỉ dùng để lấy `auditLogger`.
  smsSender: new ConsoleSmsSender(),
  authSecret: config.auth.secret,
});
await registerKycMediaRetentionJob({
  boss,
  logger,
  purge: createKycMediaRetention({ uow, clock, storage, auditLogger: identity.auditLogger }),
  ...config.jobs.kycMediaRetention,
});

// Job chuyển voucher quá hạn sang EXPIRED (BE-S4-05).
await registerVoucherExpiryJob({
  boss,
  logger,
  expirer: createVoucherExpiryJob({ uow, clock }),
  ...config.jobs.voucherExpiry,
});

// Đối soát ledger hằng ngày (BE-S4-07): lệch → log error + báo cáo MISMATCH.
await registerLedgerReconciliationJob({
  boss,
  logger,
  reconciler: createLedgerReconciliationJob({ uow, clock }),
  ...config.jobs.ledgerReconciliation,
});

// Hoàn tiền (BE-S4-04): job từng khoản (retry backoff) + điều phối REFUND_PENDING + cảnh báo SLA.
await registerBillingRefundJobs({ boss, logger, billing: billingWorker });

// Xoá nội dung file xuất dữ liệu quá hạn tải 24 giờ (BE-S7-06).
await registerDataExportPurgeJob({ boss, logger, purger: createDataExportPurgeJob({ uow, clock, encryptor }) });

// Hết hạn match (BE-S5-05): job `matching.expire-match` do API hẹn lúc `expiresAt` → `ExpireMatch` (idempotent).
await registerMatchExpiryJob({
  boss,
  uow,
  logger,
  expirer: createExpireMatchJob({ uow, clock, scheduler: new PgBossScheduler(boss) }),
});

// Hết hạn xác nhận lịch hẹn (BE-S7-01): job `dating.expire-date-plan` do API hẹn lúc `expiresAt` → `ExpireDatePlan`.
await registerDatePlanExpiryJob({
  boss,
  uow,
  logger,
  expirer: createExpireDatePlanJob({ uow, clock }),
});

const relay = new OutboxRelay({ uow, boss, bus, logger });
relay.start(RELAY_INTERVAL_MS);
logger.info({ consumers: bus.list().length, jobs: jobs.length }, 'worker started');

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');
  const force = setTimeout(() => {
    logger.error('shutdown timed out, forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  force.unref();

  await relay.stop();
  await boss.stop({ graceful: true, timeout: SHUTDOWN_TIMEOUT_MS - 2_000 });
  await database.close();
  logger.info('shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
