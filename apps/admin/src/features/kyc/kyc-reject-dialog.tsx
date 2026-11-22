import { useEffect, useId, useState, type FormEvent } from 'react';
import { KYC_REJECTION_REASON_CODES, type KycRejectBody } from '@tamgiao/contracts/verification';
import { Button, Modal } from '@tamgiao/ui-web';
import { KYC_COPY } from './copy';

export interface KycRejectDialogProps {
  readonly open: boolean;
  readonly pending: boolean;
  readonly onClose: () => void;
  readonly onSubmit: (body: KycRejectBody) => void;
}

export function KycRejectDialog({ open, pending, onClose, onSubmit }: KycRejectDialogProps) {
  const [code, setCode] = useState('');
  const [note, setNote] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);

  const reasonId = useId();
  const noteId = useId();

  useEffect(() => {
    if (open) {
      setCode('');
      setNote('');
      setReasonError(null);
      setNoteError(null);
    }
  }, [open]);

  const handleClose = () => {
    setCode('');
    setNote('');
    setReasonError(null);
    setNoteError(null);
    onClose();
  };

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    let hasError = false;

    if (!code) {
      setReasonError(KYC_COPY.rejectDialog.reasonRequired);
      hasError = true;
    }

    const trimmedNote = note.trim();
    if (code === 'OTHER' && trimmedNote.length === 0) {
      setNoteError(KYC_COPY.rejectDialog.noteRequired);
      hasError = true;
    }

    if (hasError) {
      return;
    }

    onSubmit(trimmedNote ? { code, note: trimmedNote } : { code });
  };

  return (
    <Modal open={open} onClose={handleClose} title={KYC_COPY.rejectDialog.title}>
      <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-space-md">
        <div className="flex flex-col gap-space-xs">
          <label htmlFor={reasonId} className="text-label-md font-medium text-on-surface">
            {KYC_COPY.rejectDialog.reasonLabel}
          </label>
          <select
            id={reasonId}
            value={code}
            aria-invalid={reasonError ? 'true' : undefined}
            onChange={(e) => {
              setCode(e.target.value);
              setReasonError(null);
            }}
            className={`min-h-[44px] px-space-md rounded-md bg-surface-container-lowest text-on-surface text-body-md border transition-colors ${
              reasonError ? 'border-error focus:border-error' : 'border-outline-variant focus:border-primary'
            }`}
          >
            <option value="">{KYC_COPY.rejectDialog.reasonPlaceholder}</option>
            {KYC_REJECTION_REASON_CODES.map((reasonCode) => (
              <option key={reasonCode} value={reasonCode}>
                {KYC_COPY.rejectionReasons[reasonCode]}
              </option>
            ))}
          </select>
          {reasonError ? (
            <p role="alert" className="text-body-sm text-error">
              {reasonError}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-space-xs">
          <label htmlFor={noteId} className="text-label-md font-medium text-on-surface">
            {KYC_COPY.rejectDialog.noteLabel}
          </label>
          <textarea
            id={noteId}
            rows={3}
            maxLength={2000}
            value={note}
            aria-invalid={noteError ? 'true' : undefined}
            onChange={(e) => {
              setNote(e.target.value);
              setNoteError(null);
            }}
            className={`w-full px-space-md py-space-xs rounded-md bg-surface-container-lowest text-on-surface text-body-md border transition-colors ${
              noteError ? 'border-error focus:border-error' : 'border-outline-variant focus:border-primary'
            }`}
          />
          <p className="text-body-sm text-secondary">{KYC_COPY.rejectDialog.noteHint}</p>
          {noteError ? (
            <p role="alert" className="text-body-sm text-error">
              {noteError}
            </p>
          ) : null}
        </div>

        <div className="flex justify-end gap-space-sm pt-space-xs">
          <Button type="button" variant="ghost" onClick={handleClose}>
            {KYC_COPY.decisions.cancel}
          </Button>
          <Button type="submit" variant="danger" loading={pending}>
            {KYC_COPY.rejectDialog.submit}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
