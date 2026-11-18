import { KYC_MEDIA_RETENTION_DAYS } from '@tamgiao/contracts/constants';
import {
  DrizzleUnitOfWork,
  HmacBlindIndexer,
  LocalKeyEncryptor,
  OutboxWriter,
  S3ObjectStorage,
  createDatabase,
  type Database,
} from '@tamgiao/db';
import { FakeClock, newId, ok, type Tx } from '@tamgiao/kernel';
import { ConsoleSmsSender, createIdentityModule } from '@tamgiao/module-identity';
import { resetDatabase, testDatabaseUrl } from '@tamgiao/testing';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CccdNumber } from '../domain/cccd-number.js';
import { KYC_STEPS, KycSubmission, type KycSubmissionId } from '../domain/kyc-submission.js';
import { RejectionReason } from '../domain/rejection-reason.js';
import { DrizzleKycSubmissionRepository } from '../infrastructure/drizzle-kyc-submission-repository.js';
import { createKycMediaRetention } from '../index.js';

const DAY_MS = 86_400_000;
const BUCKET = 'test-private-kyc';
const ACCESS_KEY = 'tamgiao';
const SECRET_KEY = 'tamgiao-local-secret';

let database: Database;
let uow: DrizzleUnitOfWork;
let repo: DrizzleKycSubmissionRepository;
let storage: S3ObjectStorage;
let container: StartedTestContainer | undefined;
const clock = new FakeClock(new Date('2026-09-01T03:00:00.000Z'));
const encryptor = new LocalKeyEncryptor({ currentVersion: 1, keys: new Map([[1, Buffer.alloc(32, 7)]]) });
const blindIndexer = new HmacBlindIndexer(Buffer.alloc(32, 9));

/** SeaweedFS (S3-compatible, giống môi trường local) — bucket tạo qua `weed shell`. */
async function startObjectStorage(): Promise<S3ObjectStorage> {
  const s3Config = JSON.stringify({
    identities: [
      {
        name: 'tamgiao-test',
        credentials: [{ accessKey: ACCESS_KEY, secretKey: SECRET_KEY }],
        actions: ['Admin', 'Read', 'Write', 'List', 'Tagging'],
      },
    ],
  });
  container = await new GenericContainer('chrislusf/seaweedfs:4.53')
    .withCommand([
      'server',
      '-dir=/data',
      '-ip.bind=0.0.0.0',
      '-master.volumeSizeLimitMB=64',
      '-volume.max=0',
      '-s3',
      '-s3.port=8333',
      '-s3.config=/etc/seaweedfs/s3.json',
    ])
    .withCopyContentToContainer([{ content: s3Config, target: '/etc/seaweedfs/s3.json' }])
    .withExposedPorts(8333)
    .withWaitStrategy(Wait.forHttp('/status', 8333).forStatusCode(200))
    .withStartupTimeout(120_000)
    .start();

  let lastOutput = '';
  for (let attempt = 0; attempt < 30; attempt++) {
    const res = await container.exec(['sh', '-c', `echo "s3.bucket.create -name ${BUCKET}" | weed shell`]);
    const list = await container.exec(['sh', '-c', 'echo "s3.bucket.list" | weed shell']);
    lastOutput = `${res.output}\n${list.output}`;
    if (list.output.includes(BUCKET)) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!lastOutput.includes(BUCKET)) throw new Error(`không tạo được bucket: ${lastOutput}`);

  return new S3ObjectStorage(
    {
      endpoint: `http://${container.getHost()}:${container.getMappedPort(8333)}`,
      region: 'us-east-1',
      accessKeyId: ACCESS_KEY,
      secretAccessKey: SECRET_KEY,
      forcePathStyle: true,
      buckets: { publicProfile: 'unused-public', privateKyc: BUCKET },
      presignGetTtlSeconds: 300,
    },
    // Chữ ký presigned theo giờ thật (SeaweedFS kiểm tra hạn URL), không theo FakeClock.
    () => new Date(),
  );
}

/** Tải object thật lên bucket private qua presigned PUT. */
async function putObject(key: string): Promise<void> {
  const body = Buffer.from(`image-bytes:${key}`);
  const presigned = await storage.presignPut({
    bucket: 'privateKyc',
    key,
    contentType: 'image/jpeg',
    sizeBytes: body.length,
    expiresInSeconds: 60,
  });
  const res = await fetch(presigned.url, { method: 'PUT', headers: { ...presigned.headers }, body });
  if (res.status !== 200) throw new Error(`upload ${res.status}`);
}

let cccdSeq = 0;

