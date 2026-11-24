import { useState } from 'react';
import { isApiError, messageFor } from '@tamgiao/api-client';
import { useApiClient } from '@tamgiao/api-client/react';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Card, ErrorState } from '@tamgiao/ui-web';
import { MODERATION_COPY, formatFlagReason } from './copy';
import { formatDateTime } from '../kyc/format';
import { flaggedDetailQueryOptions } from './moderation-api';
import { BanDialog } from './ban-dialog';

export interface FlaggedDetailPanelProps {
  readonly messageId: string;
}

export function FlaggedDetailPanel({ messageId }: FlaggedDetailPanelProps) {
  const client = useApiClient();
  const query = useQuery(flaggedDetailQueryOptions(client, messageId));
  const [banned, setBanned] = useState(false);
  const [banDialogOpen, setBanDialogOpen] = useState(false);

  if (query.data === undefined && query.isLoading) {
    return (
      <Card className="p-space-lg flex justify-center">
        <div aria-busy="true" className="text-body-sm text-secondary" />
      </Card>
    );
  }

  if (query.data === undefined && query.isError) {
    return (
      <Card>
        <ErrorState
          title={messageFor(isApiError(query.error) ? query.error : { code: 'UNKNOWN' }).title}
          action={MODERATION_COPY.detail.retry}
          onRetry={() => void query.refetch()}
        />
      </Card>
    );
  }

  if (query.data === undefined) {
    return null;
  }

  const message = query.data;

  return (
    <Card className="flex flex-col gap-space-lg">
      <div className="flex flex-wrap items-center justify-between gap-space-sm border-b border-surface-container-high pb-space-md">
        <h2 className="text-headline-sm font-bold text-on-surface">{MODERATION_COPY.flagged.title}</h2>
        <span className="text-body-sm text-secondary">
          {MODERATION_COPY.flagged.sentAt}: {formatDateTime(message.sentAt)}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-space-md p-space-md rounded-lg bg-surface-container-low border border-surface-container-high text-body-sm">
        <div>
          <span className="font-medium text-secondary">{MODERATION_COPY.flagged.sender}: </span>
          <span className="font-mono text-on-surface">{message.senderId}</span>
        </div>
        <div>
          <span className="font-medium text-secondary">{MODERATION_COPY.flagged.recipient}: </span>
          <span className="font-mono text-on-surface">{message.recipientId}</span>
        </div>
        <div>
          <span className="font-medium text-secondary">{MODERATION_COPY.flagged.conversationId}: </span>
          <span className="font-mono text-on-surface">{message.conversationId}</span>
        </div>
        <div>
          <span className="font-medium text-secondary">{MODERATION_COPY.matchId}: </span>
          <span className="font-mono text-on-surface">{message.matchId}</span>
        </div>
      </div>

      <div className="flex flex-col gap-space-xs">
        <h3 className="text-title-md font-semibold text-on-surface">{MODERATION_COPY.flagged.reasons}</h3>
        <div className="flex flex-wrap gap-space-xs">
          {message.reasons.map((reason) => (
            <Badge key={reason} tone="warning">
              {formatFlagReason(reason)}
            </Badge>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-space-xs">
        <h3 className="text-title-md font-semibold text-on-surface">
          {MODERATION_COPY.flagged.sectionMessage}
        </h3>
        {message.maskedBody !== null && message.maskedBody !== message.body ? (
          <div className="flex flex-col gap-space-sm">
            <div>
              <span className="text-label-md font-medium text-secondary">
                {MODERATION_COPY.flagged.maskedBody}:
              </span>
              <div className="mt-space-xs p-space-md rounded-lg bg-surface-container-low border border-surface-container-high text-body-md text-on-surface whitespace-pre-wrap">
                {message.maskedBody}
              </div>
            </div>
            <div>
              <span className="text-label-md font-medium text-secondary">
                {MODERATION_COPY.flagged.rawBody}:
              </span>
              <div className="mt-space-xs p-space-md rounded-lg bg-surface-container-lowest border border-surface-container-high text-body-md text-on-surface whitespace-pre-wrap">
                {message.body}
              </div>
            </div>
          </div>
        ) : (
          <div className="p-space-md rounded-lg bg-surface-container-lowest border border-surface-container-high text-body-md text-on-surface whitespace-pre-wrap">
            {message.body}
          </div>
        )}
      </div>

      {banned ? (
        <p
          role="alert"
          className="p-space-sm rounded-md bg-secondary-container text-on-secondary-container text-body-sm"
        >
          {MODERATION_COPY.detail.toasts.banSuccess}
        </p>
      ) : null}

      <div className="flex justify-end pt-space-md border-t border-surface-container-high">
        <Button variant="danger" onClick={() => setBanDialogOpen(true)}>
          {MODERATION_COPY.flagged.banSender}
        </Button>
      </div>

      <BanDialog
        open={banDialogOpen}
        onClose={() => setBanDialogOpen(false)}
        userId={message.senderId}
        onBanned={() => setBanned(true)}
      />
    </Card>
  );
}
