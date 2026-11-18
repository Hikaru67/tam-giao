import { INTERVIEW_ERROR_CODES, errorRegistry } from '@tamgiao/contracts';
import { FakeClock, addDuration, newId, type DomainError, type Result } from '@tamgiao/kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import { BookInterview } from '../application/interview/book-interview.js';
import { CancelInterview } from '../application/interview/cancel-interview.js';
import {
  GetMyInterview,
  ListAvailableInterviewSlots,
  ListInterviewSlots,
} from '../application/interview/interview-queries.js';
import { OpenInterviewSlot } from '../application/interview/open-interview-slot.js';
import { RecordInterviewResult } from '../application/interview/record-interview-result.js';
import { RescheduleInterview } from '../application/interview/reschedule-interview.js';
import { INTERVIEW_ERRORS } from '../domain/errors.js';
import { KycSubmission } from '../domain/kyc-submission.js';
import { RejectionReason } from '../domain/rejection-reason.js';
import { InMemoryKycSubmissionRepository } from './fakes.js';
import { InMemoryInterviewSlotRepository, InterviewFakeUnitOfWork } from './interview-fakes.js';

const T0 = new Date('2026-11-18T01:00:00.000Z');
const ADMIN = newId<'Admin'>();
const code = (r: Result<unknown, DomainError>) => (r.isErr() ? r.error.code : null);

let clock: FakeClock;
let slots: InMemoryInterviewSlotRepository;
let submissions: InMemoryKycSubmissionRepository;
let uc: {
  open: OpenInterviewSlot;
  book: BookInterview;
  cancel: CancelInterview;
  reschedule: RescheduleInterview;
  record: RecordInterviewResult;
  available: ListAvailableInterviewSlots;
  mine: GetMyInterview;
  list: ListInterviewSlots;
};

beforeEach(() => {
  clock = new FakeClock(T0);
  slots = new InMemoryInterviewSlotRepository();
  submissions = new InMemoryKycSubmissionRepository();
  const uow = new InterviewFakeUnitOfWork(slots, submissions);
  const deps = { uow, clock, slots, submissions };
  uc = {
    open: new OpenInterviewSlot(deps),
    book: new BookInterview(deps),
    cancel: new CancelInterview(deps),
    reschedule: new RescheduleInterview(deps),
    record: new RecordInterviewResult(deps),
    available: new ListAvailableInterviewSlots(deps),
    mine: new GetMyInterview(deps),
    list: new ListInterviewSlots(deps),
  };
});

/** Người dùng có hồ sơ đã nộp (`SUBMITTED`); `mutate` để đưa hồ sơ sang trạng thái khác. */
function userWithSubmission(mutate?: (s: KycSubmission) => void): string {
  const userId = newId<'User'>();
  const s = KycSubmission.start({ id: newId<'KycSubmission'>(), userId }, T0);
  s.attachDocuments(
    { cccdFrontKey: 'f', cccdBackKey: 'b', selfieKey: 's', maritalStatusCertificateKey: 'm' },
    T0,
  );
  s.submit(T0);
  mutate?.(s);
  s.pullEvents();
  submissions.rows.set(s.id, s.toState());
  return userId;
}

async function openAt(hoursFromNow: number, interviewerId: string = ADMIN): Promise<string> {
  const r = await uc.open.execute({
    interviewerId,
    startsAt: addDuration(clock.now(), { hours: hoursFromNow }),
    meetingUrl: 'https://meet.test/x',
  });
  if (r.isErr()) throw new Error(r.error.code);
  return r.value.id;
}

describe('interview error codes', () => {
  it.each(INTERVIEW_ERRORS)('%s registered in contracts', (c) => {
    expect(errorRegistry.get(c)).toBeDefined();
  });
  it('domain list matches contracts registration', () => {
    expect([...INTERVIEW_ERRORS].sort()).toEqual([...INTERVIEW_ERROR_CODES].sort());
  });
});

