import { KYC_EKYC_FLAGS } from '@tamgiao/contracts';
import { FakeClock, newId, type ObjectStorage, type Result, type Tx } from '@tamgiao/kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import { ApproveKyc } from '../application/admin/approve-kyc.js';
import { AssignReviewer } from '../application/admin/assign-reviewer.js';
import { GetKycReviewDetail } from '../application/admin/get-kyc-review-detail.js';
import { GetKycReviewQueue } from '../application/admin/get-kyc-review-queue.js';
import { MarkStepPassed } from '../application/admin/mark-step-passed.js';
import { RejectKyc } from '../application/admin/reject-kyc.js';
import { RequestMoreInfo } from '../application/admin/request-more-info.js';
import type { ReviewActor } from '../application/admin/run-review-action.js';
import type {
  KycQueueCursor,
  KycQueueFilter,
  KycQueueRow,
  KycReviewQueue,
} from '../application/ports/kyc-review-queue.js';
import { CccdNumber } from '../domain/cccd-number.js';
import { EKYC_FLAGS, ekycFlags } from '../domain/ekyc-flags.js';
import {
  KYC_STEPS,
  KycSubmission,
  type EkycAssessment,
  type KycSubmissionId,
} from '../domain/kyc-submission.js';
import {
  FakeApplicantDirectory,
  FakeApplicantProfileReader,
  FakeUnitOfWork,
  InMemoryKycSubmissionRepository,
  RecordingAuditLogger,
} from './fakes.js';

/** Lấy giá trị `Ok` hoặc ném lỗi kèm mã (cho gọn test). */
function unwrap<T, E>(r: Result<T, E>): T {
  if (r.isErr()) throw new Error(`expected Ok, got ${JSON.stringify(r.error)}`);
  return r.value;
}

const T0 = new Date('2026-11-18T03:00:00.000Z');
const tx = {} as Tx;
const reviewer: ReviewActor = { adminId: newId<'AdminUser'>(), ip: '203.0.113.7' };
const otherReviewer: ReviewActor = { adminId: newId<'AdminUser'>(), ip: '203.0.113.8' };

let clock: FakeClock;
let repo: InMemoryKycSubmissionRepository;
let uow: FakeUnitOfWork;
let audit: RecordingAuditLogger;
let directory: FakeApplicantDirectory;
let identities: FakeApplicantProfileReader;
let presigned: string[];

const storage: ObjectStorage = {
  presignPut: async () => {
    throw new Error('not used');
  },
  presignGet: async ({ bucket, key }) => {
    presigned.push(`${bucket}:${key}`);
    return {
      url: `https://storage.test/${key}`,
      method: 'GET',
      headers: {},
      expiresAt: new Date(T0.getTime() + 300_000),
    };
  },
  head: async () => null,
  delete: async () => undefined,
};

const CLEAN_ASSESSMENT: EkycAssessment = {
  ocr: { status: 'OK', score: null },
  liveness: { status: 'OK', score: 0.97 },
  faceMatch: { status: 'OK', score: 0.91 },
  profileMismatches: [],
  assessedAt: T0,
};

interface SeedOptions {
  readonly withCccd?: boolean;
  readonly submit?: boolean;
  readonly assessment?: EkycAssessment | null;
  readonly submittedAt?: Date;
}

async function seed(options: SeedOptions = {}): Promise<KycSubmissionId> {
  const userId = newId<'User'>();
  const at = options.submittedAt ?? clock.now();
  const s = KycSubmission.start({ id: newId<'KycSubmission'>(), userId }, at);
  s.attachDocuments(
    {
      cccdFrontKey: `kyc_doc/${userId}/front.jpg`,
      cccdBackKey: `kyc_doc/${userId}/back.jpg`,
      selfieKey: `kyc_selfie/${userId}/selfie.jpg`,
      maritalStatusCertificateKey: `kyc_doc/${userId}/marital.jpg`,
    },
    at,
  );
  if (options.withCccd ?? true) {
    s.recordCccdNumber(unwrap(CccdNumber.parse(`0790${String(repo.rows.size).padStart(8, '0')}`)), at);
  }
  if (options.assessment !== null) s.recordEkycAssessment(options.assessment ?? CLEAN_ASSESSMENT, at);
  if (options.submit ?? true) s.submit(at);
  unwrap(await repo.save(tx, s));
  repo.events = [];
  return s.id;
}

const deps = () => ({ uow, clock, submissions: repo, auditLogger: audit });
const stored = async (id: KycSubmissionId) => {
  const s = await repo.findById(tx, id);
  if (!s) throw new Error('missing');
  return s.toState();
};

