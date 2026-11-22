import { EmptyState } from '@tamgiao/ui-web';
import { COMING_SOON_COPY } from './copy';

export function ComingSoonPage({ title }: { title: string }) {
  return (
    <div className="flex flex-col gap-space-lg">
      <h1 className="text-headline-md font-bold text-on-surface">{title}</h1>
      <EmptyState title={COMING_SOON_COPY.title} description={COMING_SOON_COPY.description} />
    </div>
  );
}