describe('OpenInterviewSlot', () => {
  it('rejects overlapping slots of the same interviewer, allows other interviewers', async () => {
    await openAt(24);
    const overlap = await uc.open.execute({
      interviewerId: ADMIN,
      startsAt: addDuration(clock.now(), { hours: 24, minutes: 10 }),
    });
    expect(code(overlap)).toBe('INTERVIEW_SLOT_OVERLAP');
    const adjacent = await uc.open.execute({
      interviewerId: ADMIN,
      startsAt: addDuration(clock.now(), { hours: 24, minutes: 15 }),
    });
    expect(adjacent.isOk()).toBe(true);
    await expect(openAt(24, newId<'Admin'>())).resolves.toBeTypeOf('string');
  });

  it('rejects a slot in the past', async () => {
    expect(code(await uc.open.execute({ interviewerId: ADMIN, startsAt: T0 }))).toBe(
      'INTERVIEW_SLOT_IN_PAST',
    );
  });
});

describe('BookInterview', () => {
  it('books an open slot; it disappears from available slots and shows in GetMyInterview', async () => {
    const user = userWithSubmission();
    const slotId = await openAt(24);
    const other = await openAt(48);
    const r = await uc.book.execute({ userId: user, slotId });
    expect(r.isOk() && r.value).toMatchObject({ slotId, meetingUrl: 'https://meet.test/x', canChange: true });
    expect((await uc.available.execute({ limit: 10 })).map((s) => s.id)).toEqual([other]);
    expect((await uc.mine.execute(user))?.slotId).toBe(slotId);
  });

  it('slot booked by someone else → SLOT_TAKEN', async () => {
    const slotId = await openAt(24);
    expect((await uc.book.execute({ userId: userWithSubmission(), slotId })).isOk()).toBe(true);
    expect(code(await uc.book.execute({ userId: userWithSubmission(), slotId }))).toBe('SLOT_TAKEN');
  });

  it('a user may hold only one active booking', async () => {
    const user = userWithSubmission();
    await uc.book.execute({ userId: user, slotId: await openAt(24) });
    expect(code(await uc.book.execute({ userId: user, slotId: await openAt(48) }))).toBe(
      'INTERVIEW_ALREADY_BOOKED',
    );
  });

  it('requires a submitted, undecided KYC submission', async () => {
    const slotId = await openAt(24);
    const none = await uc.book.execute({ userId: newId<'User'>(), slotId });
    expect(none.isErr() && none.error).toEqual({
      code: 'INTERVIEW_REQUIRES_SUBMISSION',
      details: { status: 'NOT_SUBMITTED' },
    });
    const rejected = userWithSubmission((s) => {
      s.assignReviewer(ADMIN, T0);
      s.reject(RejectionReason.create({ code: 'FACE_MISMATCH' }).unwrapOr(null as never), ADMIN, T0);
    });
    expect(code(await uc.book.execute({ userId: rejected, slotId }))).toBe('INTERVIEW_REQUIRES_SUBMISSION');
  });

  it('interview step already passed → INTERVIEW_ALREADY_PASSED; failed → may book again', async () => {
    const slotId = await openAt(24);
    const passed = userWithSubmission((s) => s.markStep('INTERVIEW', 'PASSED', T0));
    expect(code(await uc.book.execute({ userId: passed, slotId }))).toBe('INTERVIEW_ALREADY_PASSED');
    const failed = userWithSubmission((s) => s.markStep('INTERVIEW', 'FAILED', T0));
    expect((await uc.book.execute({ userId: failed, slotId })).isOk()).toBe(true);
  });

  it('unknown slot → INTERVIEW_SLOT_NOT_FOUND; malformed id → INVALID_ID', async () => {
    const user = userWithSubmission();
    expect(code(await uc.book.execute({ userId: user, slotId: newId() }))).toBe('INTERVIEW_SLOT_NOT_FOUND');
    expect(code(await uc.book.execute({ userId: user, slotId: 'nope' }))).toBe('INVALID_ID');
  });
});

