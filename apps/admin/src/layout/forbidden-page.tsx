import { Link } from '@tanstack/react-router';
import { EmptyState } from '@tamgiao/ui-web';
import { FORBIDDEN_COPY } from './copy';

export function ForbiddenPage() {
  return (
    <EmptyState
      title={FORBIDDEN_COPY.title}
      description={FORBIDDEN_COPY.description}
      icon={<span className="text-headline-sm font-bold text-secondary">403</span>}
      action={
        <Link
          to="/"
          className="inline-flex items-center justify-center gap-space-xs font-semibold px-space-md py-space-xs text-label-md min-h-[40px] rounded-md bg-secondary-container text-on-secondary-container hover:bg-secondary-fixed-dim active:opacity-90"
        >
          {FORBIDDEN_COPY.backHome}
        </Link>
      }
    />
  );
}
