import { newId, type DomainEvent, type Result } from '@tamgiao/kernel';
import { describe, expect, it } from 'vitest';
import { CccdNumber } from '../domain/cccd-number.js';
import {
  KYC_STEPS,
  KycSubmission,
  type KycStatus,
  type KycSubmissionId,
} from '../domain/kyc-submission.js';
import { RejectionReason } from '../domain/rejection-reason.js';

const T0 = new Date('2026-11-01T00:00:00.000Z');
const at = (minutes: number): Date => new Date(T0.getTime() + minutes * 60_000);
const USER_ID = newId<'User'>();
const REVIEWER = newId<'AdminUser'>();
const OTHER_REVIEWER = newId<'AdminUser'>();

const unwrap = <T, E>(result: Result<T, E>): T => {
  if (result.isErr()) throw new Error(`expected Ok, got ${JSON.stringify(result.error)}`);
  return result.value;
};

const reason = (code = 'FACE_MISMATCH', note: string | null = 'Ảnh selfie không khớp'): RejectionReason =>
  unwrap(RejectionReason.create({ code, note }));

const draft = (): KycSubmission =>
  KycSubmission.start({ id: newId<'KycSubmission'>() as KycSubmissionId, userId: USER_ID }, T0);

const passAllSteps = (s: KycSubmission): void => {
  for (const step of KYC_STEPS) unwrap(s.markStep(step, 'PASSED', at(1)));
};

/** Dựng hồ sơ ở trạng thái cho trước bằng đúng chuỗi chuyển trạng thái hợp lệ; cả 4 bước đã đạt; xoá event. */
const inStatus = (status: KycStatus): KycSubmission => {
  const s = draft();
  passAllSteps(s);
  if (status !== 'DRAFT') unwrap(s.submit(at(2)));
  if (status === 'UNDER_REVIEW' || status === 'NEEDS_MORE_INFO' || status === 'APPROVED' || status === 'REJECTED')
    unwrap(s.assignReviewer(REVIEWER, at(3)));
  if (status === 'NEEDS_MORE_INFO') unwrap(s.requestMoreInfo({ items: ['SELFIE'] }, at(4)));
  if (status === 'APPROVED') unwrap(s.approve(REVIEWER, at(4)));
  if (status === 'REJECTED') unwrap(s.reject(reason(), REVIEWER, at(4)));
  s.pullEvents();
  return s;
};

type Action =
  | 'submit'
  | 'assignReviewer'
  | 'requestMoreInfo'
  | 'resubmit'
  | 'approve'
  | 'reject'
  | 'markStep'
  | 'recordCccdNumber';

const NOW = at(10);
const run = (s: KycSubmission, action: Action): Result<void, { code: string }> => {
  switch (action) {
    case 'submit':
      return s.submit(NOW);
    case 'assignReviewer':
      return s.assignReviewer(OTHER_REVIEWER, NOW);
    case 'requestMoreInfo':
      return s.requestMoreInfo({ items: ['CCCD_FRONT'] }, NOW);
    case 'resubmit':
      return s.resubmit(NOW);
    case 'approve':
      return s.approve(REVIEWER, NOW);
    case 'reject':
      return s.reject(reason(), REVIEWER, NOW);
    case 'markStep':
      return s.markStep('INTERVIEW', 'FAILED', NOW);
    case 'recordCccdNumber':
      return s.recordCccdNumber(unwrap(CccdNumber.parse('001090012345')), NOW);
  }
};

type Expected = { readonly to: KycStatus; readonly event: string | null } | { readonly error: string };
const INVALID = { error: 'KYC_INVALID_TRANSITION' } as const;
const DECIDED = { error: 'KYC_ALREADY_DECIDED' } as const;
const stay = (to: KycStatus): Expected => ({ to, event: null });

