import { Button } from '@tamgiao/ui-web';
import { SCAN_COPY } from '../auth/copy';
import type { RedeemOutcome } from './redeem-result';

export interface ResultPanelProps {
  outcome: RedeemOutcome;
  /** Giá trị BE trả khi đổi thành công. */
  valueVnd: number | null;
  hadPriorNetworkError: boolean;
  onNextScan: () => void;
  onRetry?: (() => void) | undefined;
  isRetrying?: boolean | undefined;
}

export function ResultPanel({
  outcome,
  valueVnd,
  hadPriorNetworkError,
  onNextScan,
  onRetry,
  isRetrying = false,
}: ResultPanelProps) {
  if (outcome === 'success') {
    return (
      <div
        role="region"
        aria-label={SCAN_COPY.outcomes.success.title}
        className="fixed inset-0 z-50 flex flex-col justify-between p-space-xl bg-secondary-container text-on-secondary-container"
      >
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-space-md">
          <div className="w-20 h-20 rounded-full bg-secondary flex items-center justify-center text-on-secondary shadow-md">
            <svg
              width="40"
              height="40"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>

          <h1 className="text-headline-lg font-bold">{SCAN_COPY.outcomes.success.title}</h1>
          <span className="text-body-md opacity-80">{SCAN_COPY.outcomes.success.label}</span>
          {valueVnd !== null ? (
            <span className="text-display font-bold tracking-tight">{SCAN_COPY.formatVnd(valueVnd)}</span>
          ) : null}
        </div>

        <div className="w-full max-w-md mx-auto">
          <Button variant="primary" size="lg" fullWidth onClick={onNextScan}>
            {SCAN_COPY.actions.nextScan}
          </Button>
        </div>
      </div>
    );
  }

  if (outcome === 'not_active') {
    return (
      <div
        role="region"
        aria-label={SCAN_COPY.outcomes.notActive.title}
        className="fixed inset-0 z-50 flex flex-col justify-between p-space-xl bg-tertiary-fixed text-on-tertiary-fixed"
      >
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-space-md max-w-md mx-auto">
          <div className="w-20 h-20 rounded-full bg-tertiary flex items-center justify-center text-on-tertiary shadow-md">
            <svg
              width="36"
              height="36"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>

          <h1 className="text-headline-md font-bold">{SCAN_COPY.outcomes.notActive.title}</h1>
          <p className="text-body-md opacity-90">{SCAN_COPY.outcomes.notActive.description}</p>
        </div>

        <div className="w-full max-w-md mx-auto">
          <Button variant="primary" size="lg" fullWidth onClick={onNextScan}>
            {SCAN_COPY.actions.nextScan}
          </Button>
        </div>
      </div>
    );
  }

  if (outcome === 'network') {
    return (
      <div
        role="region"
        aria-label={SCAN_COPY.outcomes.network.title}
        className="fixed inset-0 z-50 flex flex-col justify-between p-space-xl bg-surface-container-high text-on-surface"
      >
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-space-md max-w-md mx-auto">
          <div className="w-20 h-20 rounded-full bg-secondary flex items-center justify-center text-on-secondary shadow-md">
            <svg
              width="36"
              height="36"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="1" y1="1" x2="23" y2="23" />
              <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
              <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
              <path d="M10.71 5.05A16 16 0 0 1 22.58 9" />
              <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
              <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
              <line x1="12" y1="20" x2="12.01" y2="20" />
            </svg>
          </div>

          <h1 className="text-headline-md font-bold">{SCAN_COPY.outcomes.network.title}</h1>
          <p className="text-body-md text-secondary">{SCAN_COPY.outcomes.network.description}</p>
        </div>

        <div className="w-full max-w-md mx-auto flex flex-col gap-space-sm">
          {onRetry ? (
            <Button variant="primary" size="lg" fullWidth loading={isRetrying} onClick={onRetry}>
              {SCAN_COPY.actions.retry}
            </Button>
          ) : null}
          <Button variant="ghost" size="lg" fullWidth onClick={onNextScan}>
            {SCAN_COPY.actions.nextScan}
          </Button>
        </div>
      </div>
    );
  }

  // Các trường hợp lỗi nghiệp vụ: already_redeemed, expired, wrong_partner, invalid_code, unknown
  let title: string = SCAN_COPY.outcomes.unknown.title;
  let description: string = SCAN_COPY.outcomes.unknown.description;

  if (outcome === 'already_redeemed') {
    title = SCAN_COPY.outcomes.alreadyRedeemed.title;
    description = SCAN_COPY.outcomes.alreadyRedeemed.description;
  } else if (outcome === 'expired') {
    title = SCAN_COPY.outcomes.expired.title;
    description = SCAN_COPY.outcomes.expired.description;
  } else if (outcome === 'wrong_partner') {
    title = SCAN_COPY.outcomes.wrongPartner.title;
    description = SCAN_COPY.outcomes.wrongPartner.description;
  } else if (outcome === 'invalid_code') {
    title = SCAN_COPY.outcomes.invalidCode.title;
    description = SCAN_COPY.outcomes.invalidCode.description;
  }

  return (
    <div
      role="region"
      aria-label={title}
      className="fixed inset-0 z-50 flex flex-col justify-between p-space-xl bg-error-container text-on-error-container"
    >
      <div className="flex-1 flex flex-col items-center justify-center text-center gap-space-md max-w-md mx-auto">
        <div className="w-20 h-20 rounded-full bg-error flex items-center justify-center text-on-error shadow-md">
          <svg
            width="36"
            height="36"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </div>

        <h1 className="text-headline-md font-bold">{title}</h1>
        <p className="text-body-md opacity-90">{description}</p>

        {outcome === 'already_redeemed' && hadPriorNetworkError ? (
          <div
            role="status"
            className="p-space-md rounded-xl bg-surface-container-lowest text-on-surface shadow-sm text-body-sm font-medium mt-space-sm border border-outline-variant"
          >
            {SCAN_COPY.outcomes.possiblePriorSuccess}
          </div>
        ) : null}
      </div>

      <div className="w-full max-w-md mx-auto">
        <Button variant="danger" size="lg" fullWidth onClick={onNextScan}>
          {SCAN_COPY.actions.nextScan}
        </Button>
      </div>
    </div>
  );
}
