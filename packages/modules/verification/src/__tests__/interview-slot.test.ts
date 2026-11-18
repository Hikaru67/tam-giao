import { INTERVIEW_CHANGE_CUTOFF_HOURS, INTERVIEW_DURATION_MINUTES } from '@tamgiao/contracts/constants';
import { addDuration, newId, type DomainError, type Result } from '@tamgiao/kernel';
import { describe, expect, it } from 'vitest';
import { InterviewSlot } from '../domain/interview-slot.js';

const NOW = new Date('2026-11-18T01:00:00.000Z');
const STARTS = new Date('2026-11-20T03:00:00.000Z');
const USER = newId<'User'>();
const ADMIN = newId<'Admin'>();

function openSlot(startsAt = STARTS, meetingUrl: string | null = 'https://meet.test/abc') {
  const r = InterviewSlot.open(
    { id: newId<'InterviewSlot'>(), interviewerId: ADMIN, startsAt, meetingUrl },
    NOW,
  );
  if (r.isErr()) throw new Error(r.error.code);
  return r.value;
}

function bookedSlot(startsAt = STARTS) {
  const slot = openSlot(startsAt);
  expect(slot.book(USER, NOW).isOk()).toBe(true);
  return slot;
}

const errCode = (r: Result<unknown, DomainError>) => (r.isErr() ? r.error.code : null);

describe('InterviewSlot.open', () => {
  it(`opens a ${INTERVIEW_DURATION_MINUTES}-minute OPEN slot`, () => {
    const s = openSlot().toState();
    expect(s.status).toBe('OPEN');
    expect(s.endsAt.getTime() - s.startsAt.getTime()).toBe(15 * 60_000);
    expect(s.meetingUrl).toBe('https://meet.test/abc');
    expect(s.bookedBy).toBeNull();
  });

  it('blank meeting url → null', () => {
    expect(openSlot(STARTS, '   ').toState().meetingUrl).toBeNull();
  });

  it('rejects a start time in the past or now', () => {
    const at = (startsAt: Date) =>
      InterviewSlot.open({ id: newId<'InterviewSlot'>(), interviewerId: ADMIN, startsAt }, NOW);
    expect(errCode(at(NOW))).toBe('INTERVIEW_SLOT_IN_PAST');
    expect(errCode(at(addDuration(NOW, { minutes: -1 })))).toBe('INTERVIEW_SLOT_IN_PAST');
  });
});

describe('InterviewSlot.book', () => {
  it('OPEN → BOOKED', () => {
    const s = bookedSlot().toState();
    expect(s).toMatchObject({ status: 'BOOKED', bookedBy: USER, bookedAt: NOW });
  });

  it('already booked → SLOT_TAKEN', () => {
    const slot = bookedSlot();
    expect(errCode(slot.book(newId<'User'>(), NOW))).toBe('SLOT_TAKEN');
  });

  it('completed → SLOT_TAKEN', () => {
    const slot = bookedSlot();
    slot.recordResult({ outcome: 'PASSED', notes: 'ok', recordedBy: ADMIN }, STARTS);
    expect(errCode(slot.book(newId<'User'>(), NOW))).toBe('SLOT_TAKEN');
  });

  it('slot already started → INTERVIEW_SLOT_IN_PAST', () => {
    const slot = openSlot();
    expect(errCode(slot.book(USER, STARTS))).toBe('INTERVIEW_SLOT_IN_PAST');
  });
});

describe(`InterviewSlot.cancel (cutoff ${INTERVIEW_CHANGE_CUTOFF_HOURS}h)`, () => {
  const exactlyCutoff = addDuration(STARTS, { hours: -2 });

  it('exactly 2h before start → allowed, slot back to OPEN', () => {
    const slot = bookedSlot();
    expect(slot.canChange(exactlyCutoff)).toBe(true);
    expect(slot.cancel(USER, exactlyCutoff).isOk()).toBe(true);
    expect(slot.toState()).toMatchObject({ status: 'OPEN', bookedBy: null, bookedAt: null });
  });

  it('1 ms after the 2h cutoff → CANCEL_TOO_LATE with deadline', () => {
    const slot = bookedSlot();
    const late = addDuration(exactlyCutoff, { milliseconds: 1 });
    expect(slot.canChange(late)).toBe(false);
    const r = slot.cancel(USER, late);
    expect(r.isErr() && r.error).toEqual({
      code: 'CANCEL_TOO_LATE',
      details: { deadline: exactlyCutoff.toISOString() },
    });
    expect(slot.status).toBe('BOOKED');
  });

  it('well before → allowed', () => {
    expect(bookedSlot().cancel(USER, NOW).isOk()).toBe(true);
  });

  it('changeDeadline = start − 2h', () => {
    expect(openSlot().changeDeadline).toEqual(exactlyCutoff);
  });

  it('not booked / booked by someone else → INTERVIEW_NOT_BOOKED', () => {
    expect(errCode(openSlot().cancel(USER, NOW))).toBe('INTERVIEW_NOT_BOOKED');
    expect(errCode(bookedSlot().cancel(newId<'User'>(), NOW))).toBe('INTERVIEW_NOT_BOOKED');
  });
});

describe('InterviewSlot.recordResult', () => {
  it('BOOKED → COMPLETED with trimmed notes, keeps bookedBy', () => {
    const slot = bookedSlot();
    const at = addDuration(STARTS, { minutes: 20 });
    expect(
      slot.recordResult({ outcome: 'FAILED', notes: '  không phù hợp  ', recordedBy: ADMIN }, at).isOk(),
    ).toBe(true);
    expect(slot.toState()).toMatchObject({
      status: 'COMPLETED',
      outcome: 'FAILED',
      notes: 'không phù hợp',
      recordedBy: ADMIN,
      recordedAt: at,
      bookedBy: USER,
    });
  });

  it('can be corrected after completion', () => {
    const slot = bookedSlot();
    slot.recordResult({ outcome: 'FAILED', notes: 'a', recordedBy: ADMIN }, STARTS);
    expect(slot.recordResult({ outcome: 'PASSED', notes: 'b', recordedBy: ADMIN }, STARTS).isOk()).toBe(true);
    expect(slot.toState().outcome).toBe('PASSED');
  });

  it('OPEN slot → INTERVIEW_NOT_BOOKED', () => {
    expect(
      errCode(openSlot().recordResult({ outcome: 'PASSED', notes: 'x', recordedBy: ADMIN }, STARTS)),
    ).toBe('INTERVIEW_NOT_BOOKED');
  });

  it('before start → INTERVIEW_NOT_STARTED', () => {
    const slot = bookedSlot();
    const r = slot.recordResult({ outcome: 'PASSED', notes: 'x', recordedBy: ADMIN }, NOW);
    expect(errCode(r)).toBe('INTERVIEW_NOT_STARTED');
    expect(slot.status).toBe('BOOKED');
  });
});