/** Đưa hồ sơ tới `UNDER_REVIEW` với cả 4 bước đạt. */
async function readyToDecide(): Promise<KycSubmissionId> {
  const id = await seed();
  unwrap(await new AssignReviewer(deps()).execute({ submissionId: id, actor: reviewer }));
  for (const step of KYC_STEPS) {
    unwrap(
      await new MarkStepPassed(deps()).execute({
        submissionId: id,
        actor: reviewer,
        step,
        outcome: 'PASSED',
      }),
    );
  }
  audit.entries = [];
  repo.events = [];
  return id;
}

beforeEach(() => {
  clock = new FakeClock(T0);
  repo = new InMemoryKycSubmissionRepository();
  uow = new FakeUnitOfWork(repo);
  audit = new RecordingAuditLogger();
  directory = new FakeApplicantDirectory();
  identities = new FakeApplicantProfileReader();
  presigned = [];
});

describe('AssignReviewer', () => {
  it('SUBMITTED → UNDER_REVIEW, gán chính chuyên viên, ghi audit (actor, target, ip)', async () => {
    const id = await seed();
    const r = unwrap(await new AssignReviewer(deps()).execute({ submissionId: id, actor: reviewer }));
    expect(r).toMatchObject({ status: 'UNDER_REVIEW', reviewerId: reviewer.adminId });
    expect((await stored(id)).reviewerId).toBe(reviewer.adminId);
    expect(audit.entries).toEqual([
      {
        actor: { type: 'admin', id: reviewer.adminId },
        action: 'kyc.assign_reviewer',
        targetType: 'kyc_submission',
        targetId: id,
        ip: '203.0.113.7',
        meta: { reviewerId: reviewer.adminId, status: 'UNDER_REVIEW' },
      },
    ]);
  });

  it('hồ sơ không tồn tại → KYC_SUBMISSION_NOT_FOUND, không audit', async () => {
    const r = await new AssignReviewer(deps()).execute({ submissionId: newId(), actor: reviewer });
    expect(r.isErr() && r.error.code).toBe('KYC_SUBMISSION_NOT_FOUND');
    expect(audit.entries).toEqual([]);
  });

  it('audit bị từ chối → throw, thao tác rollback', async () => {
    const id = await seed();
    audit.failWith = 'AUDIT_ENTRY_INVALID';
    await expect(new AssignReviewer(deps()).execute({ submissionId: id, actor: reviewer })).rejects.toThrow(
      /AUDIT_ENTRY_INVALID/,
    );
    expect((await stored(id)).status).toBe('SUBMITTED');
  });
});

describe('MarkStepPassed', () => {
  it('đánh dấu bước đạt / không đạt, audit meta step + outcome', async () => {
    const id = await seed();
    const mark = new MarkStepPassed(deps());
    unwrap(
      await mark.execute({ submissionId: id, actor: reviewer, step: 'MARITAL_STATUS', outcome: 'FAILED' }),
    );
    clock.advance({ minutes: 5 });
    const r = unwrap(
      await mark.execute({ submissionId: id, actor: reviewer, step: 'MARITAL_STATUS', outcome: 'PASSED' }),
    );
    expect(r.steps.find((s) => s.step === 'MARITAL_STATUS')).toEqual({
      step: 'MARITAL_STATUS',
      status: 'PASSED',
      decidedAt: clock.now(),
    });
    expect(audit.entries.map((e) => e.meta)).toEqual([
      { step: 'MARITAL_STATUS', outcome: 'FAILED', status: 'SUBMITTED' },
      { step: 'MARITAL_STATUS', outcome: 'PASSED', status: 'SUBMITTED' },
    ]);
  });

  it('CCCD_CHIP đạt khi chưa có số CCCD → KYC_CCCD_NUMBER_MISSING; không đạt thì vẫn ghi được', async () => {
    const id = await seed({ withCccd: false });
    const mark = new MarkStepPassed(deps());
    const passed = await mark.execute({
      submissionId: id,
      actor: reviewer,
      step: 'CCCD_CHIP',
      outcome: 'PASSED',
    });
    expect(passed.isErr() && passed.error.code).toBe('KYC_CCCD_NUMBER_MISSING');
    expect((await stored(id)).steps.CCCD_CHIP.status).toBe('PENDING');
    expect(audit.entries).toEqual([]);

    const failed = await mark.execute({
      submissionId: id,
      actor: reviewer,
      step: 'CCCD_CHIP',
      outcome: 'FAILED',
    });
    expect(failed.isOk()).toBe(true);
  });

  it('hồ sơ còn nháp → KYC_INVALID_TRANSITION', async () => {
    const id = await seed({ submit: false });
    const r = await new MarkStepPassed(deps()).execute({
      submissionId: id,
      actor: reviewer,
      step: 'MANUAL_REVIEW',
      outcome: 'PASSED',
    });
    expect(r.isErr() && r.error.code).toBe('KYC_INVALID_TRANSITION');
  });

  it('hồ sơ đã quyết định → KYC_ALREADY_DECIDED (kể cả CCCD_CHIP khi thiếu số)', async () => {
    const id = await readyToDecide();
    unwrap(await new ApproveKyc(deps()).execute({ submissionId: id, actor: reviewer }));
    const r = await new MarkStepPassed(deps()).execute({
      submissionId: id,
      actor: reviewer,
      step: 'CCCD_CHIP',
      outcome: 'FAILED',
    });
    expect(r.isErr() && r.error.code).toBe('KYC_ALREADY_DECIDED');
  });
});

