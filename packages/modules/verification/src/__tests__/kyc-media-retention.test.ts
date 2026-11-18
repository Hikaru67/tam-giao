import { KYC_MEDIA_RETENTION_DAYS } from '@tamgiao/contracts/constants';
import {
  FakeClock,
  type ObjectHead,
  type ObjectStorage,
  type Result,
  type StorageBucket,
  type Tx,
  type UnitOfWork,
} from '@tamgiao/kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import type {
  KycMediaCursor,
  KycMediaRetentionRepository,
  KycStoredMedia,
} from '../application/ports/kyc-media-retention-repository.js';
import {
  KYC_PURGE_MEDIA_AUDIT_ACTION,
  PurgeExpiredKycMedia,
} from '../application/purge-expired-kyc-media.js';
import { isKycMediaRetentionExpired, kycMediaRetentionCutoff } from '../domain/kyc-media-retention.js';
import type { KycStatus, KycSubmissionId } from '../domain/kyc-submission.js';
import { RecordingAuditLogger } from './fakes.js';

const DAY_MS = 86_400_000;
const NOW = new Date('2026-11-18T01:00:00.000Z');
const daysAgo = (n: number, extraMs = 0) => new Date(NOW.getTime() - n * DAY_MS - extraMs);

interface Row {
  id: KycSubmissionId;
  status: KycStatus;
  decidedAt: Date | null;
  keys: (string | null)[];
  updatedAt: Date | null;
}

/** Repository in-memory; `locked` mô phỏng dòng đang bị transaction khác giữ (SKIP LOCKED). */
class InMemoryMediaRepository implements KycMediaRetentionRepository {
  rows = new Map<string, Row>();
  locked = new Set<string>();
  failClearFor = new Set<string>();

  add(row: Omit<Row, 'updatedAt' | 'keys'> & { keys?: (string | null)[] }): void {
    const keys = row.keys ?? ['front', 'back', 'selfie', 'single'].map((k) => `kyc_doc/${row.id}/${k}.jpg`);
    this.rows.set(row.id, { ...row, keys, updatedAt: null });
  }

  async findExpired(
    _tx: Tx,
    q: { decidedBefore: Date; after: KycMediaCursor | null; limit: number },
  ): Promise<readonly KycMediaCursor[]> {
    const key = (decidedAt: Date, id: string) => `${decidedAt.toISOString()}|${id}`;
    return [...this.rows.values()]
      .filter(
        (r): r is Row & { decidedAt: Date } =>
          (r.status === 'APPROVED' || r.status === 'REJECTED') &&
          r.decidedAt !== null &&
          r.decidedAt < q.decidedBefore &&
          r.keys.some((k) => k !== null),
      )
      .filter(
        (r) => q.after === null || key(r.decidedAt, r.id) > key(q.after.decidedAt, q.after.submissionId),
      )
      .sort((a, b) => key(a.decidedAt, a.id).localeCompare(key(b.decidedAt, b.id)))
      .slice(0, q.limit)
      .map((r) => ({ submissionId: r.id, decidedAt: r.decidedAt }));
  }

  async lockMedia(_tx: Tx, id: KycSubmissionId): Promise<KycStoredMedia | null> {
    const r = this.rows.get(id);
    if (r === undefined || this.locked.has(id)) return null;
    return {
      submissionId: r.id,
      status: r.status,
      decidedAt: r.decidedAt,
      keys: r.keys.filter((k): k is string => k !== null),
    };
  }

  async clearMedia(_tx: Tx, id: KycSubmissionId, now: Date): Promise<void> {
    if (this.failClearFor.has(id)) throw new Error('db down');
    const r = this.rows.get(id);
    if (r) this.rows.set(id, { ...r, keys: r.keys.map(() => null), updatedAt: now });
  }
}

/** Snapshot/khôi phục repository + audit khi `Err`/throw (mô phỏng rollback). */
class FakeUow implements UnitOfWork {
  constructor(
    private readonly repo: InMemoryMediaRepository,
    private readonly audit: RecordingAuditLogger,
  ) {}
  async run<T, E>(work: (tx: Tx) => Promise<Result<T, E>>): Promise<Result<T, E>> {
    const rows = new Map([...this.repo.rows].map(([k, v]) => [k, { ...v, keys: [...v.keys] }]));
    const entries = [...this.audit.entries];
    const rollback = () => {
      this.repo.rows = rows;
      this.audit.entries = entries;
    };
    try {
      const r = await work({} as Tx);
      if (r.isErr()) rollback();
      return r;
    } catch (e) {
      rollback();
      throw e;
    }
  }
}

