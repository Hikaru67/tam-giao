import { DATING_DAYS, OFFER_TTL_HOURS, RESPONSE_TTL_HOURS } from '@tamgiao/contracts/constants';
import { addDuration, newId, type DomainEvent } from '@tamgiao/kernel';
import { describe, expect, it } from 'vitest';
import { MATCH_STATUSES, Match, type MatchState, type MatchStatus } from '../domain/match.js';

const A = 'user-a';
const B = 'user-b';
const OUTSIDER = 'user-x';
const STAFF = 'staff-1';
const T0 = new Date('2026-03-01T00:00:00.000Z');
const at = (d: Parameters<typeof addDuration>[1]): Date => addDuration(T0, d);

/** Thời điểm các bước dựng fixture: A đồng ý ở +1h, B đồng ý ở +2h, gặp ở +3h. */
const ACCEPT_A_AT = at({ hours: 1 });
const ACCEPT_B_AT = at({ hours: 2 });
const MET_AT = at({ hours: 3 });
/** Thời điểm thao tác trong bảng: còn trong hạn của mọi trạng thái có hạn. */
const ACTION_AT = at({ hours: 4 });
/** Thời điểm chạy `expire` trong bảng: đã qua hạn của mọi trạng thái có hạn. */
const EXPIRE_AT = at({ days: 30 });

const offer = (now: Date = T0): Match =>
  Match.offer(
    {
      id: newId<'Match'>(),
      participants: [A, B],
      createdBy: STAFF,
      scoreSnapshot: { total: 94, pillars: { values: 96, plans: 92, lifestyle: 90 } },
      staffNote: 'Hai bạn cùng yêu thích đọc sách',
    },
    now,
  );

const must = (r: { ok: boolean }): void => {
  if (!r.ok) throw new Error(`fixture failed: ${JSON.stringify(r)}`);
};

/** Dựng match ở trạng thái `status` qua đúng các thao tác domain; ở AWAITING_RESPONSE người đã đồng ý là A. */
const reach = (status: MatchStatus): Match => {
  const m = offer();
  const toDating = (): void => {
    must(m.accept(A, ACCEPT_A_AT));
    must(m.accept(B, ACCEPT_B_AT));
  };
  switch (status) {
    case 'OFFERED':
      break;
    case 'AWAITING_RESPONSE':
      must(m.accept(A, ACCEPT_A_AT));
      break;
    case 'DATING':
      toDating();
      break;
    case 'MET':
      toDating();
      must(m.markMet(MET_AT));
      break;
    case 'CLOSED_SUCCESS':
      toDating();
      must(m.markMet(MET_AT));
      must(m.close('SUCCESS', MET_AT));
      break;
    case 'CLOSED_STOPPED':
      toDating();
      must(m.close('STOPPED', MET_AT));
      break;
    case 'EXPIRED':
      must(m.expire(at({ hours: OFFER_TTL_HOURS })));
      break;
    case 'DECLINED':
      must(m.decline(B, 'not_my_type', ACCEPT_A_AT));
      break;
    case 'LOCKED':
      must(m.lock('REPORT_FILED', ACCEPT_A_AT));
      break;
  }
  expect(m.status).toBe(status);
  m.pullEvents();
  return m;
};

const ACTIONS = {
  acceptByA: (m: Match) => m.accept(A, ACTION_AT),
  acceptByB: (m: Match) => m.accept(B, ACTION_AT),
  declineByA: (m: Match) => m.decline(A, null, ACTION_AT),
  declineByB: (m: Match) => m.decline(B, null, ACTION_AT),
  withdrawByA: (m: Match) => m.withdraw(A, ACTION_AT),
  withdrawByB: (m: Match) => m.withdraw(B, ACTION_AT),
  expire: (m: Match) => m.expire(EXPIRE_AT),
  markMet: (m: Match) => m.markMet(ACTION_AT),
  closeSuccess: (m: Match) => m.close('SUCCESS', ACTION_AT),
  closeStopped: (m: Match) => m.close('STOPPED', ACTION_AT),
  lock: (m: Match) => m.lock('REPORT_FILED', ACTION_AT),
} as const;
type ActionName = keyof typeof ACTIONS;

type Expectation =
  { readonly to: MatchStatus; readonly event: string } | { readonly noop: true } | { readonly error: string };