describe('CancelInterview (2h rule)', () => {
  it('cancel exactly 2h before start → slot is open again', async () => {
    const user = userWithSubmission();
    const slotId = await openAt(24);
    await uc.book.execute({ userId: user, slotId });
    clock.advance({ hours: 22 });
    expect((await uc.cancel.execute({ userId: user })).isOk()).toBe(true);
    expect(await uc.mine.execute(user)).toBeNull();
    expect((await uc.available.execute({ limit: 10 })).map((s) => s.id)).toEqual([slotId]);
  });

  it('less than 2h before start → CANCEL_TOO_LATE, booking kept', async () => {
    const user = userWithSubmission();
    const slotId = await openAt(24);
    await uc.book.execute({ userId: user, slotId });
    clock.advance({ hours: 22, seconds: 1 });
    expect(code(await uc.cancel.execute({ userId: user }))).toBe('CANCEL_TOO_LATE');
    expect((await uc.mine.execute(user))?.canChange).toBe(false);
  });

  it('nothing booked → INTERVIEW_NOT_BOOKED', async () => {
    expect(code(await uc.cancel.execute({ userId: newId<'User'>() }))).toBe('INTERVIEW_NOT_BOOKED');
  });
});

describe('RescheduleInterview', () => {
  it('moves the booking to another slot atomically', async () => {
    const user = userWithSubmission();
    const first = await openAt(24);
    const second = await openAt(48);
    await uc.book.execute({ userId: user, slotId: first });
    const r = await uc.reschedule.execute({ userId: user, slotId: second });
    expect(r.isOk() && r.value.slotId).toBe(second);
    expect((await uc.available.execute({ limit: 10 })).map((s) => s.id)).toEqual([first]);
  });

  it('target taken → SLOT_TAKEN and the old booking is kept (rollback)', async () => {
    const user = userWithSubmission();
    const first = await openAt(24);
    const second = await openAt(48);
    await uc.book.execute({ userId: user, slotId: first });
    await uc.book.execute({ userId: userWithSubmission(), slotId: second });
    expect(code(await uc.reschedule.execute({ userId: user, slotId: second }))).toBe('SLOT_TAKEN');
    expect((await uc.mine.execute(user))?.slotId).toBe(first);
  });

  it('within 2h of the current slot → CANCEL_TOO_LATE', async () => {
    const user = userWithSubmission();
    const first = await openAt(3);
    const second = await openAt(48);
    await uc.book.execute({ userId: user, slotId: first });
    clock.advance({ hours: 1, minutes: 1 });
    expect(code(await uc.reschedule.execute({ userId: user, slotId: second }))).toBe('CANCEL_TOO_LATE');
    expect((await uc.mine.execute(user))?.slotId).toBe(first);
  });

  it('no booking → INTERVIEW_NOT_BOOKED; same slot → no-op', async () => {
    const user = userWithSubmission();
    const first = await openAt(24);
    expect(code(await uc.reschedule.execute({ userId: user, slotId: first }))).toBe('INTERVIEW_NOT_BOOKED');
    await uc.book.execute({ userId: user, slotId: first });
    expect((await uc.reschedule.execute({ userId: user, slotId: first })).isOk()).toBe(true);
  });
});