describe('ApproveKyc', () => {
  it('đủ 4 bước → APPROVED, KycApproved ghi cùng lần lưu, audit kyc.approve', async () => {
    const id = await readyToDecide();
    const r = unwrap(await new ApproveKyc(deps()).execute({ submissionId: id, actor: reviewer }));
    expect(r).toMatchObject({ status: 'APPROVED', decidedBy: reviewer.adminId, decidedAt: T0 });
    expect(repo.events.map((e) => e.type)).toEqual(['KycApproved']);
    expect(audit.entries.map((e) => [e.action, e.meta])).toEqual([['kyc.approve', { status: 'APPROVED' }]]);
  });

  it('chưa đủ bước → KYC_STEPS_INCOMPLETE, không event, không audit', async () => {
    const id = await seed();
    unwrap(await new AssignReviewer(deps()).execute({ submissionId: id, actor: reviewer }));
    audit.entries = [];
    const r = await new ApproveKyc(deps()).execute({ submissionId: id, actor: reviewer });
    expect(r.isErr() && r.error.code).toBe('KYC_STEPS_INCOMPLETE');
    expect(repo.events).toEqual([]);
    expect(audit.entries).toEqual([]);
  });

  it('chuyên viên thứ hai quyết định sau → KYC_ALREADY_DECIDED (AC2)', async () => {
    const id = await readyToDecide();
    unwrap(await new ApproveKyc(deps()).execute({ submissionId: id, actor: reviewer }));
    const again = await new ApproveKyc(deps()).execute({ submissionId: id, actor: otherReviewer });
    expect(again.isErr() && again.error.code).toBe('KYC_ALREADY_DECIDED');
    const reject = await new RejectKyc(deps()).execute({
      submissionId: id,
      actor: otherReviewer,
      reason: { code: 'FACE_MISMATCH' },
    });
    expect(reject.isErr() && reject.error.code).toBe('KYC_ALREADY_DECIDED');
  });
});

describe('RejectKyc', () => {
  it('lý do hợp lệ → REJECTED, KycRejected mang mã lý do; audit không chứa ghi chú', async () => {
    const id = await seed();
    unwrap(await new AssignReviewer(deps()).execute({ submissionId: id, actor: reviewer }));
    audit.entries = [];
    repo.events = [];
    const r = unwrap(
      await new RejectKyc(deps()).execute({
        submissionId: id,
        actor: reviewer,
        reason: { code: 'OTHER', note: 'Ảnh giấy độc thân bị cắt góc' },
      }),
    );
    expect(r.status).toBe('REJECTED');
    expect((await stored(id)).rejectionReason).toMatchObject({
      code: 'OTHER',
      note: 'Ảnh giấy độc thân bị cắt góc',
    });
    expect(repo.events.map((e) => [e.type, e.payload])).toEqual([
      ['KycRejected', { submissionId: id, userId: (await stored(id)).userId, reasonCode: 'OTHER' }],
    ]);
    expect(audit.entries.map((e) => e.meta)).toEqual([{ reasonCode: 'OTHER', status: 'REJECTED' }]);
  });

  it('lý do không hợp lệ → REJECTION_REASON_REQUIRED, không chạm hồ sơ', async () => {
    const id = await seed();
    const r = await new RejectKyc(deps()).execute({
      submissionId: id,
      actor: reviewer,
      reason: { code: 'OTHER' },
    });
    expect(r.isErr() && r.error.code).toBe('REJECTION_REASON_REQUIRED');
    expect(uow.runs).toBe(0);
  });
});

