import { useEffect, useState } from 'react';
import { SAFETY_RESPONSE_SLA_MINUTES } from '@tamgiao/contracts/constants';
import { Badge, Countdown } from '@tamgiao/ui-web';
import { MODERATION_COPY } from './copy';
import { slaState, type SlaTarget } from './sla';

export interface SlaBadgeProps {
  readonly report: SlaTarget;
}

export function SlaBadge({ report }: SlaBadgeProps) {
  const [now, setNow] = useState(() => Date.now());
  const state = slaState(report, now);

  useEffect(() => {
    setNow(Date.now());
  }, [report]);

  if (state.kind === 'none') {
    return null;
  }

  if (state.kind === 'overdue') {
    return (
      <Badge tone="danger" role="alert" data-testid="sla-overdue">
        {MODERATION_COPY.slaOverdue(SAFETY_RESPONSE_SLA_MINUTES)}
      </Badge>
    );
  }

  return (
    <Badge tone="warning">
      <Countdown
        key={state.dueAt}
        expiresAt={state.dueAt}
        prefixText={MODERATION_COPY.slaRemaining}
        onExpire={() => {
          setNow(Date.now());
        }}
      />
    </Badge>
  );
}