describe('RecordInterviewResult (AC2)', () => {
  async function bookedInterview(mutate?: (s: KycSubmission) => void) {
    const user = userWithSubmission(mutate);
    const slotId = await openAt(24);
    await uc.book.execute({ userId: user, slotId });
    return { user, slotId };
  }

  it('records notes + outcome and marks the INTERVIEW step of the submission', async () => {
    const { user, slotId } = await bookedInterview();
    clock.advance({ hours: 24, minutes: 15 });
    const r = await uc.record.execute({ slotId, reviewerId: ADMIN, outcome: 'PASSED', notes: 'Thái độ tốt' });
    expect(r.isOk() && r.value).toMatchObject({
      status: 'COMPLETED',
      outcome: 'PASSED',
      notes: 'Thái độ tốt',
    });
    const sub = await submissions.findByUserId({} as never, user);
    expect(sub?.steps.INTERVIEW).toEqual({ status: 'PASSED', decidedAt: clock.now() });
    expect(submissions.events).toEqual([]);
    const journal = await uc.list.execute({ status: 'COMPLETED', limit: 10 });
    expect(journal.map((s) => s.id)).toEqual([slotId]);
  });

  it('FAILED outcome marks the step FAILED', async () => {
    const { user, slotId } = await bookedInterview();
    clock.advance({ hours: 25 });
    await uc.record.execute({ slotId, reviewerId: ADMIN, outcome: 'FAILED', notes: 'x' });
    expect((await submissions.findByUserId({} as never, user))?.steps.INTERVIEW.status).toBe('FAILED');
  });

  it('decided submission → KYC_ALREADY_DECIDED and the slot stays BOOKED (rollback)', async () => {
    const { user, slotId } = await bookedInterview();
    const state = [...submissions.rows.values()].find((s) => s.userId === user);
    const s = KycSubmission.restore(state as never);
    s.assignReviewer(ADMIN, T0);
    s.reject(RejectionReason.create({ code: 'FACE_MISMATCH' }).unwrapOr(null as never), ADMIN, T0);
    submissions.rows.set(s.id, s.toState());
    clock.advance({ hours: 25 });
    const r = await uc.record.execute({ slotId, reviewerId: ADMIN, outcome: 'PASSED', notes: 'x' });
    expect(code(r)).toBe('KYC_ALREADY_DECIDED');
    expect(slots.rows.get(slotId)?.status).toBe('BOOKED');
  });

  it('before the interview starts → INTERVIEW_NOT_STARTED; unknown slot → INTERVIEW_SLOT_NOT_FOUND', async () => {
    const { slotId } = await bookedInterview();
    expect(code(await uc.record.execute({ slotId, reviewerId: ADMIN, outcome: 'PASSED', notes: 'x' }))).toBe(
      'INTERVIEW_NOT_STARTED',
    );
    expect(
      code(await uc.record.execute({ slotId: newId(), reviewerId: ADMIN, outcome: 'PASSED', notes: 'x' })),
    ).toBe('INTERVIEW_SLOT_NOT_FOUND');
    expect(
      code(await uc.record.execute({ slotId: 'bad', reviewerId: ADMIN, outcome: 'PASSED', notes: 'x' })),
    ).toBe('INTERVIEW_SLOT_NOT_FOUND');
  });

  it('unbooked slot → INTERVIEW_NOT_BOOKED', async () => {
    const slotId = await openAt(1);
    clock.advance({ hours: 2 });
    expect(code(await uc.record.execute({ slotId, reviewerId: ADMIN, outcome: 'PASSED', notes: 'x' }))).toBe(
      'INTERVIEW_NOT_BOOKED',
    );
  });
});

describe('ListAvailableInterviewSlots', () => {
  it('only future OPEN slots, ascending, honouring from + limit', async () => {
    const a = await openAt(5);
    const b = await openAt(10);
    const c = await openAt(20);
    expect((await uc.available.execute({ limit: 2 })).map((s) => s.id)).toEqual([a, b]);
    expect(
      (await uc.available.execute({ from: addDuration(T0, { hours: 6 }), limit: 10 })).map((s) => s.id),
    ).toEqual([b, c]);
    clock.advance({ hours: 7 });
    // `from` trong quá khứ bị kẹp về hiện tại.
    expect((await uc.available.execute({ from: T0, limit: 10 })).map((s) => s.id)).toEqual([b, c]);
  });
});