describe('RequestMoreInfo', () => {
  it('UNDER_REVIEW → NEEDS_MORE_INFO, KycMoreInfoRequested; audit meta items', async () => {
    const id = await seed();
    unwrap(await new AssignReviewer(deps()).execute({ submissionId: id, actor: reviewer }));
    audit.entries = [];
    const r = unwrap(
      await new RequestMoreInfo(deps()).execute({
        submissionId: id,
        actor: reviewer,
        items: ['SELFIE', 'SELFIE', 'CCCD_FRONT'],
        note: 'Chụp lại selfie đủ sáng',
      }),
    );
    expect(r.status).toBe('NEEDS_MORE_INFO');
    expect(repo.events.map((e) => e.type)).toEqual(['KycMoreInfoRequested']);
    expect(audit.entries.map((e) => e.meta)).toEqual([
      { items: ['SELFIE', 'CCCD_FRONT'], status: 'NEEDS_MORE_INFO' },
    ]);
  });

  it('danh sách rỗng → KYC_MORE_INFO_ITEMS_REQUIRED', async () => {
    const id = await seed();
    unwrap(await new AssignReviewer(deps()).execute({ submissionId: id, actor: reviewer }));
    const r = await new RequestMoreInfo(deps()).execute({ submissionId: id, actor: reviewer, items: [] });
    expect(r.isErr() && r.error.code).toBe('KYC_MORE_INFO_ITEMS_REQUIRED');
  });
});

describe('GetKycReviewDetail', () => {
  const detail = () =>
    new GetKycReviewDetail({
      uow,
      submissions: repo,
      auditLogger: audit,
      storage,
      applicantIdentities: identities,
      applicantDirectory: directory,
    });

  it('trả số CCCD đầy đủ, presigned GET 4 ảnh bucket private, thông tin hồ sơ; ghi đúng 1 audit (AC1)', async () => {
    const id = await seed();
    const s = await stored(id);
    identities.identities.set(s.userId, { fullName: 'Nguyễn Văn An', birthDate: '1995-04-12' });
    directory.add({ userId: s.userId, fullName: 'Nguyễn Văn An', occupation: 'Kỹ sư' });

    const v = unwrap(await detail().execute({ submissionId: id, actor: reviewer }));
    expect(v.cccdNumber).toBe(s.cccdNumber?.value);
    expect(v.applicant).toEqual({ fullName: 'Nguyễn Văn An', birthDate: '1995-04-12', occupation: 'Kỹ sư' });
    expect(v.documents.selfie?.url).toBe(`https://storage.test/${s.documents?.selfieKey}`);
    expect(presigned).toHaveLength(4);
    expect(presigned.every((p) => p.startsWith('privateKyc:'))).toBe(true);
    expect(v.flags).toEqual([]);
    expect(audit.entries).toEqual([
      {
        actor: { type: 'admin', id: reviewer.adminId },
        action: 'kyc.view_detail',
        targetType: 'kyc_submission',
        targetId: id,
        ip: '203.0.113.7',
        meta: { status: 'SUBMITTED' },
      },
    ]);

    await detail().execute({ submissionId: id, actor: reviewer });
    expect(audit.entries).toHaveLength(2);
  });

  it('không tồn tại → KYC_SUBMISSION_NOT_FOUND, không audit, không ký URL', async () => {
    const r = await detail().execute({ submissionId: newId(), actor: reviewer });
    expect(r.isErr() && r.error.code).toBe('KYC_SUBMISSION_NOT_FOUND');
    expect(audit.entries).toEqual([]);
    expect(presigned).toEqual([]);
  });

  it('audit bị từ chối → throw, không trả dữ liệu', async () => {
    const id = await seed();
    audit.failWith = 'AUDIT_ENTRY_INVALID';
    await expect(detail().execute({ submissionId: id, actor: reviewer })).rejects.toThrow();
    expect(presigned).toEqual([]);
  });
});

/** Hàng chờ in-memory theo đúng hợp đồng port (lọc + sắp xếp + cursor). */
class InMemoryKycReviewQueue implements KycReviewQueue {
  async search(
    _tx: Tx,
    filter: KycQueueFilter,
    cursor: KycQueueCursor | null,
    limit: number,
  ): Promise<readonly KycQueueRow[]> {
    const key = (r: { submittedAt: Date; id: string }) => `${r.submittedAt.toISOString()}|${r.id}`;
    return [...repo.rows.values()]
      .filter((s) => s.submittedAt !== null && s.status !== 'DRAFT' && filter.statuses.includes(s.status))
      .filter(
        (s) => filter.flagged === undefined || ekycFlags(s.ekycAssessment).length > 0 === filter.flagged,
      )
      .filter((s) => filter.userIds === undefined || filter.userIds.includes(s.userId))
      .map((s): KycQueueRow => ({
        id: s.id,
        userId: s.userId,
        status: s.status,
        steps: s.steps,
        ekycAssessment: s.ekycAssessment,
        reviewerId: s.reviewerId,
        submittedAt: s.submittedAt ?? T0,
        updatedAt: s.updatedAt,
      }))
      .filter((r) => cursor === null || key(r) > key(cursor))
      .sort((a, b) => (key(a) < key(b) ? -1 : 1))
      .slice(0, limit);
  }
}

