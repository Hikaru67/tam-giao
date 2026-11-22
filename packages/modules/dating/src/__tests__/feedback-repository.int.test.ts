import { createDatabase, DrizzleUnitOfWork, OutboxWriter, type Database } from '@tamgiao/db';
import { addDuration, newId, ok, type Tx } from '@tamgiao/kernel';
import { resetDatabase, runConcurrently, testDatabaseUrl } from '@tamgiao/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DateFeedback,
  type DateFeedbackId,
  type FeedbackAnswers,
} from '../domain/date-feedback.js';
import type { DatePlanId } from '../domain/date-plan.js';
import { DrizzleFeedbackRepository } from '../infrastructure/drizzle-feedback-repository.js';

const NOW = new Date('2026-12-05T10:00:00.000Z');

let database: Database;
let uow: DrizzleUnitOfWork;
let repo: DrizzleFeedbackRepository;

beforeAll(() => {
  database = createDatabase(testDatabaseUrl(), { maxConnections: 10 });
  uow = new DrizzleUnitOfWork(database.pool);
  repo = new DrizzleFeedbackRepository(new OutboxWriter());
});

beforeEach(async () => {
  await resetDatabase(database.pool);
});

afterAll(() => database.close());

/** Đọc trong một transaction ngắn (UnitOfWork cần `Result`). */
async function read<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const r = await uow.run(async (tx) => ok(await fn(tx)));
  if (r.isErr()) throw new Error('unreachable');
  return r.value;
}