const to = (status: MatchStatus, event: string): Expectation => ({ to: status, event });
const NOOP: Expectation = { noop: true };
const INVALID: Expectation = { error: 'INVALID_TRANSITION' };
const RESPONDED: Expectation = { error: 'ALREADY_RESPONDED' };

/** Hàng của trạng thái đóng: chỉ `expire` là no-op `ok()`, còn lại `INVALID_TRANSITION`. */
const CLOSED_ROW: Record<ActionName, Expectation> = {
  acceptByA: INVALID,
  acceptByB: INVALID,
  declineByA: INVALID,
  declineByB: INVALID,
  withdrawByA: INVALID,
  withdrawByB: INVALID,
  expire: NOOP,
  markMet: INVALID,
  closeSuccess: INVALID,
  closeStopped: INVALID,
  lock: INVALID,
};

/** Bảng đầy đủ 9 trạng thái × 11 hành động — nguồn chân lý của máy trạng thái (khớp bảng trong `match.ts`). */
const TABLE: Record<MatchStatus, Record<ActionName, Expectation>> = {
  OFFERED: {
    acceptByA: to('AWAITING_RESPONSE', 'MatchAwaitingResponse'),
    acceptByB: to('AWAITING_RESPONSE', 'MatchAwaitingResponse'),
    declineByA: to('DECLINED', 'MatchDeclined'),
    declineByB: to('DECLINED', 'MatchDeclined'),
    withdrawByA: INVALID,
    withdrawByB: INVALID,
    expire: to('EXPIRED', 'MatchExpired'),
    markMet: INVALID,
    closeSuccess: INVALID,
    closeStopped: INVALID,
    lock: to('LOCKED', 'MatchLocked'),
  },
  AWAITING_RESPONSE: {
    acceptByA: RESPONDED,
    acceptByB: to('DATING', 'MatchStartedDating'),
    declineByA: RESPONDED,
    declineByB: to('DECLINED', 'MatchDeclined'),
    withdrawByA: to('DECLINED', 'MatchDeclined'),
    withdrawByB: INVALID,
    expire: to('EXPIRED', 'MatchExpired'),
    markMet: INVALID,
    closeSuccess: INVALID,
    closeStopped: INVALID,
    lock: to('LOCKED', 'MatchLocked'),
  },
  DATING: {
    acceptByA: INVALID,
    acceptByB: INVALID,
    declineByA: INVALID,
    declineByB: INVALID,
    withdrawByA: INVALID,
    withdrawByB: INVALID,
    expire: to('CLOSED_STOPPED', 'MatchClosed'),
    markMet: to('MET', 'MatchMet'),
    closeSuccess: INVALID,
    closeStopped: to('CLOSED_STOPPED', 'MatchClosed'),
    lock: to('LOCKED', 'MatchLocked'),
  },
  MET: {
    acceptByA: INVALID,
    acceptByB: INVALID,
    declineByA: INVALID,
    declineByB: INVALID,
    withdrawByA: INVALID,
    withdrawByB: INVALID,
    expire: NOOP,
    markMet: INVALID,
    closeSuccess: to('CLOSED_SUCCESS', 'MatchClosed'),
    closeStopped: to('CLOSED_STOPPED', 'MatchClosed'),
    lock: to('LOCKED', 'MatchLocked'),
  },
  CLOSED_SUCCESS: CLOSED_ROW,
  CLOSED_STOPPED: CLOSED_ROW,
  EXPIRED: CLOSED_ROW,
  DECLINED: CLOSED_ROW,
  LOCKED: CLOSED_ROW,
};

const CASES = MATCH_STATUSES.flatMap((status) =>
  (Object.keys(ACTIONS) as ActionName[]).map((action) => ({
    status,
    action,
    expected: TABLE[status][action],
  })),
);

const describeExpectation = (e: Expectation): string =>
  'to' in e ? `→ ${e.to} + ${e.event}` : 'noop' in e ? 'no-op ok' : e.error;

const snapshot = (m: Match): MatchState => structuredClone(m.toState());