/** Hồ sơ với 4 ảnh thật trên storage; `decided` = quyết định tại `decidedAt`. */
async function seed(
  decision: { readonly kind: 'APPROVED' | 'REJECTED'; readonly at: Date } | null,
): Promise<{ id: KycSubmissionId; keys: string[] }> {
  const userId = newId<'User'>();
  const reviewer = newId<'Admin'>();
  const submittedAt = new Date((decision?.at ?? clock.now()).getTime() - DAY_MS);
  const keys = [
    `kyc_doc/${userId}/front.jpg`,
    `kyc_doc/${userId}/back.jpg`,
    `kyc_selfie/${userId}/selfie.jpg`,
    `kyc_doc/${userId}/marital.jpg`,
  ];
  for (const key of keys) await putObject(key);

  const s = KycSubmission.start({ id: newId<'KycSubmission'>(), userId }, submittedAt);
  s.attachDocuments(
    {
      cccdFrontKey: keys[0] ?? '',
      cccdBackKey: keys[1] ?? '',
      selfieKey: keys[2] ?? '',
      maritalStatusCertificateKey: keys[3] ?? '',
    },
    submittedAt,
  );
  const cccd = CccdNumber.parse(`0790${String(++cccdSeq).padStart(8, '0')}`);
  if (cccd.isErr()) throw new Error('bad cccd');
  s.recordCccdNumber(cccd.value, submittedAt);
  s.submit(submittedAt);
  if (decision !== null) {
    s.assignReviewer(reviewer, submittedAt);
    if (decision.kind === 'APPROVED') {
      for (const step of KYC_STEPS) s.markStep(step, 'PASSED', submittedAt);
      expect(s.approve(reviewer, decision.at).isOk()).toBe(true);
    } else {
      const reason = RejectionReason.create({ code: 'FACE_MISMATCH', note: null });
      if (reason.isErr()) throw new Error('bad reason');
      expect(s.reject(reason.value, reviewer, decision.at).isOk()).toBe(true);
    }
  }
  const saved = await uow.run((tx: Tx) => repo.save(tx, s));
  if (saved.isErr()) throw new Error(saved.error.code);
  return { id: s.id, keys };
}

