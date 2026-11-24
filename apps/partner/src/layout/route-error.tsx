import type { ErrorComponentProps } from '@tanstack/react-router';
import { useRouter } from '@tanstack/react-router';
import { isApiError, messageFor } from '@tamgiao/api-client';
import { InactivePartnerScreen } from '../features/auth/inactive-partner-screen';
import { ErrorState } from '@tamgiao/ui-web';

export function RouteError({ error }: ErrorComponentProps) {
  const router = useRouter();
  if (isApiError(error) && error.code === 'PARTNER_INACTIVE') return <InactivePartnerScreen />;

  const errMessage = messageFor(isApiError(error) ? error : { code: 'UNKNOWN' });
  return (
    <ErrorState
      title={errMessage.title}
      onRetry={() => {
        void router.invalidate();
      }}
    />
  );
}