describe('Match — bảng chuyển trạng thái (AC1)', () => {
  it('bảng phủ đủ 9 trạng thái × 11 hành động', () => {
    expect(CASES).toHaveLength(9 * 11);
  });

  it.each(CASES.map((c) => [c.status, c.action, describeExpectation(c.expected), c] as const))(
    '%s × %s: %s',
    (_s, _a, _d, { status, action, expected }) => {
      const m = reach(status);
      const before = snapshot(m);
      const result = ACTIONS[action](m);
      const events = m.pullEvents();

      if ('to' in expected) {
        expect(result.ok).toBe(true);
        expect(m.status).toBe(expected.to);
        expect(events.map((e) => e.type)).toEqual([expected.event]);
        expect(events[0]?.aggregateId).toBe(m.id);
        expect(m.version).toBe(before.version + 1);
        expect(events[0]?.version).toBe(m.version);
        expect(m.isOpen()).toBe(['AWAITING_RESPONSE', 'DATING', 'MET'].includes(expected.to));
        return;
      }

      if ('noop' in expected) {
        expect(result.ok).toBe(true);
      } else {
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe(expected.error);
      }
      expect(events).toEqual([]);
      expect(m.toState()).toEqual(before);
    },
  );
});

const payloadOf = (events: DomainEvent[]): unknown => {
  expect(events).toHaveLength(1);
  return events[0]?.payload;
};

describe('Match.offer', () => {
  it('tạo OFFERED, hạn OFFER_TTL_HOURS, phát MatchOffered không chứa PII', () => {
    const m = offer();
    expect(m.status).toBe('OFFERED');
    expect(m.isOpen()).toBe(true);
    expect(m.expiresAt).toEqual(at({ hours: OFFER_TTL_HOURS }));
    expect(m.participants).toEqual([A, B]);
    expect(m.createdBy).toBe(STAFF);
    expect(m.acceptedBy).toEqual([]);
    expect(m.scoreSnapshot).toEqual({ total: 94, pillars: { values: 96, plans: 92, lifestyle: 90 } });
    expect(m.version).toBe(1);
    const events = m.pullEvents();
    expect(events.map((e) => e.type)).toEqual(['MatchOffered']);
    expect(payloadOf(events)).toEqual({
      matchId: m.id,
      participantIds: [A, B],
      createdBy: STAFF,
      expiresAt: at({ hours: OFFER_TTL_HOURS }).toISOString(),
    });
    expect(JSON.stringify(events[0]?.payload)).not.toContain('đọc sách');
  });

  it('hai người trùng nhau → throw (lỗi lập trình)', () => {
    expect(() => Match.offer({ id: newId<'Match'>(), participants: [A, A], createdBy: STAFF }, T0)).toThrow();
  });

  it.each([-1, 101, Number.NaN])('điểm %s ngoài 0–100 → throw', (score) => {
    expect(() =>
      Match.offer(
        {
          id: newId<'Match'>(),
          participants: [A, B],
          createdBy: STAFF,
          scoreSnapshot: { total: 50, pillars: { values: score } },
        },
        T0,
      ),
    ).toThrow();
  });

  it('không truyền snapshot / ghi chú → null', () => {
    const m = Match.offer({ id: newId<'Match'>(), participants: [A, B], createdBy: STAFF }, T0);
    expect(m.scoreSnapshot).toBeNull();
    expect(m.staffNote).toBeNull();
  });
});

describe('Match.accept', () => {
  it('bên thứ nhất (B) → AWAITING_RESPONSE, hạn mới RESPONSE_TTL_HOURS kể từ lúc đồng ý', () => {
    const m = reach('OFFERED');
    expect(m.accept(B, ACCEPT_A_AT).ok).toBe(true);
    expect(m.status).toBe('AWAITING_RESPONSE');
    expect(m.expiresAt).toEqual(addDuration(ACCEPT_A_AT, { hours: RESPONSE_TTL_HOURS }));
    expect(m.acceptedBy).toEqual([B]);
    expect(m.hasAccepted(B)).toBe(true);
    expect(m.hasAccepted(A)).toBe(false);
    expect(payloadOf(m.pullEvents())).toEqual({
      matchId: m.id,
      participantIds: [A, B],
      acceptedBy: B,
      awaitingUserId: A,
      expiresAt: addDuration(ACCEPT_A_AT, { hours: RESPONSE_TTL_HOURS }).toISOString(),
    });
  });

  it('bên còn lại → DATING, hạn DATING_DAYS kể từ lúc đồng ý', () => {
    const m = reach('AWAITING_RESPONSE');
    expect(m.accept(B, ACCEPT_B_AT).ok).toBe(true);
    expect(m.status).toBe('DATING');
    expect(m.expiresAt).toEqual(addDuration(ACCEPT_B_AT, { days: DATING_DAYS }));
    expect(m.acceptedBy).toEqual([A, B]);
    expect(payloadOf(m.pullEvents())).toEqual({
      matchId: m.id,
      participantIds: [A, B],
      expiresAt: addDuration(ACCEPT_B_AT, { days: DATING_DAYS }).toISOString(),
    });
  });

  it('cùng một người đồng ý 2 lần → ALREADY_RESPONDED (kể cả sau hạn)', () => {
    const m = reach('AWAITING_RESPONSE');
    const again = m.accept(A, at({ days: 3 }));
    expect(!again.ok && again.error.code).toBe('ALREADY_RESPONDED');
  });
});

