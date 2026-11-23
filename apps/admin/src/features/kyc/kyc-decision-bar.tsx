import { useState } from 'react';
import type {
  KycAdminDetailResponse,
  KycRejectBody,
  KycRequestMoreInfoBody,
} from '@tamgiao/contracts/verification';
import { Button } from '@tamgiao/ui-web';
import { KYC_COPY } from './copy';
import type { KycDecisionInput } from './kyc-api';
import { KycMoreInfoDialog } from './kyc-more-info-dialog';
import { KycRejectDialog } from './kyc-reject-dialog';

export interface KycDecisionBarProps {
  readonly detail: KycAdminDetailResponse;
  readonly meAdminId: string;
  readonly canDecide: boolean;
  readonly pending: boolean;
  readonly onDecision: (input: KycDecisionInput, onDone?: () => void) => void;
}

export function KycDecisionBar({ detail, meAdminId, canDecide, pending, onDecision }: KycDecisionBarProps) {
  const [rejectOpen, setRejectOpen] = useState(false);
  const [moreInfoOpen, setMoreInfoOpen] = useState(false);

  const isDecided = detail.status === 'APPROVED' || detail.status === 'REJECTED';
  const isOpen =
    detail.status === 'SUBMITTED' || detail.status === 'UNDER_REVIEW' || detail.status === 'NEEDS_MORE_INFO';

  const canAssign = isOpen && detail.reviewerId !== meAdminId;
  const isAllStepsPassed = detail.steps.length > 0 && detail.steps.every((s) => s.status === 'PASSED');

  const canApprove = detail.status === 'UNDER_REVIEW' && isAllStepsPassed;
  const showApproveHint = detail.status === 'UNDER_REVIEW' && !isAllStepsPassed;

  if (isDecided) {
    return (
      <section
        aria-label={KYC_COPY.decisions.barLabel}
        className="border-t border-surface-container-high pt-space-md flex flex-wrap items-center gap-space-sm"
      >
        <p className="text-body-md text-secondary font-medium">{KYC_COPY.decisions.decided}</p>
      </section>
    );
  }

  return (
    <section
      aria-label={KYC_COPY.decisions.barLabel}
      className="border-t border-surface-container-high pt-space-md flex flex-wrap items-center gap-space-sm"
    >
      {canAssign ? (
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() => onDecision({ kind: 'assign' })}
        >
          {detail.reviewerId === null ? KYC_COPY.decisions.assign : KYC_COPY.decisions.reassign}
        </Button>
      ) : null}

      {!canDecide ? (
        <p className="text-body-sm text-secondary font-medium">{KYC_COPY.decisions.noDecidePermission}</p>
      ) : (
        <>
          <Button
            type="button"
            variant="secondary"
            disabled={pending || detail.status !== 'UNDER_REVIEW'}
            onClick={() => setMoreInfoOpen(true)}
          >
            {KYC_COPY.decisions.requestMoreInfo}
          </Button>

          <Button
            type="button"
            variant="danger"
            disabled={pending || (detail.status !== 'UNDER_REVIEW' && detail.status !== 'NEEDS_MORE_INFO')}
            onClick={() => setRejectOpen(true)}
          >
            {KYC_COPY.decisions.reject}
          </Button>

          <Button
            type="button"
            variant="primary"
            disabled={pending || !canApprove}
            onClick={() => onDecision({ kind: 'approve' })}
          >
            {KYC_COPY.decisions.approve}
          </Button>

          {showApproveHint ? (
            <p className="text-body-sm text-secondary">{KYC_COPY.decisions.approveHint}</p>
          ) : null}

          <KycRejectDialog
            open={rejectOpen}
            pending={pending}
            onClose={() => setRejectOpen(false)}
            onSubmit={(body: KycRejectBody) =>
              onDecision({ kind: 'reject', body }, () => setRejectOpen(false))
            }
          />

          <KycMoreInfoDialog
            open={moreInfoOpen}
            pending={pending}
            onClose={() => setMoreInfoOpen(false)}
            onSubmit={(body: KycRequestMoreInfoBody) =>
              onDecision({ kind: 'requestMoreInfo', body }, () => setMoreInfoOpen(false))
            }
          />
        </>
      )}
    </section>
  );
}
