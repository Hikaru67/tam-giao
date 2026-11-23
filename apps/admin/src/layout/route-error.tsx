import type { ErrorComponentProps } from '@tanstack/react-router';
import { useRouter } from '@tanstack/react-router';
import { isApiError, messageFor } from '@tamgiao/api-client';
import { ErrorState } from '@tamgiao/ui-web';
import { isForbiddenError } from '../features/auth/permissions';
import { ForbiddenPage } from './forbidden-page';

export function RouteError({ error }: ErrorComponentProps) {
  const router = useRouter();

  if (isForbiddenError(error) || (isApiError(error) && error.status === 403)) {
    return <ForbiddenPage />;
  }

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
