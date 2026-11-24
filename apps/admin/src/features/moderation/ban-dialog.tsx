import { useEffect, useId, useState, type FormEvent } from 'react';
import { isApiError, messageFor } from '@tamgiao/api-client';
import { BAN_REASON_MAX_LENGTH } from '@tamgiao/contracts/safety';
import { Button, Modal } from '@tamgiao/ui-web';
import { MODERATION_COPY } from './copy';
import { useBanUser } from './moderation-api';

export interface BanDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly userId: string;
  readonly reportId?: string;
  readonly onBanned?: () => void;
}

export function BanDialog({ open, onClose, userId, reportId, onBanned }: BanDialogProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);

  const banMutation = useBanUser();
  const reasonId = useId();
  const checkboxId = useId();

  useEffect(() => {
    if (open) {
      setStep(1);
      setReason('');
      setConfirmed(false);
      setReasonError(null);
      setApiError(null);
    }
  }, [open]);

  const handleClose = () => {
    setStep(1);
    setReason('');
    setConfirmed(false);
    setReasonError(null);
    setApiError(null);
    onClose();
  };

  const handleStep1Submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = reason.trim();
    if (trimmed.length === 0) {
      setReasonError(MODERATION_COPY.banDialog.reasonRequired);
      return;
    }
    if (trimmed.length > BAN_REASON_MAX_LENGTH) {
      setReasonError(MODERATION_COPY.banDialog.reasonTooLong(BAN_REASON_MAX_LENGTH));
      return;
    }

    setReasonError(null);
    setStep(2);
  };

  const handleStep2Submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!confirmed) return;

    setApiError(null);
    banMutation.mutate(
      {
        userId,
        body: {
          reason: reason.trim(),
          ...(reportId ? { reportId } : {}),
        },
      },
      {
        onSuccess: () => {
          handleClose();
          onBanned?.();
        },
        onError: (err) => {
          const m = messageFor(isApiError(err) ? err : { code: 'UNKNOWN' });
          setApiError(m.title);
        },
      },
    );
  };

  return (
    <Modal open={open} onClose={handleClose} title={MODERATION_COPY.banDialog.title}>
      {step === 1 ? (
        <form noValidate onSubmit={handleStep1Submit} className="flex flex-col gap-space-md">
          <h3 className="text-title-md font-semibold text-on-surface">
            {MODERATION_COPY.banDialog.step1Title}
          </h3>

          <div className="flex flex-col gap-space-xs">
            <label htmlFor={reasonId} className="text-label-md font-medium text-on-surface">
              {MODERATION_COPY.banDialog.reasonLabel}
            </label>
            <textarea
              id={reasonId}
              rows={4}
              value={reason}
              maxLength={BAN_REASON_MAX_LENGTH}
              placeholder={MODERATION_COPY.banDialog.reasonPlaceholder}
              aria-invalid={reasonError ? 'true' : undefined}
              onChange={(e) => {
                setReason(e.target.value);
                setReasonError(null);
              }}
              className={`px-space-md py-space-sm rounded-md bg-surface-container-lowest text-on-surface text-body-md border transition-colors ${
                reasonError
                  ? 'border-error focus:border-error'
                  : 'border-outline-variant focus:border-primary'
              }`}
            />
            {reasonError ? (
              <p role="alert" className="text-body-sm text-error">
                {reasonError}
              </p>
            ) : null}
            <div className="text-body-sm text-secondary text-right">
              {reason.length}/{BAN_REASON_MAX_LENGTH}
            </div>
          </div>

          <div className="flex justify-end gap-space-sm pt-space-xs border-t border-surface-container-high">
            <Button type="button" variant="ghost" onClick={handleClose}>
              {MODERATION_COPY.banDialog.cancel}
            </Button>
            <Button type="submit" variant="primary">
              {MODERATION_COPY.banDialog.next}
            </Button>
          </div>
        </form>
      ) : (
        <form noValidate onSubmit={handleStep2Submit} className="flex flex-col gap-space-md">
          <h3 className="text-title-md font-semibold text-on-surface">
            {MODERATION_COPY.banDialog.step2Title}
          </h3>

          {apiError ? (
            <div
              role="alert"
              className="p-space-sm rounded-md bg-error-container text-on-error-container text-body-sm"
            >
              {apiError}
            </div>
          ) : null}

          <div className="p-space-md rounded-lg bg-surface-container-low border border-surface-container-high flex flex-col gap-space-xs text-body-sm">
            <div>
              <span className="font-medium text-secondary">{MODERATION_COPY.banDialog.userLabel}: </span>
              <span className="font-mono text-on-surface">{userId}</span>
            </div>
            {reportId ? (
              <div>
                <span className="font-medium text-secondary">
                  {MODERATION_COPY.banDialog.reportIdLabel}:{' '}
                </span>
                <span className="font-mono text-on-surface">{reportId}</span>
              </div>
            ) : null}
          </div>

          <div className="p-space-md rounded-lg bg-error-container/40 border border-error text-error text-body-md font-medium">
            {MODERATION_COPY.banDialog.warningText}
          </div>

          <label
            htmlFor={checkboxId}
            className="inline-flex items-center gap-space-xs text-body-md text-on-surface cursor-pointer select-none"
          >
            <input
              id={checkboxId}
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="w-4 h-4 rounded border-outline text-primary focus:ring-primary"
            />
            <span>{MODERATION_COPY.banDialog.confirmCheckbox}</span>
          </label>

          <div className="flex justify-between items-center gap-space-sm pt-space-xs border-t border-surface-container-high">
            <Button type="button" variant="ghost" onClick={() => setStep(1)} disabled={banMutation.isPending}>
              {MODERATION_COPY.banDialog.back}
            </Button>
            <div className="flex gap-space-sm">
              <Button type="button" variant="ghost" onClick={handleClose} disabled={banMutation.isPending}>
                {MODERATION_COPY.banDialog.cancel}
              </Button>
              <Button type="submit" variant="danger" disabled={!confirmed || banMutation.isPending}>
                {MODERATION_COPY.banDialog.submit}
              </Button>
            </div>
          </div>
        </form>
      )}
    </Modal>
  );
}
