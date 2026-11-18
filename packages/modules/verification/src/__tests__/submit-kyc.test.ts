import { FakeClock, newId, type Tx } from '@tamgiao/kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import { GetMyKyc } from '../application/get-my-kyc.js';
import type { EkycProvider } from '../application/ports/ekyc-provider.js';
import { SubmitKyc, type SubmitKycDocumentsInput } from '../application/submit-kyc.js';
import { CccdNumber } from '../domain/cccd-number.js';
import { KycSubmission } from '../domain/kyc-submission.js';
import { RejectionReason } from '../domain/rejection-reason.js';
import { FAKE_EKYC_ID_CARD, FakeEkycProvider } from '../infrastructure/ekyc/fake-ekyc-provider.js';
import { ResilientEkycProvider } from '../infrastructure/ekyc/resilient-ekyc-provider.js';
import {
  FakeApplicantProfileReader,
  FakeUnitOfWork,
  FakeUploadRegistry,
  InMemoryKycSubmissionRepository,
} from './fakes.js';

const T0 = new Date('2026-11-18T03:00:00.000Z');
const tx = {} as Tx;

let clock: FakeClock;
let repo: InMemoryKycSubmissionRepository;
let uow: FakeUnitOfWork;
let uploads: FakeUploadRegistry;
let applicants: FakeApplicantProfileReader;
let provider: FakeEkycProvider;

const userA = newId<'User'>();
const userB = newId<'User'>();

function docsFor(userId: string, suffix = '1'): Required<{ [K in keyof SubmitKycDocumentsInput]: string }> {
  const docs = {
    cccdFrontKey: `kyc_doc/${userId}/front-${suffix}.jpg`,
    cccdBackKey: `kyc_doc/${userId}/back-${suffix}.jpg`,
    selfieKey: `kyc_selfie/${userId}/selfie-${suffix}.jpg`,
    maritalStatusCertificateKey: `kyc_doc/${userId}/marital-${suffix}.jpg`,
  };
  uploads.grant(userId, docs.cccdFrontKey, 'kyc_doc');
  uploads.grant(userId, docs.cccdBackKey, 'kyc_doc');
  uploads.grant(userId, docs.selfieKey, 'kyc_selfie');
  uploads.grant(userId, docs.maritalStatusCertificateKey, 'kyc_doc');
  return docs;
}

function useCase(ekyc: EkycProvider = provider): SubmitKyc {
  return new SubmitKyc({ uow, clock, submissions: repo, uploads, ekyc, applicants });
}

async function stored(userId: string) {
  const s = await repo.findByUserId(tx, userId);
  if (!s) throw new Error('submission not stored');
  return s.toState();
}

beforeEach(() => {
  clock = new FakeClock(T0);
  repo = new InMemoryKycSubmissionRepository();
  uow = new FakeUnitOfWork(repo);
  uploads = new FakeUploadRegistry();
  applicants = new FakeApplicantProfileReader();
  provider = new FakeEkycProvider();
  applicants.identities.set(userA, { fullName: 'Nguyễn  Văn A', birthDate: FAKE_EKYC_ID_CARD.dateOfBirth });
});

describe('SubmitKyc — success', () => {
  it('stores documents, CCCD number and eKYC hints; submits and emits KycSubmitted', async () => {
    const docs = docsFor(userA);
    const result = await useCase().execute({ userId: userA, documents: docs });

    expect(result.isOk() && result.value.status).toBe('SUBMITTED');
    const s = await stored(userA);
    expect(s.status).toBe('SUBMITTED');
    expect(s.submittedAt).toEqual(T0);
    expect(s.documents).toEqual(docs);
    expect(s.cccdNumber?.value).toBe(FAKE_EKYC_ID_CARD.cccdNumber);
    expect(s.ekycAssessment).toEqual({
      ocr: { status: 'OK', score: null },
      liveness: { status: 'OK', score: 0.98 },
      faceMatch: { status: 'OK', score: 0.95 },
      profileMismatches: [],
      assessedAt: T0,
    });
    expect(repo.events.map((e) => [e.type, e.payload])).toEqual([
      ['KycSubmitted', { submissionId: s.id, userId: userA, resubmission: false }],
    ]);
    expect(JSON.stringify(repo.events)).not.toContain(FAKE_EKYC_ID_CARD.cccdNumber);
  });

  it('eKYC success is only a hint: no step is marked PASSED automatically', async () => {
    await useCase().execute({ userId: userA, documents: docsFor(userA) });
    const s = await stored(userA);
    expect(Object.values(s.steps).map((st) => st.status)).toEqual([
      'PENDING',
      'PENDING',
      'PENDING',
      'PENDING',
    ]);
  });

  it('calls eKYC with the uploaded keys (front+back OCR, selfie liveness, front↔selfie face match)', async () => {
    const docs = docsFor(userA);
    await useCase().execute({ userId: userA, documents: docs });
    expect([...provider.calls].sort((a, b) => a.operation.localeCompare(b.operation))).toEqual([
      { operation: 'checkLiveness', keys: [docs.selfieKey] },
      { operation: 'matchFace', keys: [docs.cccdFrontKey, docs.selfieKey] },
      { operation: 'ocrIdCard', keys: [docs.cccdFrontKey, docs.cccdBackKey] },
    ]);
  });
});

