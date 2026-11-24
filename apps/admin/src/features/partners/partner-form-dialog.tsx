import { useEffect, useState, type FormEvent } from 'react';
import { isApiError, messageFor } from '@tamgiao/api-client';
import type { AdminPartner } from '@tamgiao/contracts/billing';
import { Button, Modal, TextField } from '@tamgiao/ui-web';
import { PARTNERS_COPY } from './copy';
import {
  buildPartnerPatch,
  mapPartnerApiFieldError,
  parseTags,
  validatePartnerForm,
  withoutField,
  type PartnerFormField,
} from './partner-form';
import { useCreatePartner, useUpdatePartner } from './partners-api';

export interface PartnerFormDialogProps {
  readonly open: boolean;
  readonly partner?: AdminPartner | null;
  readonly onClose: () => void;
  readonly onSuccess?: (saved: AdminPartner) => void;
}

export function PartnerFormDialog({ open, partner, onClose, onSuccess }: PartnerFormDialogProps) {
  const isEdit = Boolean(partner);
  const createMutation = useCreatePartner();
  const updateMutation = useUpdatePartner(partner?.id ?? '');

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<PartnerFormField, string>>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      if (partner) {
        setName(partner.name);
        setAddress(partner.address);
        setPhotoUrl(partner.photoUrl ?? '');
        setTagsText(partner.tags.join(', '));
      } else {
        setName('');
        setAddress('');
        setPhotoUrl('');
        setTagsText('');
      }
      setFieldErrors({});
      setGeneralError(null);
    }
  }, [open, partner]);

  const isPending = createMutation.isPending || updateMutation.isPending;

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setGeneralError(null);

    const tags = parseTags(tagsText);
    const clientErrors = validatePartnerForm({ name, address, photoUrl, tags });

    if (Object.keys(clientErrors).length > 0) {
      setFieldErrors(clientErrors);
      return;
    }

    if (partner) {
      const patch = buildPartnerPatch(partner, { name, address, photoUrl, tags });
      if (patch === null) {
        // Không có trường nào thay đổi -> không gọi API, đóng dialog
        onClose();
        return;
      }

      updateMutation.mutate(patch, {
        onSuccess: (saved) => {
          onClose();
          onSuccess?.(saved);
        },
        onError: (err) => {
          const apiFieldErrors = mapPartnerApiFieldError(err);
          setFieldErrors(apiFieldErrors);
          if (Object.keys(apiFieldErrors).length === 0) {
            setGeneralError(messageFor(isApiError(err) ? err : { code: 'UNKNOWN' }).title);
          }
        },
      });
    } else {
      createMutation.mutate(
        {
          name: name.trim(),
          address: address.trim(),
          ...(photoUrl.trim() ? { photoUrl: photoUrl.trim() } : {}),
          tags,
        },
        {
          onSuccess: (saved) => {
            onClose();
            onSuccess?.(saved);
          },
          onError: (err) => {
            const apiFieldErrors = mapPartnerApiFieldError(err);
            setFieldErrors(apiFieldErrors);
            if (Object.keys(apiFieldErrors).length === 0) {
              setGeneralError(messageFor(isApiError(err) ? err : { code: 'UNKNOWN' }).title);
            }
          },
        },
      );
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? PARTNERS_COPY.partnerForm.titleEdit : PARTNERS_COPY.partnerForm.titleCreate}
    >
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
          label={PARTNERS_COPY.partnerForm.nameLabel}
          placeholder={PARTNERS_COPY.partnerForm.namePlaceholder}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setFieldErrors((prev) => withoutField(prev, 'name'));
          }}
          {...(fieldErrors.name ? { error: fieldErrors.name } : {})}
          disabled={isPending}
        />

        <TextField
          label={PARTNERS_COPY.partnerForm.addressLabel}
          placeholder={PARTNERS_COPY.partnerForm.addressPlaceholder}
          value={address}
          onChange={(e) => {
            setAddress(e.target.value);
            setFieldErrors((prev) => withoutField(prev, 'address'));
          }}
          {...(fieldErrors.address ? { error: fieldErrors.address } : {})}
          disabled={isPending}
        />

        <TextField
          label={PARTNERS_COPY.partnerForm.photoUrlLabel}
          placeholder={PARTNERS_COPY.partnerForm.photoUrlPlaceholder}
          value={photoUrl}
          onChange={(e) => {
            setPhotoUrl(e.target.value);
            setFieldErrors((prev) => withoutField(prev, 'photoUrl'));
          }}
          {...(fieldErrors.photoUrl ? { error: fieldErrors.photoUrl } : {})}
          disabled={isPending}
        />

        <div className="flex flex-col gap-space-xs">
          <label htmlFor="partner-tags-input" className="text-label-md font-medium text-on-surface">
            {PARTNERS_COPY.partnerForm.tagsLabel}
          </label>
          <textarea
            id="partner-tags-input"
            rows={2}
            value={tagsText}
            placeholder={PARTNERS_COPY.partnerForm.tagsPlaceholder}
            onChange={(e) => {
              setTagsText(e.target.value);
              setFieldErrors((prev) => withoutField(prev, 'tags'));
            }}
            disabled={isPending}
            className={`w-full min-h-[44px] px-space-md py-space-xs rounded-md bg-surface-container-lowest text-on-surface text-body-md border transition-colors outline-none focus:ring-2 focus:ring-primary ${
              fieldErrors.tags
                ? 'border-error focus:border-error'
                : 'border-outline-variant hover:border-outline focus:border-primary'
            } ${isPending ? 'opacity-50 cursor-not-allowed bg-surface-container-low' : ''}`.trim()}
          />
          {fieldErrors.tags ? (
            <p className="text-body-sm text-error">{fieldErrors.tags}</p>
          ) : (
            <p className="text-body-sm text-secondary">{PARTNERS_COPY.partnerForm.tagsHint}</p>
          )}
        </div>

        <div className="flex justify-end gap-space-sm pt-space-xs border-t border-surface-container-high">
          <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
            {PARTNERS_COPY.partnerForm.cancel}
          </Button>
          <Button type="submit" variant="primary" disabled={isPending}>
            {isEdit ? PARTNERS_COPY.partnerForm.submitEdit : PARTNERS_COPY.partnerForm.submitCreate}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
