import type { DatePlanDto } from '@tamgiao/contracts/dating';

export type DateViewKind =
  | 'none'
  | 'proposed_inviter'
  | 'proposed_invitee'
  | 'proposed_expired'
  | 'confirmed'
  | 'in_progress'
  | 'awaiting_feedback'
  | 'completed'
  | 'ended';

export interface DateView {
  readonly kind: DateViewKind;
  readonly canRespond: boolean;
  readonly canCancel: boolean;
  readonly cancelLocked: boolean;
  readonly canProposeNew: boolean;
}

/**
 * Phân giải trạng thái hiển thị và quyền thao tác của lịch hẹn theo thời gian thực (được inject `now`).
 */
export function dateViewFor(plan: DatePlanDto | null, now: Date): DateView {
  if (plan === null) {
    return {
      kind: 'none',
      canRespond: false,
      canCancel: false,
      cancelLocked: false,
      canProposeNew: true,
    };
  }

  const nowMs = now.getTime();

  switch (plan.status) {
    case 'PROPOSED': {
      const expiresAtMs = new Date(plan.expiresAt).getTime();
      if (nowMs < expiresAtMs) {
        if (plan.myRole === 'INVITEE') {
          return {
            kind: 'proposed_invitee',
            canRespond: true,
            canCancel: false,
            cancelLocked: false,
            canProposeNew: false,
          };
        }
        return {
          kind: 'proposed_inviter',
          canRespond: false,
          canCancel: false,
          cancelLocked: false,
          canProposeNew: false,
        };
      }
      return {
        kind: 'proposed_expired',
        canRespond: false,
        canCancel: false,
        cancelLocked: false,
        canProposeNew: false,
      };
    }

    case 'CONFIRMED': {
      const startsAtMs = new Date(plan.startsAt).getTime();
      const endsAtMs = new Date(plan.endsAt).getTime();
      const cancelDeadlineMs = new Date(plan.cancelDeadline).getTime();

      if (nowMs < startsAtMs) {
        const canCancel = nowMs <= cancelDeadlineMs;
        return {
          kind: 'confirmed',
          canRespond: false,
          canCancel,
          cancelLocked: !canCancel,
          canProposeNew: false,
        };
      }

      if (nowMs <= endsAtMs) {
        return {
          kind: 'in_progress',
          canRespond: false,
          canCancel: false,
          cancelLocked: false,
          canProposeNew: false,
        };
      }

      return {
        kind: 'awaiting_feedback',
        canRespond: false,
        canCancel: false,
        cancelLocked: false,
        canProposeNew: false,
      };
    }

    case 'CHECKED_IN': {
      const endsAtMs = new Date(plan.endsAt).getTime();
      if (nowMs <= endsAtMs) {
        return {
          kind: 'in_progress',
          canRespond: false,
          canCancel: false,
          cancelLocked: false,
          canProposeNew: false,
        };
      }
      return {
        kind: 'awaiting_feedback',
        canRespond: false,
        canCancel: false,
        cancelLocked: false,
        canProposeNew: false,
      };
    }

    case 'COMPLETED': {
      return {
        kind: 'completed',
        canRespond: false,
        canCancel: false,
        cancelLocked: false,
        canProposeNew: false,
      };
    }

    case 'DECLINED':
    case 'EXPIRED':
    case 'CANCELLED': {
      return {
        kind: 'ended',
        canRespond: false,
        canCancel: false,
        cancelLocked: false,
        canProposeNew: true,
      };
    }
  }
}