describe('SubmitKyc — profile cross-check (flag only, never blocks)', () => {
  it('flags FULL_NAME and BIRTH_DATE mismatches', async () => {
    applicants.identities.set(userA, { fullName: 'Trần Thị B', birthDate: '1990-01-01' });
    const result = await useCase().execute({ userId: userA, documents: docsFor(userA) });
    expect(result.isOk()).toBe(true);
    expect((await stored(userA)).ekycAssessment?.profileMismatches).toEqual(['FULL_NAME', 'BIRTH_DATE']);
  });

  it('profileMismatches = null when the profile has no name/birth date', async () => {
    applicants.identities.delete(userA);
    await useCase().execute({ userId: userA, documents: docsFor(userA) });
    expect((await stored(userA)).ekycAssessment?.profileMismatches).toBeNull();
  });
});

describe('SubmitKyc — eKYC rejections and infrastructure errors still submit (manual review)', () => {
  it('provider timeout → submitted, every check ERROR/TIMEOUT, no CCCD number', async () => {
    provider.setScenario('TIMEOUT');
    const result = await useCase().execute({ userId: userA, documents: docsFor(userA) });
    expect(result.isOk() && result.value.status).toBe('SUBMITTED');
    const s = await stored(userA);
    expect(s.cccdNumber).toBeNull();
    expect(s.ekycAssessment).toMatchObject({
      ocr: { status: 'ERROR', reason: 'TIMEOUT' },
      liveness: { status: 'ERROR', reason: 'TIMEOUT' },
      faceMatch: { status: 'ERROR', reason: 'TIMEOUT' },
      profileMismatches: null,
    });
  });

  it('timeout after retries through ResilientEkycProvider → still submitted', async () => {
    provider.setScenario('UNAVAILABLE');
    const resilient = new ResilientEkycProvider(provider, { timeoutMs: 1_000, maxAttempts: 2 });
    const result = await useCase(resilient).execute({ userId: userA, documents: docsFor(userA) });
    expect(result.isOk()).toBe(true);
    expect(provider.calls).toHaveLength(6);
    expect((await stored(userA)).ekycAssessment?.ocr).toEqual({ status: 'ERROR', reason: 'UNAVAILABLE' });
  });

  it('blurry images → submitted with IMAGE_BLURRY hints (reviewer may request a retake)', async () => {
    provider.setScenario('BLURRY');
    const result = await useCase().execute({ userId: userA, documents: docsFor(userA) });
    expect(result.isOk()).toBe(true);
    const s = await stored(userA);
    expect(s.cccdNumber).toBeNull();
    expect(s.ekycAssessment).toMatchObject({
      ocr: { status: 'REJECTED', reason: 'IMAGE_BLURRY', score: null },
      liveness: { status: 'REJECTED', reason: 'IMAGE_BLURRY' },
      faceMatch: { status: 'REJECTED', reason: 'IMAGE_BLURRY' },
    });
  });

  it('face mismatch → submitted, faceMatch REJECTED with score, CCCD still recorded', async () => {
    provider.setScenario('MISMATCH');
    await useCase().execute({ userId: userA, documents: docsFor(userA) });
    const s = await stored(userA);
    expect(s.ekycAssessment?.faceMatch).toEqual({ status: 'REJECTED', reason: 'FACE_MISMATCH', score: 0.12 });
    expect(s.cccdNumber?.value).toBe(FAKE_EKYC_ID_CARD.cccdNumber);
  });

  it('OCR number that is not a valid CCCD → DOCUMENT_UNREADABLE hint, no number, name still cross-checked', async () => {
    provider = new FakeEkycProvider({ idCard: { ...FAKE_EKYC_ID_CARD, cccdNumber: '999000000001' } });
    await useCase().execute({ userId: userA, documents: docsFor(userA) });
    const s = await stored(userA);
    expect(s.cccdNumber).toBeNull();
    expect(s.ekycAssessment?.ocr).toEqual({ status: 'REJECTED', reason: 'DOCUMENT_UNREADABLE', score: null });
    expect(s.ekycAssessment?.profileMismatches).toEqual([]);
  });

  it('a non-classified error from the provider is a programming error and propagates', async () => {
    const broken: EkycProvider = {
      ocrIdCard: () => Promise.reject(new TypeError('bug')),
      checkLiveness: (s) => provider.checkLiveness(s),
      matchFace: (a, b) => provider.matchFace(a, b),
    };
    await expect(useCase(broken).execute({ userId: userA, documents: docsFor(userA) })).rejects.toThrow(
      'bug',
    );
    expect(repo.rows.size).toBe(0);
  });
});