class FakeStorage implements ObjectStorage {
  deleted: string[] = [];
  failOn = new Set<string>();
  presignPut(): never {
    throw new Error('not used');
  }
  presignGet(): never {
    throw new Error('not used');
  }
  async head(_b: StorageBucket, _k: string): Promise<ObjectHead | null> {
    return null;
  }
  async delete(bucket: StorageBucket, key: string): Promise<void> {
    if (bucket !== 'privateKyc') throw new Error(`wrong bucket ${bucket}`);
    if (this.failOn.has(key)) throw new Error('storage down');
    this.deleted.push(key);
  }
}

const id = (n: number) => `0190f5a0-0000-7000-8000-${String(n).padStart(12, '0')}` as KycSubmissionId;

describe('kycMediaRetention (domain)', () => {
  it('cutoff = now − KYC_MEDIA_RETENTION_DAYS ngày', () => {
    expect(kycMediaRetentionCutoff(NOW)).toEqual(daysAgo(KYC_MEDIA_RETENTION_DAYS));
  });

  it.each<[string, KycStatus, Date | null, boolean]>([
    ['APPROVED quá hạn 1ms', 'APPROVED', daysAgo(KYC_MEDIA_RETENTION_DAYS, 1), true],
    ['REJECTED quá hạn', 'REJECTED', daysAgo(KYC_MEDIA_RETENTION_DAYS + 5), true],
    ['đúng biên cutoff → chưa quá hạn', 'APPROVED', daysAgo(KYC_MEDIA_RETENTION_DAYS), false],
    ['quyết định gần đây', 'APPROVED', daysAgo(1), false],
    ['chưa quyết định (UNDER_REVIEW)', 'UNDER_REVIEW', daysAgo(100), false],
    ['NEEDS_MORE_INFO', 'NEEDS_MORE_INFO', null, false],
    ['APPROVED nhưng thiếu decidedAt', 'APPROVED', null, false],
  ])('%s', (_name, status, decidedAt, expected) => {
    expect(isKycMediaRetentionExpired({ status, decidedAt }, NOW)).toBe(expected);
  });
});

