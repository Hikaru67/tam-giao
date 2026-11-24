import { useEffect, useState, type FormEvent } from 'react';
import { isApiError, messageFor } from '@tamgiao/api-client';
import {
  PARTNER_NAME_MAX_LENGTH,
  PARTNER_PIN_PATTERN,
  type AdminPartnerStaff,
} from '@tamgiao/contracts/billing';
import { Button, Modal, TextField } from '@tamgiao/ui-web';
import { PARTNERS_COPY } from './copy';
import { mapPartnerApiFieldError, withoutField } from './partner-form';
import { useCreatePartnerStaff, useUpdatePartnerStaff } from './partners-api';

export interface StaffCreateDialogProps {
  readonly open: boolean;
  readonly partnerId: string;
  readonly onClose: () => void;
}

export function StaffCreateDialog({ open, partnerId, onClose }: StaffCreateDialogProps) {
  const createMutation = useCreatePartnerStaff(partnerId);

  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<'name' | 'pin', string>>>({});
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName('');
      setPin('');
      setConfirmPin('');
      setFieldErrors({});
      setConfirmError(null);
      setGeneralError(null);
    }
  }, [open]);

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setGeneralError(null);
    setConfirmError(null);

    const errors: Partial<Record<'name' | 'pin', string>> = {};
    const trimmedName = name.trim();

    if (trimmedName.length === 0) {
      errors.name = PARTNERS_COPY.staffForm.errors.nameRequired;
    } else if (trimmedName.length > PARTNER_NAME_MAX_LENGTH) {
      errors.name = PARTNERS_COPY.staffForm.errors.nameTooLong;
    }

    if (!PARTNER_PIN_PATTERN.test(pin)) {
      errors.pin = PARTNERS_COPY.staffForm.errors.pinInvalid;
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    if (pin !== confirmPin) {
      setConfirmError(PARTNERS_COPY.staffForm.errors.pinMismatch);
      return;
    }

    createMutation.mutate(
      {
        name: trimmedName,
        pin,
      },
      {
        onSuccess: () => {
          onClose();
        },
        onError: (err) => {
          // Lỗi giữ dialog + dữ liệu (trừ PIN xoá)
          setPin('');
          setConfirmPin('');

          const apiFieldErrors = mapPartnerApiFieldError(err);
          const mapped: Partial<Record<'name' | 'pin', string>> = {};
          if (apiFieldErrors.name) mapped.name = apiFieldErrors.name;
          if (apiFieldErrors.pin) mapped.pin = apiFieldErrors.pin;
          setFieldErrors(mapped);

          if (Object.keys(mapped).length === 0) {
            setGeneralError(messageFor(isApiError(err) ? err : { code: 'UNKNOWN' }).title);
          }
        },
      },
    );
  };

  return (
    <Modal open={open} onClose={onClose} title={PARTNERS_COPY.staffForm.titleCreate}>
      <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-space-md">
        {generalError ? (
          <p
            role="alert"
            className="p-space-sm rounded-md bg-error-container text-on-error-container text-body-sm"
          >
            {generalError}
          </p>
        ) : null}

        <TextField
          label={PARTNERS_COPY.staffForm.nameLabel}
          placeholder={PARTNERS_COPY.staffForm.namePlaceholder}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setFieldErrors((prev) => withoutField(prev, 'name'));
          }}
          {...(fieldErrors.name ? { error: fieldErrors.name } : {})}
          disabled={createMutation.isPending}
        />

        <TextField
          label={PARTNERS_COPY.staffForm.pinLabel}
          placeholder={PARTNERS_COPY.staffForm.pinPlaceholder}
          type="password"
          inputMode="numeric"
          maxLength={6}
          value={pin}
          onChange={(e) => {
            setPin(e.target.value);
            setFieldErrors((prev) => withoutField(prev, 'pin'));
          }}
          {...(fieldErrors.pin ? { error: fieldErrors.pin } : {})}
          disabled={createMutation.isPending}
        />

        <TextField
          label={PARTNERS_COPY.staffForm.pinConfirmLabel}
          placeholder={PARTNERS_COPY.staffForm.pinConfirmPlaceholder}
          type="password"
          inputMode="numeric"
          maxLength={6}
          value={confirmPin}
          onChange={(e) => {
            setConfirmPin(e.target.value);
            setConfirmError(null);
          }}
          {...(confirmError ? { error: confirmError } : {})}
          disabled={createMutation.isPending}
        />

        <p className="text-body-sm text-secondary">{PARTNERS_COPY.staffForm.pinSaveNotice}</p>

        <div className="flex justify-end gap-space-sm pt-space-xs border-t border-surface-container-high">
          <Button type="button" variant="ghost" onClick={onClose} disabled={createMutation.isPending}>
            {PARTNERS_COPY.staffForm.cancel}
          </Button>
          <Button type="submit" variant="primary" disabled={createMutation.isPending}>
            {PARTNERS_COPY.staffForm.submitCreate}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export interface StaffResetPinDialogProps {
  readonly open: boolean;
  readonly partnerId: string;
  readonly staff: AdminPartnerStaff;
  readonly onClose: () => void;
}

