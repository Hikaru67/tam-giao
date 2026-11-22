import { FakeClock, newId, type Tx } from '@tamgiao/kernel';
import { resetDatabase, testDatabaseUrl, withRollback } from '@tamgiao/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../../client.js';
import { DrizzleUnitOfWork } from '../../unit-of-work.js';
import { S3ObjectStorage } from '../s3-object-storage.js';
import { UploadService, type UploadTicket } from '../upload-service.js';
import { createBuckets, startSeaweedFs } from './seaweedfs-container.js';

let database: Database;
let seaweed: Awaited<ReturnType<typeof startSeaweedFs>>;
let storage: S3ObjectStorage;
let uploads: UploadService;
let uow: DrizzleUnitOfWork;
const clock = new FakeClock(new Date());

beforeAll(async () => {
  database = createDatabase(testDatabaseUrl(), { maxConnections: 5 });
  uow = new DrizzleUnitOfWork(database.pool);
  seaweed = await startSeaweedFs();
  await createBuckets(seaweed.endpoint, ['it-public-profile', 'it-private-kyc']);
  storage = new S3ObjectStorage({
    endpoint: seaweed.endpoint,
    region: 'us-east-1',
    accessKeyId: seaweed.accessKeyId,
    secretAccessKey: seaweed.secretAccessKey,
    forcePathStyle: true,
    buckets: { publicProfile: 'it-public-profile', privateKyc: 'it-private-kyc' },
    presignGetTtlSeconds: 300,
  });
  uploads = new UploadService({ uow, clock, storage, putTtlSeconds: 300 });
});
beforeEach(() => resetDatabase(database.pool));
afterAll(async () => {
  await database.close();
  await seaweed.stop();
});

const userA = newId<'User'>();
const userB = newId<'User'>();
const png = (size: number) => new Uint8Array(size).fill(7);

async function ticket(
  ownerId: string,
  purpose: 'profile_photo' | 'kyc_doc',
  size = 64,
): Promise<UploadTicket> {
  const r = await uploads.requestUpload({ ownerId, purpose, contentType: 'image/png', sizeBytes: size });
  if (r.isErr()) throw new Error(r.error.code);
  return r.value;
}

async function put(t: UploadTicket, body: Uint8Array): Promise<Response> {
  return fetch(t.url, {
    method: 'PUT',
    headers: { ...t.headers }, // fetch tự đặt content-length theo body
    // Bản sao dựa trên ArrayBuffer: kiểu DOM `BodyInit` (nạp kèm jsdom từ FE-S1-01) không nhận `Uint8Array<ArrayBufferLike>`.
    body: new Uint8Array(body),
  });
}

const verify = (tx: Tx, ownerId: string, key: string, purposes = ['profile_photo', 'kyc_doc'] as const) =>
  uploads.verifyOwned(tx, { ownerId, key, purposes });

const uploadRow = async (key: string) =>
  (
    await database.pool.query<{ owner_id: string; status: string; bucket: string }>(
      'select owner_id, status, bucket from platform.uploads where key = $1',
      [key],
    )
  ).rows[0];

describe('UploadService.requestUpload', () => {
  it('records a PENDING upload and the presigned PUT stores the object in the purpose bucket', async () => {
    const t = await ticket(userA, 'kyc_doc');
    expect(await uploadRow(t.key)).toEqual({ owner_id: userA, status: 'PENDING', bucket: 'privateKyc' });
    expect((await put(t, png(64))).ok).toBe(true);
    expect(await storage.head('privateKyc', t.key)).toEqual({ sizeBytes: 64, contentType: 'image/png' });
    expect(await storage.head('publicProfile', t.key)).toBeNull();
  });

  it('wrong mime or size → UPLOAD_INVALID, nothing recorded (AC2)', async () => {
    const bad = await uploads.requestUpload({
      ownerId: userA,
      purpose: 'profile_photo',
      contentType: 'image/gif',
      sizeBytes: 10,
    });
    expect(bad.isErr() && bad.error).toMatchObject({ code: 'UPLOAD_INVALID' });
    const big = await uploads.requestUpload({
      ownerId: userA,
      purpose: 'profile_photo',
      contentType: 'image/png',
      sizeBytes: 50 * 1024 * 1024,
    });
    expect(big.isErr() && big.error).toMatchObject({ code: 'UPLOAD_INVALID' });
    const { rows } = await database.pool.query('select count(*)::int as n from platform.uploads');
    expect(rows[0]).toEqual({ n: 0 });
  });

  it('the signed URL rejects a body larger than the declared size', async () => {
    const t = await ticket(userA, 'profile_photo', 16);
    expect((await put(t, png(4096))).ok).toBe(false);
    expect(await storage.head('publicProfile', t.key)).toBeNull();
  });
});

describe('UploadService.verifyOwned', () => {
  it("user B cannot use user A's key → UPLOAD_NOT_OWNED (AC1)", async () => {
    const t = await ticket(userA, 'profile_photo');
    await put(t, png(64));
    const r = await withRollback(uow, (tx) => verify(tx, userB, t.key));
    expect(r.isErr() && r.error.code).toBe('UPLOAD_NOT_OWNED');
    const unknown = await withRollback(uow, (tx) => verify(tx, userB, `profile_photo/${userB}/nope.png`));
    expect(unknown.isErr() && unknown.error.code).toBe('UPLOAD_NOT_OWNED');
    expect((await uploadRow(t.key))?.status).toBe('PENDING');
  });

  it('owner verifies an uploaded object → CONFIRMED; verifying again is idempotent', async () => {
    const t = await ticket(userA, 'profile_photo');
    await put(t, png(64));
    for (let i = 0; i < 2; i++) {
      const r = await uow.run((tx) => verify(tx, userA, t.key));
      expect(r.isOk() && r.value).toMatchObject({
        ownerId: userA,
        key: t.key,
        bucket: 'publicProfile',
        purpose: 'profile_photo',
        sizeBytes: 64,
      });
    }
    expect((await uploadRow(t.key))?.status).toBe('CONFIRMED');
  });

  it('object not uploaded yet or wrong purpose → UPLOAD_INVALID', async () => {
    const t = await ticket(userA, 'kyc_doc');
    const missing = await withRollback(uow, (tx) => verify(tx, userA, t.key));
    expect(missing.isErr() && missing.error).toMatchObject({
      code: 'UPLOAD_INVALID',
      details: { reason: 'NOT_UPLOADED' },
    });
    await put(t, png(64));
    const wrong = await withRollback(uow, (tx) =>
      uploads.verifyOwned(tx, { ownerId: userA, key: t.key, purposes: ['profile_photo'] }),
    );
    expect(wrong.isErr() && wrong.error).toMatchObject({
      code: 'UPLOAD_INVALID',
      details: { reason: 'WRONG_PURPOSE' },
    });
  });
});