describe('Hết hạn — quy ước biên now >= expiresAt (AC2)', () => {
  const offerDeadline = at({ hours: OFFER_TTL_HOURS });
  const responseDeadline = addDuration(ACCEPT_A_AT, { hours: RESPONSE_TTL_HOURS });
  const justBefore = (d: Date): Date => new Date(d.getTime() - 1);

  it('OFFERED: accept 1ms trước hạn → ok', () => {
    const m = reach('OFFERED');
    expect(m.accept(A, justBefore(offerDeadline)).ok).toBe(true);
  });

  it.each([
    ['đúng hạn', offerDeadline],
    ['sau hạn', at({ hours: OFFER_TTL_HOURS + 1 })],
  ])('OFFERED: accept %s → OFFER_EXPIRED, state không đổi', (_l, now) => {
    const m = reach('OFFERED');
    const before = snapshot(m);
    const r = m.accept(A, now);
    expect(!r.ok && r.error.code).toBe('OFFER_EXPIRED');
    expect(m.toState()).toEqual(before);
    expect(m.pullEvents()).toEqual([]);
  });

  it('AWAITING_RESPONSE: hạn tính lại từ lúc bên thứ nhất đồng ý — sau hạn OFFERED cũ vẫn accept được', () => {
    const m = reach('AWAITING_RESPONSE');
    expect(m.accept(B, offerDeadline).ok).toBe(true);
    expect(m.status).toBe('DATING');
  });

  it('AWAITING_RESPONSE: bên còn lại accept đúng hạn → OFFER_EXPIRED', () => {
    const m = reach('AWAITING_RESPONSE');
    const r = m.accept(B, responseDeadline);
    expect(!r.ok && r.error.code).toBe('OFFER_EXPIRED');
    expect(m.status).toBe('AWAITING_RESPONSE');
  });

  it('decline / withdraw sau hạn → OFFER_EXPIRED (chỉ job expire được đóng match)', () => {
    const offered = reach('OFFERED');
    const d = offered.decline(A, null, offerDeadline);
    expect(!d.ok && d.error.code).toBe('OFFER_EXPIRED');
    const awaiting = reach('AWAITING_RESPONSE');
    const d2 = awaiting.decline(B, null, responseDeadline);
    expect(!d2.ok && d2.error.code).toBe('OFFER_EXPIRED');
    const w = awaiting.withdraw(A, responseDeadline);
    expect(!w.ok && w.error.code).toBe('OFFER_EXPIRED');
    expect(awaiting.status).toBe('AWAITING_RESPONSE');
  });

  it.each([
    ['OFFERED', offerDeadline],
    ['AWAITING_RESPONSE', responseDeadline],
    ['DATING', addDuration(ACCEPT_B_AT, { days: DATING_DAYS })],
  ] as const)(
    '%s: expire 1ms trước hạn → NOT_YET_EXPIRED, không đổi; đúng hạn → thành công',
    (status, deadline) => {
      const m = reach(status);
      const before = snapshot(m);
      const early = m.expire(justBefore(deadline));
      expect(!early.ok && early.error.code).toBe('NOT_YET_EXPIRED');
      expect(m.toState()).toEqual(before);
      expect(m.pullEvents()).toEqual([]);
      expect(m.expire(deadline).ok).toBe(true);
      expect(m.isOpen()).toBe(false);
    },
  );

  it('job hết hạn cũ của OFFERED chạy khi đã sang AWAITING_RESPONSE (hạn mới) → NOT_YET_EXPIRED', () => {
    const m = reach('AWAITING_RESPONSE');
    const r = m.expire(offerDeadline);
    expect(!r.ok && r.error.code).toBe('NOT_YET_EXPIRED');
  });

  it('expire ở OFFERED → EXPIRED + MatchExpired', () => {
    const m = reach('OFFERED');
    expect(m.expire(offerDeadline).ok).toBe(true);
    expect(m.status).toBe('EXPIRED');
    expect(m.expiresAt).toBeNull();
    expect(payloadOf(m.pullEvents())).toEqual({
      matchId: m.id,
      participantIds: [A, B],
      fromStatus: 'OFFERED',
      acceptedBy: [],
    });
  });

  it('expire ở AWAITING_RESPONSE → EXPIRED, payload ghi người đã đồng ý', () => {
    const m = reach('AWAITING_RESPONSE');
    expect(m.expire(responseDeadline).ok).toBe(true);
    expect(payloadOf(m.pullEvents())).toMatchObject({ fromStatus: 'AWAITING_RESPONSE', acceptedBy: [A] });
  });

  it('expire ở DATING (hết DATING_DAYS) → CLOSED_STOPPED lý do TIMEOUT, không cooldown + MatchClosed{STOPPED, DATING_PERIOD_ENDED}', () => {
    const m = reach('DATING');
    expect(m.expire(addDuration(ACCEPT_B_AT, { days: DATING_DAYS })).ok).toBe(true);
    expect(m.status).toBe('CLOSED_STOPPED');
    expect(m.closeOutcome).toBe('STOPPED');
    expect(m.closeReason).toBe('TIMEOUT');
    expect(m.appliesCooldown()).toBe(false);
    const events = m.pullEvents();
    expect(events.map((e) => e.type)).toEqual(['MatchClosed']);
    expect(payloadOf(events)).toEqual({
      matchId: m.id,
      participantIds: [A, B],
      outcome: 'STOPPED',
      fromStatus: 'DATING',
      trigger: 'DATING_PERIOD_ENDED',
    });
  });
});

