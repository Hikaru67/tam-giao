import { newId } from '@tamgiao/kernel';
import { describe, expect, it } from 'vitest';
import { compareApplicantIdentity, normalizePersonName } from '../domain/applicant-match.js';
import { KycSubmission, type EkycAssessment, type KycDocuments } from '../domain/kyc-submission.js';
import { RejectionReason } from '../domain/rejection-reason.js';

const t = (h: number) => new Date(Date.UTC(2026, 10, 18, h));
const docs: KycDocuments = {
  cccdFrontKey: 'kyc_doc/u/f.jpg',
  cccdBackKey: 'kyc_doc/u/b.jpg',
  selfieKey: 'kyc_selfie/u/s.jpg',
  maritalStatusCertificateKey: 'kyc_doc/u/m.jpg',
};
const assessment: EkycAssessment = {
  ocr: { status: 'OK', score: null },
  liveness: { status: 'OK', score: 0.9 },
  faceMatch: { status: 'ERROR', reason: 'TIMEOUT' },
  profileMismatches: ['FULL_NAME'],
  assessedAt: t(1),
};
const fresh = () => KycSubmission.start({ id: newId<'KycSubmission'>(), userId: 'u' }, t(0));

describe('KycSubmission.attachDocuments', () => {
  it('attaches documents on a draft without emitting events or bumping version', () => {
    const s = fresh();
    expect(s.attachDocuments(docs, t(1)).isOk()).toBe(true);
    expect(s.documents).toEqual(docs);
    expect(s.version).toBe(0);
    expect(s.pullEvents()).toEqual([]);
    expect(s.toState().updatedAt).toEqual(t(1));
  });

  it('replaces documents when more info is requested', () => {
    const s = fresh();
    s.attachDocuments(docs, t(1));
    s.submit(t(1));
    s.assignReviewer('r', t(2));
    s.requestMoreInfo({ items: ['SELFIE'] }, t(2));
    const next = { ...docs, selfieKey: 'kyc_selfie/u/s2.jpg' };
    expect(s.attachDocuments(next, t(3)).isOk()).toBe(true);
    expect(s.documents).toEqual(next);
  });

  it.each(['SUBMITTED', 'UNDER_REVIEW'] as const)('rejects while %s → KYC_INVALID_TRANSITION', (status) => {
    const s = fresh();
    s.submit(t(1));
    if (status === 'UNDER_REVIEW') s.assignReviewer('r', t(1));
    const r = s.attachDocuments(docs, t(2));
    expect(!r.ok && r.error.code).toBe('KYC_INVALID_TRANSITION');
  });

  it('rejects after a decision → KYC_ALREADY_DECIDED', () => {
    const s = fresh();
    s.submit(t(1));
    s.assignReviewer('r', t(1));
    s.reject(RejectionReason.create({ code: 'NOT_ELIGIBLE' }).unwrapOr(null as never), 'r', t(2));
    const r = s.attachDocuments(docs, t(3));
    expect(!r.ok && r.error.code).toBe('KYC_ALREADY_DECIDED');
  });
});

describe('KycSubmission.recordEkycAssessment', () => {
  it('records the assessment while open (draft or under review) without events', () => {
    const s = fresh();
    expect(s.recordEkycAssessment(assessment, t(1)).isOk()).toBe(true);
    expect(s.toState().ekycAssessment).toEqual(assessment);
    expect(s.pullEvents()).toEqual([]);
    expect(KycSubmission.restore(s.toState()).toState()).toEqual(s.toState());
  });

  it('rejects after a decision → KYC_ALREADY_DECIDED', () => {
    const s = fresh();
    s.submit(t(1));
    s.assignReviewer('r', t(1));
    s.reject(RejectionReason.create({ code: 'NOT_ELIGIBLE' }).unwrapOr(null as never), 'r', t(2));
    const r = s.recordEkycAssessment(assessment, t(3));
    expect(!r.ok && r.error.code).toBe('KYC_ALREADY_DECIDED');
  });
});

describe('applicant identity cross-check', () => {
  it.each([
    ['  Nguyễn   Văn  Ánh ', 'NGUYEN VAN ANH'],
    ['Đặng Thị Hồng Nhung', 'DANG THI HONG NHUNG'],
    ['trần\tquốc  bảo', 'TRAN QUOC BAO'],
  ])('normalizePersonName(%j) = %j', (raw, expected) => {
    expect(normalizePersonName(raw)).toBe(expected);
  });

  it('matches regardless of diacritics, case and spacing', () => {
    expect(
      compareApplicantIdentity(
        { fullName: 'NGUYEN VAN ANH', birthDate: '1995-06-15' },
        { fullName: 'Nguyễn Văn  Ánh', birthDate: '1995-06-15' },
      ),
    ).toEqual([]);
  });

  it('reports each mismatching field', () => {
    expect(
      compareApplicantIdentity(
        { fullName: 'NGUYEN VAN ANH', birthDate: '1995-06-15' },
        { fullName: 'Nguyễn Văn Anh Tuấn', birthDate: '1995-06-16' },
      ),
    ).toEqual(['FULL_NAME', 'BIRTH_DATE']);
  });
});
