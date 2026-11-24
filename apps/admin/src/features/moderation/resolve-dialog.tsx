import { useEffect, useId, useState, type FormEvent } from 'react';
import { REPORT_CONCLUSION_MAX_LENGTH } from '@tamgiao/contracts/safety';
import { Button, Modal } from '@tamgiao/ui-web';
import { MODERATION_COPY } from './copy';

export interface ResolveDialogProps {
  readonly open: boolean;
  readonly outcome: 'RESOLVED' | 'DISMISSED';
  readonly pending: boolean;
  /** Lỗi BE của lần gửi gần nhất — hiện trong dialog để không mất kết luận đã nhập. */
  readonly error: string | null;
  readonly onClose: () => void;
  readonly onSubmit: (conclusion: string) => void;
}

export function ResolveDialog({
  open,
  outcome,
  pending,
  error: submitError,
  onClose,
  onSubmit,
}: ResolveDialogProps) {
  const [conclusion, setConclusion] = useState('');
  const [error, setError] = useState<string | null>(null);
  const textareaId = useId();

  const isResolved = outcome === 'RESOLVED';
  const title = isResolved
    ? MODERATION_COPY.resolveDialog.titleResolve
    : MODERATION_COPY.resolveDialog.titleDismiss;
  const description = isResolved
    ? MODERATION_COPY.resolveDialog.descriptionResolve
    : MODERATION_COPY.resolveDialog.descriptionDismiss;
  const submitText = isResolved
    ? MODERATION_COPY.resolveDialog.submitResolve
    : MODERATION_COPY.resolveDialog.submitDismiss;

  useEffect(() => {
    if (open) {
      setConclusion('');
      setError(null);
    }
  }, [open]);

  const handleClose = () => {
    setConclusion('');
    setError(null);
    onClose();
  };

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = conclusion.trim();

    if (trimmed.length === 0) {
      setError(MODERATION_COPY.resolveDialog.conclusionRequired);
      return;
    }

    if (trimmed.length > REPORT_CONCLUSION_MAX_LENGTH) {
      setError(MODERATION_COPY.resolveDialog.conclusionTooLong(REPORT_CONCLUSION_MAX_LENGTH));
      return;
    }

    onSubmit(trimmed);
  };

  return (
    <Modal open={open} onClose={handleClose} title={title}>
      <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-space-md">
        <p className="text-body-md text-secondary">{description}</p>

        <div className="flex flex-col gap-space-xs">
          <label htmlFor={textareaId} className="text-label-md font-medium text-on-surface">
            {MODERATION_COPY.resolveDialog.conclusionLabel}
          </label>
          <textarea
            id={textareaId}
            rows={4}
            value={conclusion}
            maxLength={REPORT_CONCLUSION_MAX_LENGTH}
            placeholder={MODERATION_COPY.resolveDialog.conclusionPlaceholder}
            aria-invalid={error ? 'true' : undefined}
            onChange={(e) => {
              setConclusion(e.target.value);
              setError(null);
            }}
            className={`px-space-md py-space-sm rounded-md bg-surface-container-lowest text-on-surface text-body-md border transition-colors ${
              error ? 'border-error focus:border-error' : 'border-outline-variant focus:border-primary'
            }`}
          />
          {error ? (
            <p role="alert" className="text-body-sm text-error">
              {error}
            </p>
          ) : null}
          <div className="text-body-sm text-secondary text-right">
            {conclusion.length}/{REPORT_CONCLUSION_MAX_LENGTH}
          </div>
        </div>

        {submitError ? (
          <p
            role="alert"
            className="p-space-sm rounded-md bg-error-container text-on-error-container text-body-sm"
          >
            {submitError}
          </p>
        ) : null}

        <div className="flex justify-end gap-space-sm pt-space-xs border-t border-surface-container-high">
          <Button type="button" variant="ghost" onClick={handleClose} disabled={pending}>
            {MODERATION_COPY.resolveDialog.cancel}
          </Button>
          <Button type="submit" variant={isResolved ? 'primary' : 'secondary'} disabled={pending}>
            {submitText}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
