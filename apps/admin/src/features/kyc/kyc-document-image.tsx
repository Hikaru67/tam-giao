import { useEffect, useState, type SyntheticEvent } from 'react';
import type { KycAdminDetailResponse } from '@tamgiao/contracts/verification';
import { Button } from '@tamgiao/ui-web';
import { KYC_COPY } from './copy';
import { presignedDeadlineMs } from './kyc-api';

type PresignedDocument = KycAdminDetailResponse['documents']['cccdFront'];

export interface KycDocumentImageProps {
  readonly label: string;
  /** `null` = ảnh đã bị xoá theo thời hạn lưu. */
  readonly document: PresignedDocument;
  /** `dataUpdatedAt` của query chi tiết (ms) — mốc tính hạn URL. */
  readonly fetchedAt: number;
  /** Xin lại chi tiết để có URL mới (refetch query chi tiết). */
  readonly onRequestNewUrl: () => void;
}

const preventDefault = (e: SyntheticEvent) => {
  e.preventDefault();
};

/**
 * Ảnh giấy tờ eKYC (luật F5): `<img>` dùng thẳng URL presigned — không tải về blob / IndexedDB / Service Worker,
 * `referrerPolicy="no-referrer"` để URL không lọt qua header Referer. Quá hạn URL thì gỡ `<img>` (không giữ URL cũ)
 * cho tới khi query chi tiết trả URL mới. Chặn kéo-thả và menu chuột phải để hạn chế lưu ảnh.
 */
export function KycDocumentImage({ label, document, fetchedAt, onRequestNewUrl }: KycDocumentImageProps) {
  const url = document?.url ?? null;
  const deadline = document ? presignedDeadlineMs(document, fetchedAt) : null;
  const [expiredUrl, setExpiredUrl] = useState<string | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  useEffect(() => {
    if (url === null || deadline === null) return;
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
  if (url === null) {
    body = (
      <p className="text-body-sm text-secondary text-center p-space-sm">{KYC_COPY.detail.documentRemoved}</p>
    );
  } else if (expiredUrl === url) {
    body = (
      <p role="status" className="text-body-sm text-secondary text-center p-space-sm">
        {KYC_COPY.detail.documentExpired}
      </p>
    );
  } else if (failedUrl === url) {
    body = (
      <div className="flex flex-col items-center gap-space-xs p-space-sm">
        <p className="text-body-sm text-error text-center">{KYC_COPY.detail.documentLoadFailed}</p>
        <Button variant="ghost" onClick={onRequestNewUrl}>
          {KYC_COPY.detail.documentRetry}
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
      <figcaption className="text-label-md text-on-surface">{label}</figcaption>
    </figure>
  );
}