describe('SubmitKyc — validation', () => {
  it('missing documents → KYC_DOCS_MISSING listing the fields, provider not called', async () => {
    const result = await useCase().execute({
      userId: userA,
      documents: { cccdFrontKey: 'kyc_doc/x/1.jpg', selfieKey: '  ', cccdBackKey: null },
    });
    expect(!result.ok && result.error).toEqual({
      code: 'KYC_DOCS_MISSING',
      details: { missing: ['cccdBackKey', 'selfieKey', 'maritalStatusCertificateKey'] },
    });
    expect(provider.calls).toHaveLength(0);
  });

  it('same key used for two documents → UPLOAD_INVALID', async () => {
    const docs = docsFor(userA);
    const result = await useCase().execute({
      userId: userA,
      documents: { ...docs, cccdBackKey: docs.cccdFrontKey },
    });
    expect(!result.ok && result.error).toEqual({
      code: 'UPLOAD_INVALID',
      details: { reason: 'DUPLICATE_KEY' },
    });
  });

  it("another user's key → UPLOAD_NOT_OWNED with the field, nothing stored, provider not called", async () => {
    const docsOfB = docsFor(userB);
    const result = await useCase().execute({
      userId: userA,
      documents: { ...docsFor(userA), selfieKey: docsOfB.selfieKey },
    });
    expect(!result.ok && result.error).toEqual({ code: 'UPLOAD_NOT_OWNED', details: { field: 'selfieKey' } });
    expect(repo.rows.size).toBe(0);
    expect(provider.calls).toHaveLength(0);
  });

  it('upload with the wrong purpose (selfie uploaded as kyc_doc) → UPLOAD_INVALID', async () => {
    const docs = docsFor(userA);
    uploads.grant(userA, 'kyc_doc/a/selfie-as-doc.jpg', 'kyc_doc');
    const result = await useCase().execute({
      userId: userA,
      documents: { ...docs, selfieKey: 'kyc_doc/a/selfie-as-doc.jpg' },
    });
    expect(!result.ok && result.error).toEqual({
      code: 'UPLOAD_INVALID',
      details: { reason: 'WRONG_PURPOSE', field: 'selfieKey' },
    });
  });
});

describe('SubmitKyc — one submission per user, one CCCD per account', () => {
  it('second submission while SUBMITTED → KYC_ALREADY_SUBMITTED', async () => {
    await useCase().execute({ userId: userA, documents: docsFor(userA) });
    const again = await useCase().execute({ userId: userA, documents: docsFor(userA, '2') });
    expect(!again.ok && again.error).toEqual({
      code: 'KYC_ALREADY_SUBMITTED',
      details: { status: 'SUBMITTED' },
    });
  });

  it('REJECTED submission cannot be submitted again → KYC_ALREADY_SUBMITTED', async () => {
    await useCase().execute({ userId: userA, documents: docsFor(userA) });
    const s = KycSubmission.restore(await stored(userA));
    s.assignReviewer('reviewer-1', T0);
    const reason = RejectionReason.create({ code: 'NOT_ELIGIBLE' });
    if (reason.isErr()) throw new Error('reason');
    s.reject(reason.value, 'reviewer-1', T0);
    await repo.save(tx, s);

    const again = await useCase().execute({ userId: userA, documents: docsFor(userA, '2') });
    expect(!again.ok && again.error).toEqual({
      code: 'KYC_ALREADY_SUBMITTED',
      details: { status: 'REJECTED' },
    });
  });

  it('NEEDS_MORE_INFO → resubmission replaces documents, back to UNDER_REVIEW, KycSubmitted(resubmission)', async () => {
    await useCase().execute({ userId: userA, documents: docsFor(userA) });
    const s = KycSubmission.restore(await stored(userA));
    s.assignReviewer('reviewer-1', T0);
    s.requestMoreInfo({ items: ['SELFIE'] }, T0);
    await repo.save(tx, s);
    repo.events = [];

    clock.advance({ hours: 1 });
    const docs2 = docsFor(userA, '2');
    const result = await useCase().execute({ userId: userA, documents: docs2 });

    expect(result.isOk() && result.value.status).toBe('UNDER_REVIEW');
    const after = await stored(userA);
    expect(after.id).toBe(s.id);
    expect(after.documents).toEqual(docs2);
    expect(after.moreInfoRequest).toBeNull();
    expect(after.ekycAssessment?.assessedAt).toEqual(clock.now());
    expect(repo.events.map((e) => e.payload)).toEqual([
      { submissionId: s.id, userId: userA, resubmission: true },
    ]);
  });

  it('CCCD already registered by another account → CCCD_ALREADY_REGISTERED, nothing stored', async () => {
    applicants.identities.set(userB, { fullName: 'NGUYEN VAN A', birthDate: FAKE_EKYC_ID_CARD.dateOfBirth });
    expect((await useCase().execute({ userId: userA, documents: docsFor(userA) })).isOk()).toBe(true);
    const result = await useCase().execute({ userId: userB, documents: docsFor(userB) });
    expect(!result.ok && result.error.code).toBe('CCCD_ALREADY_REGISTERED');
    expect(await repo.findByUserId(tx, userB)).toBeNull();
    expect(repo.events).toHaveLength(1);
  });

  it('a concurrent submission of the same user between precheck and save → KYC_ALREADY_SUBMITTED', async () => {
    const racing: EkycProvider = {
      ocrIdCard: async (f, b) => {
        // Lần nộp khác của cùng người dùng hoàn tất trong lúc lần này đang chờ eKYC.
        const other = KycSubmission.start({ id: newId<'KycSubmission'>(), userId: userA }, T0);
        other.submit(T0);
        await repo.save(tx, other);
        return provider.ocrIdCard(f, b);
      },
      checkLiveness: (s) => provider.checkLiveness(s),
      matchFace: (a, b) => provider.matchFace(a, b),
    };
    const result = await useCase(racing).execute({ userId: userA, documents: docsFor(userA) });
    expect(!result.ok && result.error.code).toBe('KYC_ALREADY_SUBMITTED');
  });
});

