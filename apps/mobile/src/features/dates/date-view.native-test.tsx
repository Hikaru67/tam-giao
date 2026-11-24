import type { DatePlanDto, DatePlanStatusName } from '@tamgiao/contracts/dating';
import { dateViewFor, type DateViewKind } from './date-view.js';

const BASE_PLAN: DatePlanDto = {
  id: '01890a5d-ac96-774b-bcce-b302099a8001',
  matchId: '01890a5d-ac96-774b-bcce-b302099a8002',
  inviterId: '01890a5d-ac96-774b-bcce-b302099a8003',
  inviteeId: '01890a5d-ac96-774b-bcce-b302099a8004',
  myRole: 'INVITER',
  partnerId: '01890a5d-ac96-774b-bcce-b302099a8005',
  startsAt: '2026-11-25T10:00:00.000Z',
  endsAt: '2026-11-25T12:00:00.000Z',
  staffBookingRequested: false,
  status: 'PROPOSED',
  expiresAt: '2026-11-24T12:00:00.000Z',
  proposedAt: '2026-11-23T12:00:00.000Z',
  respondedAt: null,
  cancelledAt: null,
  cancelledBy: null,
  cancelDeadline: '2026-11-25T06:00:00.000Z',
};

describe('date-view (FE-S5-01)', () => {
  it('returns none view when plan is null', () => {
    const view = dateViewFor(null, new Date('2026-11-24T10:00:00.000Z'));
    expect(view).toEqual({
      kind: 'none',
      canRespond: false,
      canCancel: false,
      cancelLocked: false,
      canProposeNew: true,
    });
  });

  describe('7 statuses × 2 roles matrix', () => {
    interface TestCase {
      status: DatePlanStatusName;
      role: 'INVITER' | 'INVITEE';
      nowIso: string;
      expectedKind: DateViewKind;
      canRespond: boolean;
      canCancel: boolean;
      cancelLocked: boolean;
      canProposeNew: boolean;
    }

    const testCases: TestCase[] = [
      // PROPOSED: now < expiresAt
      {
        status: 'PROPOSED',
        role: 'INVITER',
        nowIso: '2026-11-24T10:00:00.000Z',
        expectedKind: 'proposed_inviter',
        canRespond: false,
        canCancel: false,
        cancelLocked: false,
        canProposeNew: false,
      },
      {
        status: 'PROPOSED',
        role: 'INVITEE',
        nowIso: '2026-11-24T10:00:00.000Z',
        expectedKind: 'proposed_invitee',
        canRespond: true,
        canCancel: false,
        cancelLocked: false,
        canProposeNew: false,
      },
      // PROPOSED: now >= expiresAt
      {
        status: 'PROPOSED',
        role: 'INVITER',
        nowIso: '2026-11-24T12:00:00.000Z',
        expectedKind: 'proposed_expired',
        canRespond: false,
        canCancel: false,
        cancelLocked: false,
        canProposeNew: false,
      },
      {
        status: 'PROPOSED',
        role: 'INVITEE',
        nowIso: '2026-11-24T13:00:00.000Z',
        expectedKind: 'proposed_expired',
        canRespond: false,
        canCancel: false,
        cancelLocked: false,
        canProposeNew: false,
      },
      // CONFIRMED: now < cancelDeadline
      {
        status: 'CONFIRMED',
        role: 'INVITER',
        nowIso: '2026-11-25T05:00:00.000Z',
        expectedKind: 'confirmed',
        canRespond: false,
        canCancel: true,
        cancelLocked: false,
        canProposeNew: false,
      },
      {
        status: 'CONFIRMED',
        role: 'INVITEE',
        nowIso: '2026-11-25T05:00:00.000Z',
        expectedKind: 'confirmed',
        canRespond: false,
        canCancel: true,
        cancelLocked: false,
        canProposeNew: false,
      },
      // CONFIRMED: cancelDeadline < now < startsAt (AC2: cutoff locked)
      {
        status: 'CONFIRMED',
        role: 'INVITER',
        nowIso: '2026-11-25T07:00:00.000Z',
        expectedKind: 'confirmed',
        canRespond: false,
        canCancel: false,
        cancelLocked: true,
        canProposeNew: false,
      },
      {
        status: 'CONFIRMED',
        role: 'INVITEE',
        nowIso: '2026-11-25T07:00:00.000Z',
        expectedKind: 'confirmed',
        canRespond: false,
        canCancel: false,
        cancelLocked: true,
        canProposeNew: false,
      },
      // CONFIRMED: startsAt <= now <= endsAt
      {
        status: 'CONFIRMED',
        role: 'INVITER',
        nowIso: '2026-11-25T10:30:00.000Z',
        expectedKind: 'in_progress',
        canRespond: false,
        canCancel: false,
        cancelLocked: false,
        canProposeNew: false,
      },
      {
        status: 'CONFIRMED',
        role: 'INVITEE',
        nowIso: '2026-11-25T11:00:00.000Z',
        expectedKind: 'in_progress',
        canRespond: false,
        canCancel: false,
        cancelLocked: false,
        canProposeNew: false,
      },
      // CONFIRMED: now > endsAt
      {
        status: 'CONFIRMED',
        role: 'INVITER',
        nowIso: '2026-11-25T13:00:00.000Z',
        expectedKind: 'awaiting_feedback',
        canRespond: false,
        canCancel: false,
        cancelLocked: false,
        canProposeNew: false,
      },
      {
        status: 'CONFIRMED',
        role: 'INVITEE',
        nowIso: '2026-11-25T13:00:00.000Z',
        expectedKind: 'awaiting_feedback',
        canRespond: false,
        canCancel: false,
        cancelLocked: false,
        canProposeNew: false,
      },
      // CHECKED_IN: now <= endsAt
      {
        status: 'CHECKED_IN',
        role: 'INVITER',
        nowIso: '2026-11-25T10:30:00.000Z',
        expectedKind: 'in_progress',
        canRespond: false,
        canCancel: false,
        cancelLocked: false,
        canProposeNew: false,
      },
      {
        status: 'CHECKED_IN',
        role: 'INVITEE',
        nowIso: '2026-11-25T12:00:00.000Z',
        expectedKind: 'in_progress',
        canRespond: false,
        canCancel: false,
        cancelLocked: false,
        canProposeNew: false,
      },
      // CHECKED_IN: now > endsAt
      {
        status: 'CHECKED_IN',
        role: 'INVITER',
        nowIso: '2026-11-25T12:00:01.000Z',
        expectedKind: 'awaiting_feedback',
        canRespond: false,
        canCancel: false,
        cancelLocked: false,
        canProposeNew: false,
      },
      {
        status: 'CHECKED_IN',
        role: 'INVITEE',
        nowIso: '2026-11-25T12:00:01.000Z',
        expectedKind: 'awaiting_feedback',
        canRespond: false,
        canCancel: false,
        cancelLocked: false,
        canProposeNew: false,
      },
      // COMPLETED
      {
        status: 'COMPLETED',
        role: 'INVITER',
        nowIso: '2026-11-25T14:00:00.000Z',
        expectedKind: 'completed',
        canRespond: false,
        canCancel: false,
        cancelLocked: false,
        canProposeNew: false,
      },
      {
        status: 'COMPLETED',
        role: 'INVITEE',
        nowIso: '2026-11-25T14:00:00.000Z',
        expectedKind: 'completed',
        canRespond: false,
        canCancel: false,
        cancelLocked: false,
        canProposeNew: false,
      },
      // DECLINED
      {
        status: 'DECLINED',
        role: 'INVITER',
        nowIso: '2026-11-24T10:00:00.000Z',
        expectedKind: 'ended',
        canRespond: false,
        canCancel: false,
        cancelLocked: false,
        canProposeNew: true,
      },
      {
        status: 'DECLINED',
        role: 'INVITEE',
        nowIso: '2026-11-24T10:00:00.000Z',
        expectedKind: 'ended',
        canRespond: false,
        canCancel: false,
        cancelLocked: false,
        canProposeNew: true,
      },
      // EXPIRED
      {
        status: 'EXPIRED',
        role: 'INVITER',
        nowIso: '2026-11-24T15:00:00.000Z',
        expectedKind: 'ended',
        canRespond: false,
        canCancel: false,
        cancelLocked: false,
        canProposeNew: true,
      },
      {
        status: 'EXPIRED',
        role: 'INVITEE',
        nowIso: '2026-11-24T15:00:00.000Z',
        expectedKind: 'ended',
        canRespond: false,
        canCancel: false,
        cancelLocked: false,
        canProposeNew: true,
      },
      // CANCELLED
      {
        status: 'CANCELLED',
        role: 'INVITER',
        nowIso: '2026-11-25T05:00:00.000Z',
        expectedKind: 'ended',
        canRespond: false,
        canCancel: false,
        cancelLocked: false,
        canProposeNew: true,
      },
      {
        status: 'CANCELLED',
        role: 'INVITEE',
        nowIso: '2026-11-25T05:00:00.000Z',
        expectedKind: 'ended',
        canRespond: false,
        canCancel: false,
        cancelLocked: false,
        canProposeNew: true,
      },
    ];

    it.each(testCases)(
      'returns $expectedKind for status $status, role $role at $nowIso',
      ({ status, role, nowIso, expectedKind, canRespond, canCancel, cancelLocked, canProposeNew }) => {
        const plan: DatePlanDto = {
          ...BASE_PLAN,
          status,
          myRole: role,
        };
        const view = dateViewFor(plan, new Date(nowIso));
        expect(view).toEqual({
          kind: expectedKind,
          canRespond,
          canCancel,
          cancelLocked,
          canProposeNew,
        });
      },
    );
  });

  describe('AC2: exact cancelDeadline boundary', () => {
    it('allows cancel when now is exactly at cancelDeadline (now <= cancelDeadline)', () => {
      const plan: DatePlanDto = {
        ...BASE_PLAN,
        status: 'CONFIRMED',
        cancelDeadline: '2026-11-25T06:00:00.000Z',
      };
      // Exactly at 06:00:00.000Z
      const view = dateViewFor(plan, new Date('2026-11-25T06:00:00.000Z'));
      expect(view.canCancel).toBe(true);
      expect(view.cancelLocked).toBe(false);
    });

    it('locks cancel when now is 1 millisecond past cancelDeadline', () => {
      const plan: DatePlanDto = {
        ...BASE_PLAN,
        status: 'CONFIRMED',
        cancelDeadline: '2026-11-25T06:00:00.000Z',
      };
      const view = dateViewFor(plan, new Date('2026-11-25T06:00:00.001Z'));
      expect(view.canCancel).toBe(false);
      expect(view.cancelLocked).toBe(true);
    });
  });
});
