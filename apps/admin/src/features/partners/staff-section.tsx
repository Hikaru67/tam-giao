import { useEffect, useState } from 'react';
import { isApiError, messageFor } from '@tamgiao/api-client';
import { useApiClient } from '@tamgiao/api-client/react';
import type { AdminPartnerStaff } from '@tamgiao/contracts/billing';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Card, EmptyState, ErrorState, Modal } from '@tamgiao/ui-web';
import { formatDateTime } from '../kyc/format';
import { PARTNERS_COPY } from './copy';
import { partnerStaffListQueryOptions, useUpdatePartnerStaff } from './partners-api';
import { StaffCreateDialog, StaffRenameDialog, StaffResetPinDialog } from './staff-form-dialog';

const COPIED_HINT_MS = 2_000;

export interface StaffSectionProps {
  readonly partnerId: string;
}

export function StaffSection({ partnerId }: StaffSectionProps) {
  const client = useApiClient();
  const query = useQuery(partnerStaffListQueryOptions(client, partnerId));
  const updateStaffMutation = useUpdatePartnerStaff(partnerId);

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [resetPinStaff, setResetPinStaff] = useState<AdminPartnerStaff | null>(null);
  const [renameStaff, setRenameStaff] = useState<AdminPartnerStaff | null>(null);
  const [confirmRemoveDeviceStaff, setConfirmRemoveDeviceStaff] = useState<AdminPartnerStaff | null>(null);
  const [confirmToggleActiveStaff, setConfirmToggleActiveStaff] = useState<AdminPartnerStaff | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const staffItems = query.data?.items ?? [];
  const canCopy = typeof navigator !== 'undefined' && Boolean(navigator.clipboard?.writeText);

  const handleCopyId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      setCopiedId(id);
    } catch {
      // Trình duyệt từ chối clipboard: mã vẫn hiển thị để chép tay.
    }
  };

  useEffect(() => {
    if (copiedId === null) return;
    const timer = setTimeout(() => setCopiedId(null), COPIED_HINT_MS);
    return () => clearTimeout(timer);
  }, [copiedId]);

  const handleRemoveDevice = () => {
    if (!confirmRemoveDeviceStaff) return;
    updateStaffMutation.mutate(
      {
        staffId: confirmRemoveDeviceStaff.id,
        body: { deviceId: null },
      },
      {
        onSuccess: () => setConfirmRemoveDeviceStaff(null),
      },
    );
  };

  const handleToggleActive = () => {
    if (!confirmToggleActiveStaff) return;
    updateStaffMutation.mutate(
      {
        staffId: confirmToggleActiveStaff.id,
        body: { active: !confirmToggleActiveStaff.active },
      },
      {
        onSuccess: () => setConfirmToggleActiveStaff(null),
      },
    );
  };

  return (
    <Card className="flex flex-col gap-space-md">
      <div className="flex items-center justify-between gap-space-sm flex-wrap border-b border-surface-container-high pb-space-sm">
        <h3 className="text-title-md font-semibold text-on-surface">{PARTNERS_COPY.staff.title}</h3>
        <Button variant="primary" size="md" onClick={() => setCreateDialogOpen(true)}>
          {PARTNERS_COPY.staff.createButton}
        </Button>
      </div>

      {query.isLoading && staffItems.length === 0 ? (
        <div aria-busy="true" className="text-body-sm text-secondary py-space-md text-center" />
      ) : query.isError && query.data === undefined ? (
        <ErrorState
          title={messageFor(isApiError(query.error) ? query.error : { code: 'UNKNOWN' }).title}
          onRetry={() => void query.refetch()}
        />
      ) : staffItems.length === 0 ? (
        <EmptyState title={PARTNERS_COPY.staff.empty} description={PARTNERS_COPY.staff.emptyDescription} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-body-sm">
            <thead>
              <tr className="border-b border-surface-container-high text-secondary">
                <th className="py-space-xs px-space-sm font-medium">{PARTNERS_COPY.staff.nameHeader}</th>
                <th className="py-space-xs px-space-sm font-medium">{PARTNERS_COPY.staff.idHeader}</th>
                <th className="py-space-xs px-space-sm font-medium">{PARTNERS_COPY.staff.deviceHeader}</th>
                <th className="py-space-xs px-space-sm font-medium">{PARTNERS_COPY.staff.statusHeader}</th>
                <th className="py-space-xs px-space-sm font-medium">{PARTNERS_COPY.staff.lastLoginHeader}</th>
                <th className="py-space-xs px-space-sm font-medium text-right">
                  {PARTNERS_COPY.staff.actionsHeader}
                </th>
              </tr>
            </thead>
            <tbody>
              {staffItems.map((staff) => {
                return (
                  <tr
                    key={staff.id}
                    className="border-b border-surface-container-high hover:bg-surface-container-low transition-colors"
                  >
                    <td className="py-space-sm px-space-sm font-medium text-on-surface">{staff.name}</td>
                    <td className="py-space-sm px-space-sm">
                      <div className="flex items-center gap-space-xs">
                        <span className="font-mono text-on-surface text-body-sm">{staff.id}</span>
                        {canCopy ? (
                          <button
                            type="button"
                            onClick={() => void handleCopyId(staff.id)}
                            className="text-primary hover:text-primary-container text-body-sm transition-colors"
                            title={PARTNERS_COPY.staff.copyId}
                          >
                            {copiedId === staff.id ? (
                              <span className="text-label-sm text-secondary">
                                {PARTNERS_COPY.staff.copyIdSuccess}
                              </span>
                            ) : (
                              <span className="underline">{PARTNERS_COPY.staff.copyId}</span>
                            )}
                          </button>
                        ) : null}
                      </div>
                    </td>
                    <td className="py-space-sm px-space-sm">
                      {staff.deviceId ? (
                        <div className="flex items-center gap-space-xs">
                          <span className="text-on-surface">{PARTNERS_COPY.staff.deviceBound}</span>
                          <Button
                            variant="ghost"
                            size="md"
                            onClick={() => {
                              updateStaffMutation.reset();
                              setConfirmRemoveDeviceStaff(staff);
                            }}
                            disabled={updateStaffMutation.isPending}
                          >
                            {PARTNERS_COPY.staff.removeDeviceAction}
                          </Button>
                        </div>
                      ) : (
                        <span className="text-secondary">{PARTNERS_COPY.staff.deviceUnbound}</span>
                      )}
                    </td>
                    <td className="py-space-sm px-space-sm">
                      <div className="flex items-center gap-space-xs flex-wrap">
                        {staff.lockedUntil !== null && Date.parse(staff.lockedUntil) > Date.now() ? (
                          <Badge tone="danger">
                            {PARTNERS_COPY.staff.lockedUntil(formatDateTime(staff.lockedUntil))}
                          </Badge>
                        ) : null}
                        <Badge tone={staff.active ? 'success' : 'neutral'}>
                          {staff.active ? PARTNERS_COPY.staff.activeBadge : PARTNERS_COPY.staff.inactiveBadge}
                        </Badge>
                      </div>
                    </td>
                    <td className="py-space-sm px-space-sm text-secondary">
                      {staff.lastLoginAt
                        ? formatDateTime(staff.lastLoginAt)
                        : PARTNERS_COPY.staff.neverLoggedIn}
                    </td>
                    <td className="py-space-sm px-space-sm text-right">
                      <div className="inline-flex gap-space-xs justify-end flex-wrap">
                        <Button variant="ghost" size="md" onClick={() => setResetPinStaff(staff)}>
                          {PARTNERS_COPY.staff.resetPinAction}
                        </Button>
                        <Button variant="ghost" size="md" onClick={() => setRenameStaff(staff)}>
                          {PARTNERS_COPY.staff.renameAction}
                        </Button>
                        <Button
                          variant={staff.active ? 'danger' : 'secondary'}
                          size="md"
                          onClick={() => {
                            updateStaffMutation.reset();
                            setConfirmToggleActiveStaff(staff);
                          }}
                        >
                          {staff.active
                            ? PARTNERS_COPY.staff.deactivateAction
                            : PARTNERS_COPY.staff.activateAction}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <StaffCreateDialog
        open={createDialogOpen}
        partnerId={partnerId}
        onClose={() => setCreateDialogOpen(false)}
      />

      {resetPinStaff ? (
        <StaffResetPinDialog
          open={resetPinStaff !== null}
          partnerId={partnerId}
          staff={resetPinStaff}
          onClose={() => setResetPinStaff(null)}
        />
      ) : null}

      {renameStaff ? (
        <StaffRenameDialog
          open={renameStaff !== null}
          partnerId={partnerId}
          staff={renameStaff}
          onClose={() => setRenameStaff(null)}
        />
      ) : null}

      {/* Xác nhận gỡ thiết bị */}
      <Modal
        open={confirmRemoveDeviceStaff !== null}
        onClose={() => setConfirmRemoveDeviceStaff(null)}
        title={PARTNERS_COPY.staff.confirmRemoveDeviceTitle}
      >
        <div className="flex flex-col gap-space-md">
          <p className="text-body-md text-secondary">{PARTNERS_COPY.staff.confirmRemoveDeviceBody}</p>
          {updateStaffMutation.isError ? (
            <p
              role="alert"
              className="p-space-sm rounded-md bg-error-container text-on-error-container text-body-sm"
            >
              {
                messageFor(
                  isApiError(updateStaffMutation.error) ? updateStaffMutation.error : { code: 'UNKNOWN' },
                ).title
              }
            </p>
          ) : null}

          <div className="flex justify-end gap-space-sm pt-space-xs border-t border-surface-container-high">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirmRemoveDeviceStaff(null)}
              disabled={updateStaffMutation.isPending}
            >
              {PARTNERS_COPY.staff.cancel}
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={handleRemoveDevice}
              disabled={updateStaffMutation.isPending}
            >
              {PARTNERS_COPY.staff.confirmRemoveDeviceSubmit}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Xác nhận vô hiệu hoá / kích hoạt */}
      <Modal
        open={confirmToggleActiveStaff !== null}
        onClose={() => setConfirmToggleActiveStaff(null)}
        title={
          confirmToggleActiveStaff?.active
            ? PARTNERS_COPY.staff.confirmDeactivateTitle
            : PARTNERS_COPY.staff.confirmActivateTitle
        }
      >
        <div className="flex flex-col gap-space-md">
          <p className="text-body-md text-secondary">
            {confirmToggleActiveStaff?.active
              ? PARTNERS_COPY.staff.confirmDeactivateBody
              : PARTNERS_COPY.staff.confirmActivateBody}
          </p>
          {updateStaffMutation.isError ? (
            <p
              role="alert"
              className="p-space-sm rounded-md bg-error-container text-on-error-container text-body-sm"
            >
              {
                messageFor(
                  isApiError(updateStaffMutation.error) ? updateStaffMutation.error : { code: 'UNKNOWN' },
                ).title
              }
            </p>
          ) : null}

          <div className="flex justify-end gap-space-sm pt-space-xs border-t border-surface-container-high">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirmToggleActiveStaff(null)}
              disabled={updateStaffMutation.isPending}
            >
              {PARTNERS_COPY.staff.cancel}
            </Button>
            <Button
              type="button"
              variant={confirmToggleActiveStaff?.active ? 'danger' : 'primary'}
              onClick={handleToggleActive}
              disabled={updateStaffMutation.isPending}
            >
              {confirmToggleActiveStaff?.active
                ? PARTNERS_COPY.staff.confirmDeactivateSubmit
                : PARTNERS_COPY.staff.confirmActivateSubmit}
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}
