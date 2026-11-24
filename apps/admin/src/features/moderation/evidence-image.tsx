import { useEffect, useState, type SyntheticEvent } from 'react';
import { Button } from '@tamgiao/ui-web';
import { MODERATION_COPY } from './copy';
import { presignedEvidenceDeadlineMs } from './moderation-api';

export interface EvidenceImageProps {
  readonly label: string;
  readonly item: {
    readonly key: string;
    readonly url: string;
    readonly expiresAt: string;
  };
  readonly fetchedAt: number;
  readonly onRequestNewUrl: () => void;
}

const preventDefault = (e: SyntheticEvent) => {
  e.preventDefault();
};

export function EvidenceImage({ label, item, fetchedAt, onRequestNewUrl }: EvidenceImageProps) {
  const url = item.url;
  const deadline = presignedEvidenceDeadlineMs(item, fetchedAt);
  const [expiredUrl, setExpiredUrl] = useState<string | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  useEffect(() => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      setExpiredUrl(url);
      return;
    }
    const timer = setTimeout(() => {
      setExpiredUrl(url);
    }, remaining);
    return () => {
      clearTimeout(timer);
    };
  }, [url, deadline]);

  const frame =
    'aspect-[4/3] w-full rounded-lg bg-surface-container-low border border-surface-container-high flex items-center justify-center overflow-hidden';

  let body;
  if (expiredUrl === url) {
    body = (
      <div className="flex flex-col items-center gap-space-xs p-space-sm">
        <p role="status" className="text-body-sm text-secondary text-center">
          {MODERATION_COPY.detail.evidenceExpired}
        </p>
        <Button variant="ghost" onClick={onRequestNewUrl}>
          {MODERATION_COPY.detail.evidenceRetry}
        </Button>
      </div>
    );
  } else if (failedUrl === url) {
    body = (
      <div className="flex flex-col items-center gap-space-xs p-space-sm">
        <p className="text-body-sm text-error text-center">{MODERATION_COPY.detail.evidenceLoadFailed}</p>
        <Button variant="ghost" onClick={onRequestNewUrl}>
          {MODERATION_COPY.detail.evidenceRetry}
        </Button>
      </div>
    );
  } else {
    body = (
      <img
        key={url}
        src={url}
        alt={label}
        referrerPolicy="no-referrer"
        draggable={false}
        onDragStart={preventDefault}
        onContextMenu={preventDefault}
        onError={() => {
          setFailedUrl(url);
        }}
        className="h-full w-full object-contain select-none"
      />
    );
  }

  return (
    <figure className="flex flex-col gap-space-xs">
      <div className={frame}>{body}</div>
      <figcaption className="text-label-md text-on-surface truncate">{label}</figcaption>
    </figure>
  );
}