export function StaffResetPinDialog({ open, partnerId, staff, onClose }: StaffResetPinDialogProps) {
  const updateMutation = useUpdatePartnerStaff(partnerId);

  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setPin('');
      setConfirmPin('');
      setPinError(null);
      setConfirmError(null);
      setGeneralError(null);
    }
  }, [open]);

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setGeneralError(null);
    setPinError(null);
    setConfirmError(null);

    if (!PARTNER_PIN_PATTERN.test(pin)) {
      setPinError(PARTNERS_COPY.staffForm.errors.pinInvalid);
      return;
    }

    if (pin !== confirmPin) {
      setConfirmError(PARTNERS_COPY.staffForm.errors.pinMismatch);
      return;
    }

    updateMutation.mutate(
      {
        staffId: staff.id,
        body: { pin },
      },
      {
        onSuccess: () => {
          onClose();
        },
        onError: (err) => {
          setPin('');
          setConfirmPin('');

          const apiFieldErrors = mapPartnerApiFieldError(err);
          if (apiFieldErrors.pin) {
            setPinError(apiFieldErrors.pin);
          } else {
            setGeneralError(messageFor(isApiError(err) ? err : { code: 'UNKNOWN' }).title);
          }
        },
      },
    );
  };

  return (
    <Modal open={open} onClose={onClose} title={PARTNERS_COPY.staffForm.titleResetPin}>
      <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-space-md">
        <p className="text-body-md text-secondary">{PARTNERS_COPY.staffForm.resetPinNote}</p>

        {generalError ? (
          <p
            role="alert"
            className="p-space-sm rounded-md bg-error-container text-on-error-container text-body-sm"
          >
            {generalError}
          </p>
        ) : null}

        <TextField
          label={PARTNERS_COPY.staffForm.pinLabel}
          placeholder={PARTNERS_COPY.staffForm.pinPlaceholder}
          type="password"
          inputMode="numeric"
          maxLength={6}
          value={pin}
          onChange={(e) => {
            setPin(e.target.value);
            setPinError(null);
          }}
          {...(pinError ? { error: pinError } : {})}
          disabled={updateMutation.isPending}
        />

        <TextField
          label={PARTNERS_COPY.staffForm.pinConfirmLabel}
          placeholder={PARTNERS_COPY.staffForm.pinConfirmPlaceholder}
          type="password"
          inputMode="numeric"
          maxLength={6}
          value={confirmPin}
          onChange={(e) => {
            setConfirmPin(e.target.value);
            setConfirmError(null);
          }}
          {...(confirmError ? { error: confirmError } : {})}
          disabled={updateMutation.isPending}
        />

        <p className="text-body-sm text-secondary">{PARTNERS_COPY.staffForm.pinSaveNotice}</p>

        <div className="flex justify-end gap-space-sm pt-space-xs border-t border-surface-container-high">
          <Button type="button" variant="ghost" onClick={onClose} disabled={updateMutation.isPending}>
            {PARTNERS_COPY.staffForm.cancel}
          </Button>
          <Button type="submit" variant="primary" disabled={updateMutation.isPending}>
            {PARTNERS_COPY.staffForm.submitResetPin}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export interface StaffRenameDialogProps {
  readonly open: boolean;
  readonly partnerId: string;
  readonly staff: AdminPartnerStaff;
  readonly onClose: () => void;
}

export function StaffRenameDialog({ open, partnerId, staff, onClose }: StaffRenameDialogProps) {
  const updateMutation = useUpdatePartnerStaff(partnerId);

  const [name, setName] = useState(staff.name);
  const [error, setError] = useState<string | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(staff.name);
      setError(null);
      setGeneralError(null);
    }
  }, [open, staff.name]);

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setGeneralError(null);
    setError(null);

    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setError(PARTNERS_COPY.staffForm.errors.nameRequired);
      return;
    }
    if (trimmed.length > PARTNER_NAME_MAX_LENGTH) {
      setError(PARTNERS_COPY.staffForm.errors.nameTooLong);
      return;
    }

    if (trimmed === staff.name) {
      onClose();
      return;
    }

    updateMutation.mutate(
      {
        staffId: staff.id,
        body: { name: trimmed },
      },
      {
        onSuccess: () => {
          onClose();
        },
        onError: (err) => {
          const apiFieldErrors = mapPartnerApiFieldError(err);
          if (apiFieldErrors.name) {
            setError(apiFieldErrors.name);
          } else {
            setGeneralError(messageFor(isApiError(err) ? err : { code: 'UNKNOWN' }).title);
          }
        },
      },
    );
  };

  return (
    <Modal open={open} onClose={onClose} title={PARTNERS_COPY.staffForm.titleRename}>
      <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-space-md">
        {generalError ? (
          <p
            role="alert"
            className="p-space-sm rounded-md bg-error-container text-on-error-container text-body-sm"
          >
            {generalError}
          </p>
        ) : null}

        <TextField
          label={PARTNERS_COPY.staffForm.nameLabel}
          placeholder={PARTNERS_COPY.staffForm.namePlaceholder}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          {...(error ? { error } : {})}
          disabled={updateMutation.isPending}
        />

        <div className="flex justify-end gap-space-sm pt-space-xs border-t border-surface-container-high">
          <Button type="button" variant="ghost" onClick={onClose} disabled={updateMutation.isPending}>
            {PARTNERS_COPY.staffForm.cancel}
          </Button>
          <Button type="submit" variant="primary" disabled={updateMutation.isPending}>
            {PARTNERS_COPY.staffForm.submitRename}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
