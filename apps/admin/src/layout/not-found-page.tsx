import { Link } from '@tanstack/react-router';
import { EmptyState } from '@tamgiao/ui-web';
import { NOT_FOUND_COPY } from './copy';

export function NotFoundPage() {
  return (
    <EmptyState
      title={NOT_FOUND_COPY.title}
      action={
        <Link
          to="/"
          className="inline-flex items-center justify-center gap-space-xs font-semibold px-space-md py-space-xs text-label-md min-h-[40px] rounded-md bg-secondary-container text-on-secondary-container hover:bg-secondary-fixed-dim active:opacity-90"
        >
          {NOT_FOUND_COPY.backHome}
        </Link>
      }
    />
  );
}