describe('GetMyKyc', () => {
  const getMyKyc = () => new GetMyKyc({ uow, submissions: repo });

  it('NOT_SUBMITTED with 4 PENDING steps in display order before any submission', async () => {
    expect(await getMyKyc().execute(userA)).toEqual({
      status: 'NOT_SUBMITTED',
      submittedAt: null,
      decidedAt: null,
      steps: [
        { step: 'CCCD_CHIP', status: 'PENDING', decidedAt: null },
        { step: 'MARITAL_STATUS', status: 'PENDING', decidedAt: null },
        { step: 'MANUAL_REVIEW', status: 'PENDING', decidedAt: null },
        { step: 'INTERVIEW', status: 'PENDING', decidedAt: null },
      ],
      moreInfo: null,
      rejectionReason: null,
    });
  });

  it('shows step statuses, more-info items and never the CCCD number', async () => {
    await useCase().execute({ userId: userA, documents: docsFor(userA) });
    const s = KycSubmission.restore(await stored(userA));
    s.assignReviewer('reviewer-1', T0);
    s.markStep('CCCD_CHIP', 'PASSED', T0);
    s.requestMoreInfo({ items: ['MARITAL_STATUS_CERTIFICATE'], note: 'Ảnh giấy xác nhận bị mờ' }, T0);
    await repo.save(tx, s);

    const view = await getMyKyc().execute(userA);
    expect(view.status).toBe('NEEDS_MORE_INFO');
    expect(view.steps.map((st) => [st.step, st.status])).toEqual([
      ['CCCD_CHIP', 'PASSED'],
      ['MARITAL_STATUS', 'PENDING'],
      ['MANUAL_REVIEW', 'PENDING'],
      ['INTERVIEW', 'PENDING'],
    ]);
    expect(view.moreInfo).toEqual({ items: ['MARITAL_STATUS_CERTIFICATE'], note: 'Ảnh giấy xác nhận bị mờ' });
    expect(JSON.stringify(view)).not.toContain(FAKE_EKYC_ID_CARD.cccdNumber);
  });

  it('REJECTED exposes only the reason code', async () => {
    const s = KycSubmission.start({ id: newId<'KycSubmission'>(), userId: userA }, T0);
    s.recordCccdNumber(CccdNumber.parse('001099000002').unwrapOr(null as never), T0);
    s.submit(T0);
    s.assignReviewer('r', T0);
    const reason = RejectionReason.create({ code: 'OTHER', note: 'ghi chú nội bộ' });
    if (reason.isErr()) throw new Error('reason');
    s.reject(reason.value, 'r', T0);
    await repo.save(tx, s);
    const view = await getMyKyc().execute(userA);
    expect(view).toMatchObject({ status: 'REJECTED', rejectionReason: 'OTHER', decidedAt: T0 });
    expect(JSON.stringify(view)).not.toContain('ghi chú nội bộ');
  });
});