describe('Người ngoài cặp (AC3)', () => {
  const OPS = {
    accept: (m: Match) => m.accept(OUTSIDER, ACTION_AT),
    decline: (m: Match) => m.decline(OUTSIDER, null, ACTION_AT),
    withdraw: (m: Match) => m.withdraw(OUTSIDER, ACTION_AT),
  } as const;
  const cases = MATCH_STATUSES.flatMap((status) =>
    (Object.keys(OPS) as (keyof typeof OPS)[]).map((op) => [status, op] as const),
  );

  it.each(cases)('%s × %s bởi người ngoài → NOT_PARTICIPANT, không đổi', (status, op) => {
    const m = reach(status);
    const before = snapshot(m);
    const r = OPS[op](m);
    expect(!r.ok && r.error.code).toBe('NOT_PARTICIPANT');
    expect(m.toState()).toEqual(before);
    expect(m.pullEvents()).toEqual([]);
  });

  it('isParticipant / counterpartOf', () => {
    const m = offer();
    expect(m.isParticipant(A)).toBe(true);
    expect(m.isParticipant(OUTSIDER)).toBe(false);
    expect(m.counterpartOf(A)).toBe(B);
    expect(m.counterpartOf(B)).toBe(A);
    expect(m.counterpartOf(OUTSIDER)).toBeNull();
  });
});

describe('expire idempotent trên match đã đóng (AC4)', () => {
  const closed: MatchStatus[] = ['EXPIRED', 'DECLINED', 'CLOSED_SUCCESS', 'CLOSED_STOPPED', 'LOCKED'];

  it.each(closed)('%s: expire gọi nhiều lần → ok, không event, không đổi version', (status) => {
    const m = reach(status);
    const before = snapshot(m);
    for (let i = 0; i < 3; i += 1) {
      expect(m.expire(EXPIRE_AT).ok).toBe(true);
      expect(m.expire(T0).ok).toBe(true);
    }
    expect(m.pullEvents()).toEqual([]);
    expect(m.toState()).toEqual(before);
  });

  it('job chạy 2 lần trên OFFERED quá hạn → 1 lần chuyển trạng thái, 1 event', () => {
    const m = reach('OFFERED');
    expect(m.expire(EXPIRE_AT).ok).toBe(true);
    expect(m.expire(EXPIRE_AT).ok).toBe(true);
    expect(m.pullEvents().map((e) => e.type)).toEqual(['MatchExpired']);
  });

  it('MET (không có hạn — job DATING cũ) → no-op ok', () => {
    const m = reach('MET');
    expect(m.expiresAt).toBeNull();
    expect(m.expire(EXPIRE_AT).ok).toBe(true);
    expect(m.status).toBe('MET');
  });
});

