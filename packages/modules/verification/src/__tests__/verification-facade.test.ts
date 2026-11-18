import * as contracts from '@tamgiao/contracts';
import { FakeClock, newId } from '@tamgiao/kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import { VERIFICATION_BADGES } from '../application/facade.js';
import { GetVerificationSummary } from '../application/get-verification-summary.js';
import { KYC_STEPS, KycSubmission, type KycStep } from '../domain/kyc-submission.js';
import { RejectionReason } from '../domain/rejection-reason.js';
import { FakeUnitOfWork, InMemoryKycSubmissionRepository } from './fakes.js';

const clock = new FakeClock(new Date('2026-11-18T01:00:00.000Z'));
const REVIEWER = newId<'Admin'>();
let repo: InMemoryKycSubmissionRepository;
let facade: GetVerificationSummary;

beforeEach(() => {
  repo = new InMemoryKycSubmissionRepository();
  facade = new GetVerificationSummary({ uow: new FakeUnitOfWork(repo), submissions: repo });
});

function must(r: { isErr(): boolean }): void {
  if (r.isErr()) throw new Error('unexpected Err');
}

/** Hồ sơ đi tới trạng thái mong muốn qua đúng luật domain, với các bước `passed` đã đạt. */
async function seed(
  target: 'DRAFT' | 'SUBMITTED' | 'UNDER_REVIEW' | 'NEEDS_MORE_INFO' | 'APPROVED' | 'REJECTED',
  passed: readonly KycStep[] = [],
): Promise<string> {
  const userId = newId<'User'>();
  const now = clock.now();
  const s = KycSubmission.start({ id: newId<'KycSubmission'>(), userId }, now);
  for (const step of passed) must(s.markStep(step, 'PASSED', now));
  if (target !== 'DRAFT') must(s.submit(now));
  if (target !== 'DRAFT' && target !== 'SUBMITTED') must(s.assignReviewer(REVIEWER, now));
  if (target === 'NEEDS_MORE_INFO') must(s.requestMoreInfo({ items: ['SELFIE'] }, now));
  if (target === 'APPROVED') must(s.approve(REVIEWER, now));
  if (target === 'REJECTED') {
    const reason = RejectionReason.create({ code: 'FACE_MISMATCH' });
    if (reason.isErr()) throw new Error(reason.error.code);
    must(s.reject(reason.value, REVIEWER, now));
  }
  must(await repo.save({} as never, s));
  return userId;
}

describe('VerificationFacade', () => {
  it('approved user → isVerified=true, status APPROVED, all badges (AC1)', async () => {
    const userId = await seed('APPROVED', KYC_STEPS);
    expect(await facade.isVerified(userId)).toBe(true);
    expect(await facade.getSummary(userId)).toEqual({
      status: 'APPROVED',
      badges: ['CCCD_VERIFIED', 'SINGLE_VERIFIED', 'INTERVIEWED'],
    });
    expect(await facade.getBadges(userId)).toEqual(['CCCD_VERIFIED', 'SINGLE_VERIFIED', 'INTERVIEWED']);
  });

  it('no submission → NOT_SUBMITTED, not verified, no badges', async () => {
    const userId = newId<'User'>();
    expect(await facade.getSummary(userId)).toEqual({ status: 'NOT_SUBMITTED', badges: [] });
    expect(await facade.isVerified(userId)).toBe(false);
  });

  it.each([
    ['DRAFT', 'NOT_SUBMITTED'],
    ['SUBMITTED', 'IN_PROGRESS'],
    ['UNDER_REVIEW', 'IN_PROGRESS'],
    ['NEEDS_MORE_INFO', 'IN_PROGRESS'],
    ['REJECTED', 'REJECTED'],
  ] as const)('%s submission → %s and not verified', async (target, status) => {
    const userId = await seed(target);
    expect((await facade.getSummary(userId)).status).toBe(status);
    expect(await facade.isVerified(userId)).toBe(false);
  });

  it.each([
    [['CCCD_CHIP'], ['CCCD_VERIFIED']],
    [['MARITAL_STATUS'], ['SINGLE_VERIFIED']],
    [['INTERVIEW'], ['INTERVIEWED']],
    [['MANUAL_REVIEW'], []],
    [
      ['INTERVIEW', 'CCCD_CHIP'],
      ['CCCD_VERIFIED', 'INTERVIEWED'],
    ],
  ] as const)('badges follow passed steps while under review: %j → %j', async (passed, badges) => {
    const userId = await seed('UNDER_REVIEW', passed);
    expect(await facade.getBadges(userId)).toEqual(badges);
    expect(await facade.isVerified(userId)).toBe(false);
  });

  it('failed step gives no badge', async () => {
    const userId = await seed('UNDER_REVIEW', ['MARITAL_STATUS']);
    const s = await repo.findByUserId({} as never, userId);
    if (!s) throw new Error('missing');
    must(s.markStep('CCCD_CHIP', 'FAILED', clock.now()));
    must(await repo.save({} as never, s));
    expect(await facade.getBadges(userId)).toEqual(['SINGLE_VERIFIED']);
  });

  it('rejected submission hides badges even for passed steps', async () => {
    const userId = await seed('REJECTED', ['CCCD_CHIP', 'MARITAL_STATUS']);
    expect(await facade.getSummary(userId)).toEqual({ status: 'REJECTED', badges: [] });
  });

  it('badges match the published contract', () => {
    expect(VERIFICATION_BADGES).toEqual(contracts.VERIFICATION_BADGES);
  });
});