async function storedKeys(id: KycSubmissionId): Promise<(string | null)[]> {
  const { rows } = await database.pool.query<Record<string, string | null>>(
    `select cccd_front_key, cccd_back_key, selfie_key, marital_status_certificate_key
       from verification.kyc_submissions where id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) throw new Error('missing row');
  return Object.values(row);
}

async function purgeAudits(): Promise<
  { actor_type: string; actor_id: string | null; target_id: string; meta: Record<string, unknown> }[]
> {
  const { rows } = await database.pool.query(
    `select actor_type, actor_id, target_id, meta from identity.audit_logs
      where action = 'kyc.purge_media' order by target_id`,
  );
  return rows;
}

const heads = (keys: readonly string[]) => Promise.all(keys.map((k) => storage.head('privateKyc', k)));

describe('PurgeExpiredKycMedia (Postgres + S3)', () => {
  let purge: ReturnType<typeof createKycMediaRetention>;

  beforeAll(async () => {
    database = createDatabase(testDatabaseUrl(), { maxConnections: 5 });
    await resetDatabase(database.pool);
    uow = new DrizzleUnitOfWork(database.pool);
    repo = new DrizzleKycSubmissionRepository(encryptor, blindIndexer, new OutboxWriter());
    storage = await startObjectStorage();
    const identity = createIdentityModule({
      uow,
      clock,
      encryptor,
      blindIndexer,
      smsSender: new ConsoleSmsSender(),
      authSecret: Buffer.alloc(32, 11),
    });
    purge = createKycMediaRetention({ uow, clock, storage, auditLogger: identity.auditLogger });
  }, 180_000);

  beforeEach(async () => {
    await database.pool.query(
      'truncate table verification.kyc_submissions, identity.audit_logs, platform.outbox restart identity cascade',
    );
    clock.set(new Date('2026-09-01T03:00:00.000Z'));
  });

  afterAll(async () => {
    await database?.close();
    await container?.stop();
  });

  it('AC1: hồ sơ quyết định > N ngày → object bị xoá, key NULL, có audit; hồ sơ chưa đủ hạn / chưa quyết định giữ nguyên', async () => {
    const start = clock.now();
    const approvedOld = await seed({ kind: 'APPROVED', at: start });
    const rejectedOld = await seed({ kind: 'REJECTED', at: new Date(start.getTime() + 60_000) });
    const approvedRecent = await seed({ kind: 'APPROVED', at: new Date(start.getTime() + 2 * DAY_MS) });
    const pending = await seed(null);

    // Tới thời điểm hồ sơ cũ vừa quá hạn 1 giờ, hồ sơ "gần đây" còn 1 ngày nữa mới tới hạn.
    clock.set(new Date(start.getTime() + 60_000 + KYC_MEDIA_RETENTION_DAYS * DAY_MS + 3_600_000));
    const summary = await purge.execute();

    expect(summary).toEqual({ purged: 2, skipped: 0, failedIds: [] });
    for (const s of [approvedOld, rejectedOld]) {
      expect(await heads(s.keys)).toEqual([null, null, null, null]);
      expect(await storedKeys(s.id)).toEqual([null, null, null, null]);
    }
    for (const s of [approvedRecent, pending]) {
      expect((await heads(s.keys)).every((h) => h !== null)).toBe(true);
      expect(await storedKeys(s.id)).toEqual(s.keys);
    }

    const audits = await purgeAudits();
    expect(audits.map((a) => a.target_id).sort()).toEqual([approvedOld.id, rejectedOld.id].sort());
    for (const a of audits) {
      expect(a.actor_type).toBe('system');
      expect(a.actor_id).toBeNull();
      expect(a.meta).toMatchObject({ objectCount: 4, retentionDays: KYC_MEDIA_RETENTION_DAYS });
      expect(JSON.stringify(a.meta)).not.toContain('kyc_');
    }

    // Metadata + kết quả được giữ: aggregate vẫn dựng lại được, số CCCD còn, chỉ `documents` = null.
    const restored = await uow.run(async (tx) => ok(await repo.findById(tx, approvedOld.id)));
    const state = restored.isOk() ? restored.value?.toState() : undefined;
    expect(state?.status).toBe('APPROVED');
    expect(state?.documents).toBeNull();
    expect(state?.cccdNumber).not.toBeNull();
    expect(state?.steps.INTERVIEW.status).toBe('PASSED');
  });

  it('AC2: chạy job 2 lần không lỗi, lần 2 không xoá thêm và không thêm audit', async () => {
    const start = clock.now();
    const s = await seed({ kind: 'APPROVED', at: start });
    clock.set(new Date(start.getTime() + (KYC_MEDIA_RETENTION_DAYS + 1) * DAY_MS));

    expect(await purge.execute()).toEqual({ purged: 1, skipped: 0, failedIds: [] });
    expect(await purge.execute()).toEqual({ purged: 0, skipped: 0, failedIds: [] });
    expect(await purgeAudits()).toHaveLength(1);
    expect(await storedKeys(s.id)).toEqual([null, null, null, null]);
  });

  it('object đã bị xoá sẵn trên storage (lượt trước lỗi giữa chừng) → vẫn đặt key NULL + audit', async () => {
    const start = clock.now();
    const s = await seed({ kind: 'REJECTED', at: start });
    for (const key of s.keys) await storage.delete('privateKyc', key);
    clock.set(new Date(start.getTime() + (KYC_MEDIA_RETENTION_DAYS + 1) * DAY_MS));

    expect(await purge.execute()).toEqual({ purged: 1, skipped: 0, failedIds: [] });
    expect(await storedKeys(s.id)).toEqual([null, null, null, null]);
    expect(await purgeAudits()).toHaveLength(1);
  });

  it('dòng đang bị transaction khác khoá → bỏ qua (SKIP LOCKED), lượt sau xử lý', async () => {
    const start = clock.now();
    const s = await seed({ kind: 'APPROVED', at: start });
    clock.set(new Date(start.getTime() + (KYC_MEDIA_RETENTION_DAYS + 1) * DAY_MS));

    const client = await database.pool.connect();
    try {
      await client.query('begin');
      await client.query('select id from verification.kyc_submissions where id = $1 for update', [s.id]);
      expect(await purge.execute()).toEqual({ purged: 0, skipped: 1, failedIds: [] });
      expect((await heads(s.keys)).every((h) => h !== null)).toBe(true);
      await client.query('rollback');
    } finally {
      client.release();
    }
    expect(await purge.execute()).toEqual({ purged: 1, skipped: 0, failedIds: [] });
  });

  it('chạy đồng thời 2 lượt → mỗi hồ sơ chỉ 1 audit', async () => {
    const start = clock.now();
    const seeded = [];
    for (let i = 0; i < 3; i++)
      seeded.push(await seed({ kind: 'APPROVED', at: new Date(start.getTime() + i) }));
    clock.set(new Date(start.getTime() + (KYC_MEDIA_RETENTION_DAYS + 1) * DAY_MS));

    const [a, b] = await Promise.all([purge.execute(), purge.execute()]);
    expect((a?.purged ?? 0) + (b?.purged ?? 0)).toBe(3);
    expect([...(a?.failedIds ?? []), ...(b?.failedIds ?? [])]).toEqual([]);
    expect(await purgeAudits()).toHaveLength(3);
    for (const s of seeded) expect(await storedKeys(s.id)).toEqual([null, null, null, null]);
  });
});
