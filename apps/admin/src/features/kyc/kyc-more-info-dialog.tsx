import { useEffect, useId, useState, type FormEvent } from 'react';
import {
  KYC_MORE_INFO_ITEMS,
  type KycMoreInfoItem,
  type KycRequestMoreInfoBody,
} from '@tamgiao/contracts/verification';
import { Button, Modal } from '@tamgiao/ui-web';
import { KYC_COPY } from './copy';

export interface KycMoreInfoDialogProps {
  readonly open: boolean;
  readonly pending: boolean;
  readonly onClose: () => void;
  readonly onSubmit: (body: KycRequestMoreInfoBody) => void;
}

export function KycMoreInfoDialog({ open, pending, onClose, onSubmit }: KycMoreInfoDialogProps) {
  const [selectedItems, setSelectedItems] = useState<ReadonlySet<KycMoreInfoItem>>(new Set());
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const noteId = useId();

  useEffect(() => {
    if (open) {
      setSelectedItems(new Set());
      setNote('');
      setError(null);
    }
  }, [open]);

  const handleClose = () => {
    setSelectedItems(new Set());
    setNote('');
    setError(null);
    onClose();
  };

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (selectedItems.size === 0) {
      setError(KYC_COPY.moreInfoDialog.itemsRequired);
      return;
    }

    const items = KYC_MORE_INFO_ITEMS.filter((item) => selectedItems.has(item));
    const trimmedNote = note.trim();
    onSubmit(trimmedNote ? { items, note: trimmedNote } : { items });
  };

  return (
    <Modal open={open} onClose={handleClose} title={KYC_COPY.moreInfoDialog.title}>
      <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-space-md">
        <fieldset className="flex flex-col gap-space-xs">
          <legend className="text-label-md font-medium text-on-surface mb-space-xs">
            {KYC_COPY.moreInfoDialog.itemsLabel}
          </legend>
          {KYC_MORE_INFO_ITEMS.map((item) => {
            const isChecked = selectedItems.has(item);
            return (
              <label
                key={item}
                className="inline-flex items-center gap-space-xs text-body-md text-on-surface cursor-pointer select-none"
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={(e) => {
                    const next = new Set(selectedItems);
                    if (e.target.checked) {
                      next.add(item);
                    } else {
                      next.delete(item);
                    }
                    setSelectedItems(next);
                    setError(null);
                  }}
                  className="h-4 w-4 accent-primary rounded cursor-pointer"
                />
                <span>{KYC_COPY.moreInfoItems[item]}</span>
              </label>
            );
          })}
          {error ? (
            <p role="alert" className="text-body-sm text-error mt-space-xs">
              {error}
            </p>
          ) : null}
        </fieldset>

        <div className="flex flex-col gap-space-xs">
          <label htmlFor={noteId} className="text-label-md font-medium text-on-surface">
            {KYC_COPY.moreInfoDialog.noteLabel}
          </label>
          <textarea
            id={noteId}
            rows={3}
            maxLength={1000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full px-space-md py-space-xs rounded-md bg-surface-container-lowest text-on-surface text-body-md border border-outline-variant focus:border-primary transition-colors"
          />
        </div>

        <div className="flex justify-end gap-space-sm pt-space-xs">
          <Button type="button" variant="ghost" onClick={handleClose}>
            {KYC_COPY.decisions.cancel}
          </Button>
          <Button type="submit" variant="primary" loading={pending}>
            {KYC_COPY.moreInfoDialog.submit}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