function mustSubmit(
  input: {
    readonly id: DateFeedbackId;
    readonly date: {
      readonly datePlanId: DatePlanId;
      readonly matchId: string;
      readonly inviterId: string;
      readonly inviteeId: string;
      readonly status: 'CONFIRMED' | 'CHECKED_IN' | 'COMPLETED';
      readonly startsAt: Date;
    };
    readonly authorId: string;
    readonly answers: FeedbackAnswers;
  },
  counterpart: DateFeedback | null,
  now: Date,
): DateFeedback {
  const result = DateFeedback.submit(input, counterpart, now);
  if (result.isErr()) {
    throw new Error(`DateFeedback.submit failed: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

describe('DrizzleFeedbackRepository (tích hợp Postgres thật)', () => {
  it('a) add + findById + findByMatchAndAuthor trả đúng state (kể cả stopReasons, stopNote)', async () => {
    const matchId = newId();
    const a = newId();
    const b = newId();
    const datePlanId = newId<'DatePlan'>();
    const feedbackId = newId<'DateFeedback'>();

    const dateContext = {
      datePlanId,
      matchId,
      inviterId: a,
      inviteeId: b,
      status: 'CONFIRMED' as const,
      startsAt: addDuration(NOW, { hours: -2 }),
    };

    const answers: FeedbackAnswers = {
      rating: 4,
      profileMatch: 'MOSTLY_MATCH',
      feeling: 'DEEP_INTEREST',
      decision: 'B_STOP',
      stopReasons: ['NO_SPARK', 'LIFESTYLE_DIFFERENCE'],
      stopNote: 'Cần thêm thời gian suy nghĩ',
    };

    const feedback = mustSubmit(
      {
        id: feedbackId,
        date: dateContext,
        authorId: a,
        answers,
      },
      null,
      NOW,
    );

    const addResult = await uow.run((tx) => repo.add(tx, feedback));
    expect(addResult.isOk()).toBe(true);

    const byId = await read((tx) => repo.findById(tx, feedbackId));
    expect(byId?.toState()).toEqual({
      id: feedbackId,
      matchId: matchId.toLowerCase(),
      datePlanId,
      authorId: a.toLowerCase(),
      subjectId: b.toLowerCase(),
      rating: 4,
      profileMatch: 'MOSTLY_MATCH',
      feeling: 'DEEP_INTEREST',
      decision: 'B_STOP',
      stopReasons: ['NO_SPARK', 'LIFESTYLE_DIFFERENCE'],
      stopNote: 'Cần thêm thời gian suy nghĩ',
      submittedAt: NOW,
    });

    const byMatchAndAuthor = await read((tx) =>
      repo.findByMatchAndAuthor(tx, matchId.toUpperCase(), a.toUpperCase()),
    );
    expect(byMatchAndAuthor?.toState()).toEqual(byId?.toState());
  });

  it('b) add lần hai cùng (match, author) với id khác → Err code FEEDBACK_ALREADY_SUBMITTED', async () => {
    const matchId = newId();
    const a = newId();
    const b = newId();
    const datePlanId = newId<'DatePlan'>();

    const dateContext = {
      datePlanId,
      matchId,
      inviterId: a,
      inviteeId: b,
      status: 'CONFIRMED' as const,
      startsAt: addDuration(NOW, { hours: -2 }),
    };

    const fb1 = mustSubmit(
      {
        id: newId<'DateFeedback'>(),
        date: dateContext,
        authorId: a,
        answers: {
          rating: 5,
          profileMatch: 'FULL_MATCH',
          feeling: 'DEEP_INTEREST',
          decision: 'A_COMMIT',
          stopReasons: [],
          stopNote: null,
        },
      },
      null,
      NOW,
    );

    const res1 = await uow.run((tx) => repo.add(tx, fb1));
    expect(res1.isOk()).toBe(true);

    const fb2 = mustSubmit(
      {
        id: newId<'DateFeedback'>(),
        date: dateContext,
        authorId: a,
        answers: {
          rating: 3,
          profileMatch: 'MOSTLY_MATCH',
          feeling: 'NEED_MORE_TIME',
          decision: 'A_COMMIT',
          stopReasons: [],
          stopNote: null,
        },
      },
      null,
      NOW,
    );

    // Chạy trong uow.run, trả kết quả add làm Result để rollback
    const res2 = await uow.run((tx) => repo.add(tx, fb2));
    expect(res2.isErr()).toBe(true);
    if (res2.isErr()) {
      expect(res2.error.code).toBe('FEEDBACK_ALREADY_SUBMITTED');
      expect(res2.error.details).toEqual({ matchId: matchId.toLowerCase() });
    }

    // Đảm bảo chỉ có 1 dòng trong DB sau khi transaction rollback
    const { rows } = await database.pool.query<{ count: string }>(
      'select count(*)::text as count from dating.feedbacks where match_id = $1',
      [matchId],
    );
    expect(Number(rows[0]?.count)).toBe(1);
  });

  it('c) feedback có FeedbackSubmitted (vd decision B_STOP) → outbox có đúng 1 dòng; feedback A_COMMIT đầu tiên → không có outbox', async () => {
    const matchId1 = newId();
    const a1 = newId();
    const b1 = newId();
    const datePlanId1 = newId<'DatePlan'>();

    // 1. Feedback A_COMMIT đầu tiên -> không có dòng outbox
    const fbA = mustSubmit(
      {
        id: newId<'DateFeedback'>(),
        date: {
          datePlanId: datePlanId1,
          matchId: matchId1,
          inviterId: a1,
          inviteeId: b1,
          status: 'CONFIRMED',
          startsAt: addDuration(NOW, { hours: -2 }),
        },
        authorId: a1,
        answers: {
          rating: 5,
          profileMatch: 'FULL_MATCH',
          feeling: 'DEEP_INTEREST',
          decision: 'A_COMMIT',
          stopReasons: [],
          stopNote: null,
        },
      },
      null,
      NOW,
    );

    const resA = await uow.run((tx) => repo.add(tx, fbA));
    expect(resA.isOk()).toBe(true);

    const outboxA = await database.pool.query(
      `select 1 from platform.outbox where event_type = 'FeedbackSubmitted' and aggregate_id = $1`,
      [fbA.toState().id],
    );
    expect(outboxA.rowCount).toBe(0);

    // 2. Feedback có B_STOP -> outbox có đúng 1 dòng FeedbackSubmitted với outcome = 'STOPPED'
    const matchId2 = newId();
    const a2 = newId();
    const b2 = newId();
    const datePlanId2 = newId<'DatePlan'>();

    const fbStop = mustSubmit(
      {
        id: newId<'DateFeedback'>(),
        date: {
          datePlanId: datePlanId2,
          matchId: matchId2,
          inviterId: a2,
          inviteeId: b2,
          status: 'CONFIRMED',
          startsAt: addDuration(NOW, { hours: -2 }),
        },
        authorId: a2,
        answers: {
          rating: 3,
          profileMatch: 'MOSTLY_MATCH',
          feeling: 'NOT_A_FIT',
          decision: 'B_STOP',
          stopReasons: ['NO_SPARK'],
          stopNote: 'Không hợp nhau',
        },
      },
      null,
      NOW,
    );

    const resStop = await uow.run((tx) => repo.add(tx, fbStop));
    expect(resStop.isOk()).toBe(true);

    const { rows } = await database.pool.query<{
      event_type: string;
      payload: {
        matchId: string;
        datePlanId: string;
        participantIds: string[];
        outcome: string;
      };
    }>(`select event_type, payload from platform.outbox where aggregate_id = $1`, [fbStop.toState().id]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.event_type).toBe('FeedbackSubmitted');
    expect(rows[0]?.payload).toEqual({
      matchId: matchId2.toLowerCase(),
      datePlanId: datePlanId2,
      participantIds: [a2.toLowerCase(), b2.toLowerCase()],
      outcome: 'STOPPED',
    });
  });

  it('d) listAppearanceFlags chỉ trả feedback profile_match DIFFERENT, sắp mới trước, total đúng, phân trang limit/offset', async () => {
    const match1 = newId();
    const match2 = newId();
    const match3 = newId();
    const match4 = newId();
    const match5 = newId();

    const u1 = newId();
    const u2 = newId();
    const u3 = newId();
    const u4 = newId();
    const u5 = newId();
    const other = newId();

    const t1 = new Date('2026-12-05T07:00:00.000Z');
    const t2 = new Date('2026-12-05T08:00:00.000Z');
    const t3 = new Date('2026-12-05T09:00:00.000Z');
    const t4 = new Date('2026-12-05T09:30:00.000Z');
    const t5 = new Date('2026-12-05T10:00:00.000Z');

    // 3 DIFFERENT feedbacks at t1, t2, t3
    const fbDiff1 = mustSubmit(
      {
        id: newId<'DateFeedback'>(),
        date: {
          datePlanId: newId<'DatePlan'>(),
          matchId: match1,
          inviterId: u1,
          inviteeId: other,
          status: 'CONFIRMED',
          startsAt: addDuration(t1, { hours: -1 }),
        },
        authorId: u1,
        answers: {
          rating: 3,
          profileMatch: 'DIFFERENT',
          feeling: 'NOT_A_FIT',
          decision: 'B_STOP',
          stopReasons: ['NO_SPARK'],
          stopNote: 'Different look',
        },
      },
      null,
      t1,
    );

    const fbDiff2 = mustSubmit(
      {
        id: newId<'DateFeedback'>(),
        date: {
          datePlanId: newId<'DatePlan'>(),
          matchId: match2,
          inviterId: u2,
          inviteeId: other,
          status: 'CONFIRMED',
          startsAt: addDuration(t2, { hours: -1 }),
        },
        authorId: u2,
        answers: {
          rating: 2,
          profileMatch: 'DIFFERENT',
          feeling: 'NOT_A_FIT',
          decision: 'B_STOP',
          stopReasons: ['NO_SPARK'],
          stopNote: 'Khác ảnh eKYC',
        },
      },
      null,
      t2,
    );

    const fbDiff3 = mustSubmit(
      {
        id: newId<'DateFeedback'>(),
        date: {
          datePlanId: newId<'DatePlan'>(),
          matchId: match3,
          inviterId: u3,
          inviteeId: other,
          status: 'CONFIRMED',
          startsAt: addDuration(t3, { hours: -1 }),
        },
        authorId: u3,
        answers: {
          rating: 4,
          profileMatch: 'DIFFERENT',
          feeling: 'DEEP_INTEREST',
          decision: 'A_COMMIT',
          stopReasons: [],
          stopNote: null,
        },
      },
      null,
      t3,
    );

    // 1 FULL_MATCH at t4
    const fbFull = mustSubmit(
      {
        id: newId<'DateFeedback'>(),
        date: {
          datePlanId: newId<'DatePlan'>(),
          matchId: match4,
          inviterId: u4,
          inviteeId: other,
          status: 'CONFIRMED',
          startsAt: addDuration(t4, { hours: -1 }),
        },
        authorId: u4,
        answers: {
          rating: 5,
          profileMatch: 'FULL_MATCH',
          feeling: 'DEEP_INTEREST',
          decision: 'A_COMMIT',
          stopReasons: [],
          stopNote: null,
        },
      },
      null,
      t4,
    );

    // 1 MOSTLY_MATCH at t5
    const fbMostly = mustSubmit(
      {
        id: newId<'DateFeedback'>(),
        date: {
          datePlanId: newId<'DatePlan'>(),
          matchId: match5,
          inviterId: u5,
          inviteeId: other,
          status: 'CONFIRMED',
          startsAt: addDuration(t5, { hours: -1 }),
        },
        authorId: u5,
        answers: {
          rating: 4,
          profileMatch: 'MOSTLY_MATCH',
          feeling: 'NEED_MORE_TIME',
          decision: 'A_COMMIT',
          stopReasons: [],
          stopNote: null,
        },
      },
      null,
      t5,
    );

    await uow.run(async (tx) => {
      await repo.add(tx, fbDiff1);
      await repo.add(tx, fbDiff2);
      await repo.add(tx, fbDiff3);
      await repo.add(tx, fbFull);
      await repo.add(tx, fbMostly);
      return ok();
    });

    // Trang 1: limit 2, offset 0 -> sắp xếp mới trước (t3 rồi đến t2)
    const page1 = await read((tx) => repo.listAppearanceFlags(tx, { limit: 2, offset: 0 }));
    expect(page1.total).toBe(3);
    expect(page1.items).toHaveLength(2);
    expect(page1.items[0]?.feedbackId).toBe(fbDiff3.toState().id);
    expect(page1.items[1]?.feedbackId).toBe(fbDiff2.toState().id);
    expect(page1.items[0]).toEqual({
      feedbackId: fbDiff3.toState().id,
      matchId: match3.toLowerCase(),
      datePlanId: fbDiff3.toState().datePlanId,
      authorId: u3.toLowerCase(),
      subjectId: other.toLowerCase(),
      submittedAt: t3,
    });

    // Trang 2: limit 2, offset 2 -> bản ghi còn lại (t1)
    const page2 = await read((tx) => repo.listAppearanceFlags(tx, { limit: 2, offset: 2 }));
    expect(page2.total).toBe(3);
    expect(page2.items).toHaveLength(1);
    expect(page2.items[0]?.feedbackId).toBe(fbDiff1.toState().id);
    expect(page2.items[0]?.submittedAt).toEqual(t1);
  });

  it('e) lockMatch tuần tự hoá: dùng runConcurrently chạy 2 transaction cùng match → đúng 1 dòng outbox FeedbackSubmitted outcome SUCCESS và 2 dòng feedbacks', async () => {
    const matchId = newId();
    const a = newId();
    const b = newId();
    const datePlanId = newId<'DatePlan'>();

    const dateContext = {
      datePlanId,
      matchId,
      inviterId: a,
      inviteeId: b,
      status: 'CONFIRMED' as const,
      startsAt: addDuration(NOW, { hours: -2 }),
    };

    const results = await runConcurrently(2, async (index) => {
      const authorId = index === 0 ? a : b;
      const counterpartId = index === 0 ? b : a;

      return uow.run(async (tx) => {
        await repo.lockMatch(tx, matchId);
        const counterpart = await repo.findByMatchAndAuthor(tx, matchId, counterpartId);

        const feedback = mustSubmit(
          {
            id: newId<'DateFeedback'>(),
            date: dateContext,
            authorId,
            answers: {
              rating: 5,
              profileMatch: 'FULL_MATCH',
              feeling: 'DEEP_INTEREST',
              decision: 'A_COMMIT',
              stopReasons: [],
              stopNote: null,
            },
          },
          counterpart,
          NOW,
        );

        return repo.add(tx, feedback);
      });
    });

    for (const r of results) {
      expect(r.status).toBe('fulfilled');
      if (r.status === 'fulfilled') {
        expect(r.value.isOk()).toBe(true);
      }
    }

    // Đúng 2 dòng trong dating.feedbacks
    const { rows: feedbackRows } = await database.pool.query<{ count: string }>(
      'select count(*)::text as count from dating.feedbacks where match_id = $1',
      [matchId],
    );
    expect(Number(feedbackRows[0]?.count)).toBe(2);

    // Đúng 1 dòng outbox 'FeedbackSubmitted' với outcome 'SUCCESS'
    const { rows: outboxRows } = await database.pool.query<{
      event_type: string;
      payload: { matchId: string; datePlanId: string; participantIds: string[]; outcome: string };
    }>(
      `select event_type, payload from platform.outbox where event_type = 'FeedbackSubmitted' and payload->>'matchId' = $1`,
      [matchId.toLowerCase()],
    );
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0]?.event_type).toBe('FeedbackSubmitted');
    expect(outboxRows[0]?.payload.outcome).toBe('SUCCESS');
    expect(outboxRows[0]?.payload.datePlanId).toBe(datePlanId);
    expect(outboxRows[0]?.payload.participantIds).toEqual([a.toLowerCase(), b.toLowerCase()]);
  });
});