/** Ma trận đầy đủ: trạng thái hiện tại × thao tác → trạng thái mới + event, hoặc mã lỗi. */
const MATRIX: Readonly<Record<KycStatus, Readonly<Record<Action, Expected>>>> = {
  DRAFT: {
    submit: { to: 'SUBMITTED', event: 'KycSubmitted' },
    assignReviewer: INVALID,
    requestMoreInfo: INVALID,
    resubmit: INVALID,
    approve: INVALID,
    reject: INVALID,
    markStep: stay('DRAFT'),
    recordCccdNumber: stay('DRAFT'),
  },
  SUBMITTED: {
    submit: INVALID,
    assignReviewer: { to: 'UNDER_REVIEW', event: null },
    requestMoreInfo: INVALID,
    resubmit: INVALID,
    approve: INVALID,
    reject: INVALID,
    markStep: stay('SUBMITTED'),
    recordCccdNumber: stay('SUBMITTED'),
  },
  UNDER_REVIEW: {
    submit: INVALID,
    assignReviewer: stay('UNDER_REVIEW'),
    requestMoreInfo: { to: 'NEEDS_MORE_INFO', event: 'KycMoreInfoRequested' },
    resubmit: INVALID,
    approve: { to: 'APPROVED', event: 'KycApproved' },
    reject: { to: 'REJECTED', event: 'KycRejected' },
    markStep: stay('UNDER_REVIEW'),
    recordCccdNumber: stay('UNDER_REVIEW'),
  },
  NEEDS_MORE_INFO: {
    submit: INVALID,
    assignReviewer: stay('NEEDS_MORE_INFO'),
    requestMoreInfo: INVALID,
    resubmit: { to: 'UNDER_REVIEW', event: 'KycSubmitted' },
    approve: INVALID,
    reject: { to: 'REJECTED', event: 'KycRejected' },
    markStep: stay('NEEDS_MORE_INFO'),
    recordCccdNumber: stay('NEEDS_MORE_INFO'),
  },
  APPROVED: {
    submit: DECIDED,
    assignReviewer: DECIDED,
    requestMoreInfo: DECIDED,
    resubmit: DECIDED,
    approve: DECIDED,
    reject: DECIDED,
    markStep: DECIDED,
    recordCccdNumber: DECIDED,
  },
  REJECTED: {
    submit: DECIDED,
    assignReviewer: DECIDED,
    requestMoreInfo: DECIDED,
    resubmit: DECIDED,
    approve: DECIDED,
    reject: DECIDED,
    markStep: DECIDED,
    recordCccdNumber: DECIDED,
  },
};

const cases = Object.entries(MATRIX).flatMap(([from, actions]) =>
  Object.entries(actions).map(([action, expected]) => ({ from: from as KycStatus, action: action as Action, expected })),
);

describe('KycSubmission — ma trận chuyển trạng thái', () => {
  it.each(cases)('$from × $action', ({ from, action, expected }) => {
    const s = inStatus(from);
    const before = s.toState();
    const result = run(s, action);

    if ('error' in expected) {
      expect(result.isErr() && result.error.code).toBe(expected.error);
      expect(s.toState()).toEqual(before);
      expect(s.pullEvents()).toEqual([]);
      return;
    }
    expect(result.isOk()).toBe(true);
    expect(s.status).toBe(expected.to);
    const events = s.pullEvents();
    if (expected.event === null) {
      expect(events).toEqual([]);
      expect(s.version).toBe(before.version);
    } else {
      expect(events.map((e) => e.type)).toEqual([expected.event]);
      expect(events[0]?.version).toBe(before.version + 1);
      expect(s.version).toBe(before.version + 1);
    }
  });
});