describe('PurgeExpiredKycMedia', () => {
  let repo: InMemoryMediaRepository;
  let audit: RecordingAuditLogger;
  let storage: FakeStorage;
  let useCase: PurgeExpiredKycMedia;

  beforeEach(() => {
    repo = new InMemoryMediaRepository();
    audit = new RecordingAuditLogger();
    storage = new FakeStorage();
    useCase = new PurgeExpiredKycMedia({
      uow: new FakeUow(repo, audit),
      clock: new FakeClock(NOW),
      media: repo,
      storage,
      auditLogger: audit,
    });
  });

  it('AC1: xoá object + key null + audit actor system cho hồ sơ quá hạn; giữ nguyên hồ sơ chưa đủ hạn / chưa quyết định', async () => {
    repo.add({ id: id(1), status: 'APPROVED', decidedAt: daysAgo(KYC_MEDIA_RETENTION_DAYS + 1) });
    repo.add({ id: id(2), status: 'REJECTED', decidedAt: daysAgo(KYC_MEDIA_RETENTION_DAYS + 2) });
    repo.add({ id: id(3), status: 'APPROVED', decidedAt: daysAgo(KYC_MEDIA_RETENTION_DAYS - 1) });
    repo.add({ id: id(4), status: 'UNDER_REVIEW', decidedAt: null });

    const summary = await useCase.execute();

    expect(summary).toEqual({ purged: 2, skipped: 0, failedIds: [] });
    expect(storage.deleted).toHaveLength(8);
    expect(repo.rows.get(id(1))?.keys).toEqual([null, null, null, null]);
    expect(repo.rows.get(id(1))?.updatedAt).toEqual(NOW);
    expect(repo.rows.get(id(3))?.keys.every((k) => k !== null)).toBe(true);
    expect(repo.rows.get(id(4))?.keys.every((k) => k !== null)).toBe(true);
    expect(audit.entries.map((e) => e.targetId).sort()).toEqual([id(1), id(2)]);
    expect(audit.entries[0]).toMatchObject({
      actor: { type: 'system', id: null },
      action: KYC_PURGE_MEDIA_AUDIT_ACTION,
      targetType: 'kyc_submission',
      meta: { objectCount: 4, retentionDays: KYC_MEDIA_RETENTION_DAYS },
    });
    // Meta không chứa key ảnh.
    expect(JSON.stringify(audit.entries)).not.toContain('kyc_doc/');
  });

  it('AC2: chạy 2 lần → lần 2 không xoá gì, không thêm audit', async () => {
    repo.add({ id: id(1), status: 'APPROVED', decidedAt: daysAgo(KYC_MEDIA_RETENTION_DAYS + 1) });
    await useCase.execute();
    const second = await useCase.execute();
    expect(second).toEqual({ purged: 0, skipped: 0, failedIds: [] });
    expect(audit.entries).toHaveLength(1);
    expect(storage.deleted).toHaveLength(4);
  });

  it('chỉ xoá key còn lại khi một phần key đã null', async () => {
    repo.add({
      id: id(1),
      status: 'APPROVED',
      decidedAt: daysAgo(KYC_MEDIA_RETENTION_DAYS + 1),
      keys: ['a.jpg', null, null, null],
    });
    expect(await useCase.execute()).toMatchObject({ purged: 1 });
    expect(storage.deleted).toEqual(['a.jpg']);
    expect(audit.entries[0]?.meta).toMatchObject({ objectCount: 1 });
  });

  it('quét nhiều lô theo cursor', async () => {
    for (let i = 1; i <= 7; i++) {
      repo.add({ id: id(i), status: 'APPROVED', decidedAt: daysAgo(KYC_MEDIA_RETENTION_DAYS + 1, i % 2) });
    }
    expect(await useCase.execute({ batchSize: 3 })).toEqual({ purged: 7, skipped: 0, failedIds: [] });
    expect(audit.entries).toHaveLength(7);
  });

  it('dòng đang bị khoá (SKIP LOCKED) → bỏ qua, không xoá object', async () => {
    repo.add({ id: id(1), status: 'APPROVED', decidedAt: daysAgo(KYC_MEDIA_RETENTION_DAYS + 1) });
    repo.locked.add(id(1));
    expect(await useCase.execute()).toEqual({ purged: 0, skipped: 1, failedIds: [] });
    expect(storage.deleted).toEqual([]);
    expect(audit.entries).toEqual([]);
  });

  it('storage lỗi ở một hồ sơ → rollback hồ sơ đó, hồ sơ khác vẫn xoá; lượt sau thử lại được', async () => {
    repo.add({ id: id(1), status: 'APPROVED', decidedAt: daysAgo(KYC_MEDIA_RETENTION_DAYS + 2) });
    repo.add({ id: id(2), status: 'APPROVED', decidedAt: daysAgo(KYC_MEDIA_RETENTION_DAYS + 1) });
    storage.failOn.add(`kyc_doc/${id(1)}/selfie.jpg`);

    expect(await useCase.execute()).toEqual({ purged: 1, skipped: 0, failedIds: [id(1)] });
    expect(repo.rows.get(id(1))?.keys.every((k) => k !== null)).toBe(true);
    expect(audit.entries.map((e) => e.targetId)).toEqual([id(2)]);

    storage.failOn.clear();
    expect(await useCase.execute()).toEqual({ purged: 1, skipped: 0, failedIds: [] });
    expect(repo.rows.get(id(1))?.keys).toEqual([null, null, null, null]);
  });

  it('DB lỗi sau khi đã xoá object → key giữ nguyên, không audit (lượt sau xoá lại idempotent)', async () => {
    repo.add({ id: id(1), status: 'REJECTED', decidedAt: daysAgo(KYC_MEDIA_RETENTION_DAYS + 1) });
    repo.failClearFor.add(id(1));
    expect(await useCase.execute()).toEqual({ purged: 0, skipped: 0, failedIds: [id(1)] });
    expect(audit.entries).toEqual([]);
    expect(repo.rows.get(id(1))?.keys.every((k) => k !== null)).toBe(true);
  });

  it('audit bị từ chối → rollback, không đặt key null', async () => {
    repo.add({ id: id(1), status: 'APPROVED', decidedAt: daysAgo(KYC_MEDIA_RETENTION_DAYS + 1) });
    audit.failWith = 'AUDIT_ENTRY_INVALID';
    expect(await useCase.execute()).toEqual({ purged: 0, skipped: 0, failedIds: [id(1)] });
    expect(repo.rows.get(id(1))?.keys.every((k) => k !== null)).toBe(true);
  });
});