describe('GetKycReviewQueue', () => {
  const queue = () =>
    new GetKycReviewQueue({ uow, queue: new InMemoryKycReviewQueue(), applicants: directory });

  it('mặc định SUBMITTED + UNDER_REVIEW, chờ lâu nhất trước, kèm tên/nghề và cờ eKYC; phân trang cursor', async () => {
    const newer = await seed({ submittedAt: new Date('2026-11-18T02:00:00.000Z') });
    const older = await seed({
      submittedAt: new Date('2026-11-17T02:00:00.000Z'),
      assessment: { ...CLEAN_ASSESSMENT, profileMismatches: ['FULL_NAME'] },
    });
    await seed({ submit: false });
    const decided = await readyToDecide();
    unwrap(await new ApproveKyc(deps()).execute({ submissionId: decided, actor: reviewer }));
    directory.add({
      userId: (await stored(older)).userId,
      fullName: 'Trần Thị Bình',
      occupation: 'Giáo viên',
    });

    const first = unwrap(await queue().execute({ cursor: null, limit: 1 }));
    expect(first.items.map((i) => i.id)).toEqual([older]);
    expect(first.items[0]).toMatchObject({
      fullName: 'Trần Thị Bình',
      occupation: 'Giáo viên',
      flags: ['FULL_NAME_MISMATCH'],
    });
    expect(first.nextCursor).not.toBeNull();

    const second = unwrap(await queue().execute({ cursor: first.nextCursor, limit: 1 }));
    expect(second.items.map((i) => i.id)).toEqual([newer]);
    expect(second.items[0]?.fullName).toBeNull();
    expect(second.nextCursor).toBeNull();

    const approved = unwrap(await queue().execute({ cursor: null, statuses: ['APPROVED'] }));
    expect(approved.items.map((i) => i.id)).toEqual([decided]);
  });

  it('lọc flagged, tìm theo tên/nghề; không ai khớp → trang rỗng', async () => {
    const clean = await seed();
    const flagged = await seed({ assessment: null });
    directory.add({ userId: (await stored(clean)).userId, fullName: 'Lê Minh', occupation: 'Bác sĩ' });

    const onlyFlagged = unwrap(await queue().execute({ cursor: null, flagged: true }));
    expect(onlyFlagged.items.map((i) => [i.id, i.flags])).toEqual([[flagged, ['EKYC_MISSING']]]);

    const byJob = unwrap(await queue().execute({ cursor: null, text: 'bác' }));
    expect(byJob.items.map((i) => i.id)).toEqual([clean]);

    const none = unwrap(await queue().execute({ cursor: null, text: 'không ai' }));
    expect(none).toEqual({ items: [], nextCursor: null });
  });
});

describe('ekycFlags', () => {
  it('danh mục cờ khớp contracts', () => {
    expect(EKYC_FLAGS).toEqual(KYC_EKYC_FLAGS);
  });

  it('chưa có đánh giá → EKYC_MISSING', () => {
    expect(ekycFlags(null)).toEqual(['EKYC_MISSING']);
  });

  it('đánh giá sạch → không cờ', () => {
    expect(ekycFlags(CLEAN_ASSESSMENT)).toEqual([]);
  });

  it('liệt kê từng thao tác bị từ chối / lỗi và lệch hồ sơ theo thứ tự', () => {
    expect(
      ekycFlags({
        ocr: { status: 'ERROR', reason: 'TIMEOUT' },
        liveness: { status: 'REJECTED', reason: 'LIVENESS_FAILED', score: 0.2 },
        faceMatch: { status: 'REJECTED', reason: 'FACE_MISMATCH', score: 0.3 },
        profileMismatches: ['FULL_NAME', 'BIRTH_DATE'],
        assessedAt: T0,
      }),
    ).toEqual([
      'OCR_ERROR',
      'LIVENESS_REJECTED',
      'FACE_MATCH_REJECTED',
      'FULL_NAME_MISMATCH',
      'BIRTH_DATE_MISMATCH',
    ]);
    expect(ekycFlags({ ...CLEAN_ASSESSMENT, profileMismatches: null })).toEqual(['PROFILE_NOT_COMPARED']);
  });
});