describe('KycSubmission — luật nghiệp vụ', () => {
  it('starts as DRAFT with all 4 steps PENDING and no events', () => {
    const s = draft();
    expect(s.status).toBe('DRAFT');
    expect(Object.keys(s.steps)).toEqual([...KYC_STEPS]);
    for (const step of KYC_STEPS) expect(s.steps[step]).toEqual({ status: 'PENDING', decidedAt: null });
    expect(s.version).toBe(0);
    expect(s.pullEvents()).toEqual([]);
  });

  it('approve with an unpassed step returns KYC_STEPS_INCOMPLETE listing pending and failed steps (AC1)', () => {
    const s = draft();
    unwrap(s.markStep('CCCD_CHIP', 'PASSED', at(1)));
    unwrap(s.markStep('MARITAL_STATUS', 'FAILED', at(1)));
    unwrap(s.submit(at(2)));
    unwrap(s.assignReviewer(REVIEWER, at(3)));
    s.pullEvents();

    const result = s.approve(REVIEWER, at(4));
    expect(result.isErr() && result.error).toEqual({
      code: 'KYC_STEPS_INCOMPLETE',
      details: { steps: ['MARITAL_STATUS', 'MANUAL_REVIEW', 'INTERVIEW'] },
    });
    expect(s.status).toBe('UNDER_REVIEW');
    expect(s.pullEvents()).toEqual([]);
  });

  it.each(KYC_STEPS)('approve is blocked when only %s is not passed (AC1)', (missing) => {
    const s = inStatus('UNDER_REVIEW');
    unwrap(s.markStep(missing, 'FAILED', at(5)));
    const result = s.approve(REVIEWER, at(6));
    expect(result.isErr() && result.error).toEqual({ code: 'KYC_STEPS_INCOMPLETE', details: { steps: [missing] } });
  });

  it('a failed step can be re-marked PASSED before decision, then approve succeeds', () => {
    const s = inStatus('UNDER_REVIEW');
    unwrap(s.markStep('INTERVIEW', 'FAILED', at(5)));
    unwrap(s.markStep('INTERVIEW', 'PASSED', at(6)));
    expect(s.steps.INTERVIEW).toEqual({ status: 'PASSED', decidedAt: at(6) });
    expect(s.approve(REVIEWER, at(7)).isOk()).toBe(true);
  });

  it('approve records decision metadata and emits KycApproved without PII (AC3)', () => {
    const s = inStatus('UNDER_REVIEW');
    unwrap(s.approve(REVIEWER, at(5)));
    const state = s.toState();
    expect(state).toMatchObject({ status: 'APPROVED', decidedBy: REVIEWER, decidedAt: at(5), updatedAt: at(5) });
    const [event] = s.pullEvents() as [DomainEvent];
    expect(event).toMatchObject({
      type: 'KycApproved',
      aggregateType: 'KycSubmission',
      aggregateId: s.id,
      occurredAt: at(5),
      payload: { submissionId: s.id, userId: USER_ID },
    });
  });

  it('reject stores the reason, emits KycRejected with reason code only (AC2, AC3)', () => {
    const s = inStatus('UNDER_REVIEW');
    unwrap(s.reject(reason('OTHER', 'Ghi chú nội bộ có tên riêng'), REVIEWER, at(5)));
    const state = s.toState();
    expect(state.status).toBe('REJECTED');
    expect(state.rejectionReason).toMatchObject({ code: 'OTHER', note: 'Ghi chú nội bộ có tên riêng' });
    expect(state).toMatchObject({ decidedBy: REVIEWER, decidedAt: at(5) });
    const [event] = s.pullEvents() as [DomainEvent];
    expect(event.type).toBe('KycRejected');
    expect(event.payload).toEqual({ submissionId: s.id, userId: USER_ID, reasonCode: 'OTHER' });
    expect(JSON.stringify(event.payload)).not.toContain('Ghi chú');
  });

  it('reject does not require all steps to pass', () => {
    const s = draft();
    unwrap(s.submit(at(1)));
    unwrap(s.assignReviewer(REVIEWER, at(2)));
    expect(s.reject(reason(), REVIEWER, at(3)).isOk()).toBe(true);
  });

  it('after REJECTED no other transition is possible (AC2)', () => {
    const s = inStatus('REJECTED');
    const results = [
      s.submit(NOW),
      s.assignReviewer(REVIEWER, NOW),
      s.requestMoreInfo({ items: ['SELFIE'] }, NOW),
      s.resubmit(NOW),
      s.approve(REVIEWER, NOW),
      s.reject(reason(), REVIEWER, NOW),
      s.markStep('CCCD_CHIP', 'PASSED', NOW),
    ];
    for (const r of results) expect(r.isErr() && r.error.code).toBe('KYC_ALREADY_DECIDED');
    expect(s.status).toBe('REJECTED');
  });

  it('submit emits KycSubmitted with resubmission=false; resubmit emits resubmission=true (AC3)', () => {
    const s = draft();
    unwrap(s.submit(at(1)));
    expect(s.toState().submittedAt).toEqual(at(1));
    unwrap(s.assignReviewer(REVIEWER, at(2)));
    unwrap(s.requestMoreInfo({ items: ['SELFIE'] }, at(3)));
    unwrap(s.resubmit(at(4)));
    const events = s.pullEvents();
    expect(events.map((e) => [e.type, e.payload, e.version])).toEqual([
      ['KycSubmitted', { submissionId: s.id, userId: USER_ID, resubmission: false }, 1],
      ['KycMoreInfoRequested', { submissionId: s.id, userId: USER_ID, items: ['SELFIE'] }, 2],
      ['KycSubmitted', { submissionId: s.id, userId: USER_ID, resubmission: true }, 3],
    ]);
    expect(s.status).toBe('UNDER_REVIEW');
    expect(s.toState().moreInfoRequest).toBeNull();
  });

  it('NEEDS_MORE_INFO ↔ UNDER_REVIEW can loop several times', () => {
    const s = inStatus('UNDER_REVIEW');
    for (let i = 0; i < 3; i += 1) {
      unwrap(s.requestMoreInfo({ items: ['MARITAL_STATUS_CERTIFICATE'] }, at(10 + i)));
      unwrap(s.resubmit(at(20 + i)));
    }
    expect(s.status).toBe('UNDER_REVIEW');
    expect(s.pullEvents()).toHaveLength(6);
  });

  it('requestMoreInfo requires at least one item, de-duplicates items and keeps the note out of the event', () => {
    const s = inStatus('UNDER_REVIEW');
    const empty = s.requestMoreInfo({ items: [] }, at(5));
    expect(empty.isErr() && empty.error.code).toBe('KYC_MORE_INFO_ITEMS_REQUIRED');
    expect(s.status).toBe('UNDER_REVIEW');

    unwrap(s.requestMoreInfo({ items: ['SELFIE', 'SELFIE', 'CCCD_BACK'], note: '  Chụp lại rõ hơn  ' }, at(6)));
    expect(s.toState().moreInfoRequest).toEqual({
      items: ['SELFIE', 'CCCD_BACK'],
      note: 'Chụp lại rõ hơn',
      requestedAt: at(6),
    });
    const [event] = s.pullEvents() as [DomainEvent];
    expect(event.payload).toEqual({ submissionId: s.id, userId: USER_ID, items: ['SELFIE', 'CCCD_BACK'] });
  });

  it('assignReviewer moves SUBMITTED to UNDER_REVIEW and allows reassignment', () => {
    const s = inStatus('SUBMITTED');
    unwrap(s.assignReviewer(REVIEWER, at(5)));
    expect(s.toState()).toMatchObject({ status: 'UNDER_REVIEW', reviewerId: REVIEWER });
    unwrap(s.assignReviewer(OTHER_REVIEWER, at(6)));
    expect(s.toState()).toMatchObject({ status: 'UNDER_REVIEW', reviewerId: OTHER_REVIEWER, updatedAt: at(6) });
  });

  it('recordCccdNumber keeps the number in state but never in events', () => {
    const s = draft();
    const cccd = unwrap(CccdNumber.parse('001090012345'));
    unwrap(s.recordCccdNumber(cccd, at(1)));
    unwrap(s.submit(at(2)));
    expect(s.toState().cccdNumber?.value).toBe('001090012345');
    expect(JSON.stringify(s.pullEvents())).not.toContain('001090012345');
  });

  it('restore(toState()) round-trips state and version without pending events', () => {
    const s = inStatus('NEEDS_MORE_INFO');
    unwrap(s.recordCccdNumber(unwrap(CccdNumber.parse('079200000001')), at(9)));
    const restored = KycSubmission.restore(s.toState());
    expect(restored.toState()).toEqual(s.toState());
    expect(restored.version).toBe(s.version);
    expect(restored.pullEvents()).toEqual([]);
    unwrap(restored.resubmit(at(11)));
    expect(restored.pullEvents()[0]?.version).toBe(s.version + 1);
  });
});