describe('decline / withdraw', () => {
  it('decline ở OFFERED → DECLINED, lưu lý do nhưng không đưa vào event', () => {
    const m = reach('OFFERED');
    expect(m.decline(A, 'Không hợp tính cách', ACTION_AT).ok).toBe(true);
    const state = m.toState();
    expect(state).toMatchObject({
      status: 'DECLINED',
      declinedBy: A,
      declineReason: 'Không hợp tính cách',
      withdrawn: false,
      closedAt: ACTION_AT,
      expiresAt: null,
    });
    expect(payloadOf(m.pullEvents())).toEqual({
      matchId: m.id,
      participantIds: [A, B],
      declinedBy: A,
      fromStatus: 'OFFERED',
      withdrawn: false,
    });
  });

  it('withdraw bởi người đã đồng ý → DECLINED{withdrawn:true}', () => {
    const m = reach('AWAITING_RESPONSE');
    expect(m.withdraw(A, ACTION_AT).ok).toBe(true);
    expect(m.toState()).toMatchObject({ status: 'DECLINED', declinedBy: A, withdrawn: true });
    expect(payloadOf(m.pullEvents())).toEqual({
      matchId: m.id,
      participantIds: [A, B],
      declinedBy: A,
      fromStatus: 'AWAITING_RESPONSE',
      withdrawn: true,
    });
  });

  it('withdraw bởi bên chưa đồng ý → INVALID_TRANSITION (reason not_accepted)', () => {
    const m = reach('AWAITING_RESPONSE');
    const r = m.withdraw(B, ACTION_AT);
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.error).toEqual({
        code: 'INVALID_TRANSITION',
        details: { action: 'withdraw', status: 'AWAITING_RESPONSE', reason: 'not_accepted' },
      });
  });
});

describe('markMet / close / lock', () => {
  it('markMet → MET, bỏ hạn', () => {
    const m = reach('DATING');
    expect(m.markMet(ACTION_AT).ok).toBe(true);
    expect(m.toState()).toMatchObject({ status: 'MET', metAt: ACTION_AT, expiresAt: null });
    expect(payloadOf(m.pullEvents())).toEqual({ matchId: m.id, participantIds: [A, B] });
  });

  it.each([
    ['MET', 'SUCCESS', 'CLOSED_SUCCESS'],
    ['MET', 'STOPPED', 'CLOSED_STOPPED'],
    ['DATING', 'STOPPED', 'CLOSED_STOPPED'],
  ] as const)('%s close(%s) → %s + MatchClosed{MANUAL}', (from, outcome, toStatus) => {
    const m = reach(from);
    expect(m.close(outcome, ACTION_AT).ok).toBe(true);
    expect(m.status).toBe(toStatus);
    expect(m.closeOutcome).toBe(outcome);
    expect(m.closeReason).toBeNull();
    expect(m.appliesCooldown()).toBe(toStatus === 'CLOSED_STOPPED');
    expect(m.toState().closedAt).toEqual(ACTION_AT);
    expect(payloadOf(m.pullEvents())).toEqual({
      matchId: m.id,
      participantIds: [A, B],
      outcome,
      fromStatus: from,
      trigger: 'MANUAL',
    });
  });

  it('DATING close(SUCCESS) → INVALID_TRANSITION (chưa gặp)', () => {
    const r = reach('DATING').close('SUCCESS', ACTION_AT);
    expect(!r.ok && r.error.details).toMatchObject({ reason: 'not_met_yet' });
  });

  it.each(['OFFERED', 'AWAITING_RESPONSE', 'DATING', 'MET'] as const)(
    'lock ở %s → LOCKED + MatchLocked{reason}',
    (from) => {
      const m = reach(from);
      expect(m.lock('REPORT_FILED', ACTION_AT).ok).toBe(true);
      expect(m.toState()).toMatchObject({ status: 'LOCKED', lockReason: 'REPORT_FILED', expiresAt: null });
      expect(payloadOf(m.pullEvents())).toEqual({
        matchId: m.id,
        participantIds: [A, B],
        fromStatus: from,
        reason: 'REPORT_FILED',
      });
    },
  );
});

describe('restore / toState', () => {
  it('dựng lại aggregate giữ nguyên state + version, thao tác tiếp được', () => {
    const original = reach('AWAITING_RESPONSE');
    const restored = Match.restore(original.toState());
    expect(restored.toState()).toEqual(original.toState());
    expect(restored.pullEvents()).toEqual([]);
    expect(restored.accept(B, ACTION_AT).ok).toBe(true);
    expect(restored.version).toBe(original.version + 1);
  });
});
