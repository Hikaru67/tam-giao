import { useState } from 'react';
import { isApiError, messageFor } from '@tamgiao/api-client';
import { useApiClient } from '@tamgiao/api-client/react';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Card, ErrorState, Modal } from '@tamgiao/ui-web';
import { formatDateTime } from '../kyc/format';
import { PARTNERS_COPY } from './copy';
import { PartnerFormDialog } from './partner-form-dialog';
import { partnerDetailQueryOptions, useUpdatePartner } from './partners-api';
import { StaffSection } from './staff-section';

export interface PartnerDetailPanelProps {
  readonly partnerId: string;
}

export function PartnerDetailPanel({ partnerId }: PartnerDetailPanelProps) {
  const client = useApiClient();
  const query = useQuery(partnerDetailQueryOptions(client, partnerId));
  const updateMutation = useUpdatePartner(partnerId);

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [toggleConfirmOpen, setToggleConfirmOpen] = useState(false);

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
          action={PARTNERS_COPY.detail.retry}
          onRetry={() => void query.refetch()}
        />
      </Card>
    );
  }

  if (query.data === undefined) {
    return null;
  }

  const partner = query.data;

  const handleToggleActive = () => {
    updateMutation.mutate(
      { active: !partner.active },
      {
        onSuccess: () => {
          setToggleConfirmOpen(false);
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-space-lg">
      <Card className="flex flex-col gap-space-md">
        <div className="flex items-center justify-between gap-space-sm flex-wrap border-b border-surface-container-high pb-space-md">
          <div className="flex items-center gap-space-sm flex-wrap">
            <h2 className="text-headline-sm font-bold text-on-surface">{partner.name}</h2>
            <Badge tone={partner.active ? 'success' : 'neutral'}>
              {partner.active ? PARTNERS_COPY.list.activeBadge : PARTNERS_COPY.list.inactiveBadge}
            </Badge>
          </div>

          <div className="flex items-center gap-space-sm flex-wrap">
            <Button variant="secondary" size="md" onClick={() => setEditDialogOpen(true)}>
              {PARTNERS_COPY.detail.editButton}
            </Button>
            <Button
              variant={partner.active ? 'danger' : 'secondary'}
              size="md"
              onClick={() => {
                updateMutation.reset();
                setToggleConfirmOpen(true);
              }}
            >
              {partner.active
                ? PARTNERS_COPY.detail.toggleActive.deactivateButton
                : PARTNERS_COPY.detail.toggleActive.activateButton}
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-space-sm">
          <h3 className="text-title-md font-semibold text-on-surface">{PARTNERS_COPY.detail.infoSection}</h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-space-md p-space-md rounded-lg bg-surface-container-low border border-surface-container-high text-body-md">
            <div>
              <span className="font-medium text-secondary">{PARTNERS_COPY.detail.addressLabel}: </span>
              <span className="text-on-surface">{partner.address}</span>
            </div>

            <div>
              <span className="font-medium text-secondary">{PARTNERS_COPY.detail.createdAtLabel}: </span>
              <span className="text-on-surface">{formatDateTime(partner.createdAt)}</span>
            </div>

            <div className="md:col-span-2">
              <span className="font-medium text-secondary">{PARTNERS_COPY.detail.tagsLabel}: </span>
              {partner.tags.length > 0 ? (
                <div className="inline-flex gap-space-xs flex-wrap ml-space-xs">
                  {partner.tags.map((tag) => (
                    <Badge key={tag} tone="neutral">
                      {tag}
                    </Badge>
                  ))}
                </div>
              ) : (
                <span className="text-secondary italic">{PARTNERS_COPY.detail.noTags}</span>
              )}
            </div>

            {partner.photoUrl ? (
              <div className="md:col-span-2 flex flex-col gap-space-xs">
                <span className="font-medium text-secondary">{PARTNERS_COPY.detail.photoLabel}:</span>
                <img
                  src={partner.photoUrl}
                  alt={partner.name}
                  className="rounded-lg max-h-48 object-cover border border-surface-container-high"
                />
              </div>
            ) : (
              <div className="md:col-span-2 text-secondary italic">{PARTNERS_COPY.detail.noPhoto}</div>
            )}
          </div>
        </div>
      </Card>

      <StaffSection partnerId={partner.id} />

      <PartnerFormDialog open={editDialogOpen} partner={partner} onClose={() => setEditDialogOpen(false)} />

      <Modal
        open={toggleConfirmOpen}
        onClose={() => setToggleConfirmOpen(false)}
        title={
          partner.active
            ? PARTNERS_COPY.detail.toggleActive.confirmDeactivateTitle
            : PARTNERS_COPY.detail.toggleActive.confirmActivateTitle
        }
      >
        <div className="flex flex-col gap-space-md">
          <p className="text-body-md text-secondary">
            {partner.active
              ? PARTNERS_COPY.detail.toggleActive.confirmDeactivateBody
              : PARTNERS_COPY.detail.toggleActive.confirmActivateBody}
          </p>

          {updateMutation.isError ? (
            <p
              role="alert"
              className="p-space-sm rounded-md bg-error-container text-on-error-container text-body-sm"
            >
              {
                messageFor(isApiError(updateMutation.error) ? updateMutation.error : { code: 'UNKNOWN' })
                  .title
              }
            </p>
          ) : null}

          <div className="flex justify-end gap-space-sm pt-space-xs border-t border-surface-container-high">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setToggleConfirmOpen(false)}
              disabled={updateMutation.isPending}
            >
              {PARTNERS_COPY.detail.toggleActive.cancel}
            </Button>
            <Button
              type="button"
              variant={partner.active ? 'danger' : 'primary'}
              onClick={handleToggleActive}
              disabled={updateMutation.isPending}
            >
              {partner.active
                ? PARTNERS_COPY.detail.toggleActive.confirmDeactivateSubmit
                : PARTNERS_COPY.detail.toggleActive.confirmActivateSubmit}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
