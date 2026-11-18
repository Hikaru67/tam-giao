import { createLogger } from '@tamgiao/config';
import {
  DrizzleUnitOfWork,
  EventBus,
  HmacBlindIndexer,
  LocalKeyEncryptor,
  OutboxRelay,
  S3ObjectStorage,
  createDatabase,
  parseMasterKeyRing,
  registerConsumers,
  registerJob,
} from '@tamgiao/db';
import { PRESIGNED_URL_TTL_SECONDS } from '@tamgiao/contracts';
import { SystemClock } from '@tamgiao/kernel';
import { createBillingWorker, createVoucherExpiryJob, FakePaymentGateway } from '@tamgiao/module-billing';
import { ConsoleSmsSender, createIdentityModule } from '@tamgiao/module-identity';
import { createKycMediaRetention } from '@tamgiao/module-verification';
import { PgBoss } from 'pg-boss';
import { loadWorkerConfig } from './config.js';
import { registerBillingRefundJobs } from './jobs/billing-refund.js';
import { registerKycMediaRetentionJob } from './jobs/kyc-media-retention.js';
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

const bus = new EventBus();
const jobs = registerWorkers(bus);
// Billing (BE-S4-04): consumer KycRejected (hoàn tiền) + KycApproved (đặt hạn voucher), job hoàn tiền bên dưới.
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
await registerConsumers({ boss, uow, bus, logger });
for (const job of jobs) {
  await registerJob({ boss, uow, logger, ...job });
}

// Job xoá ảnh eKYC hết thời hạn lưu (BE-S3-06): storage S3 + audit log của identity.
const clock = new SystemClock();
const identity = createIdentityModule({
  uow,
  clock,
  encryptor: new LocalKeyEncryptor(
    parseMasterKeyRing(config.crypto.masterKeys, config.crypto.masterKeyVersion),
  ),
  blindIndexer: new HmacBlindIndexer(config.crypto.blindIndexKey),
  // Worker không gửi OTP; identity chỉ dùng để lấy `auditLogger`.
  smsSender: new ConsoleSmsSender(),
  authSecret: config.auth.secret,
});
const storage = new S3ObjectStorage({ ...config.storage, presignGetTtlSeconds: PRESIGNED_URL_TTL_SECONDS });
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

// Hoàn tiền (BE-S4-04): job từng khoản (retry backoff) + điều phối REFUND_PENDING + cảnh báo SLA.
await registerBillingRefundJobs({ boss, logger, billing: billingWorker });

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
