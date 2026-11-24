import { Button } from '@tamgiao/ui-web';
import { SCAN_COPY } from './copy';
import { usePartnerLogout } from './use-partner-auth';

/** Quán đã tắt hoặc tài khoản nhân viên bị vô hiệu hoá (`PARTNER_INACTIVE`): chỉ còn đăng xuất. */
export function InactivePartnerScreen() {
  const logoutMutation = usePartnerLogout();

  return (
    <div className="min-h-screen bg-surface flex flex-col items-center justify-center p-space-xl text-center">
      <div className="w-full max-w-md bg-surface-container-lowest p-space-xl rounded-xl border border-surface-container-high shadow-md flex flex-col items-center gap-space-md">
        <div className="w-16 h-16 rounded-full bg-error-container text-on-error-container flex items-center justify-center">
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
          </svg>
        </div>
        <h1 className="text-headline-sm font-bold text-on-surface">
          {SCAN_COPY.outcomes.inactivePartner.title}
        </h1>
        <p className="text-body-md text-secondary">{SCAN_COPY.outcomes.inactivePartner.description}</p>
        <Button
          variant="primary"
          size="lg"
          fullWidth
          loading={logoutMutation.isPending}
          onClick={() => logoutMutation.mutate()}
        >
          {SCAN_COPY.outcomes.inactivePartner.logoutAction}
        </Button>
      </div>
    </div>
  );
}
