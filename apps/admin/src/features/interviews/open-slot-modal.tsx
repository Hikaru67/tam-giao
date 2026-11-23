import { useState, type FormEvent } from 'react';
import { isApiError, messageFor } from '@tamgiao/api-client';
import { Button, Modal, TextField } from '@tamgiao/ui-web';
import { INTERVIEW_DURATION_MINUTES } from '@tamgiao/contracts/constants';
import { INTERVIEWS_COPY } from './copy';
import { useOpenInterviewSlot } from './use-interview-slots';
import { localInputToIso, toLocalInputValue } from './week';

interface FormErrors {
  startsAt?: string | undefined;
  meetingUrl?: string | undefined;
}

export interface OpenSlotModalProps {
  onClose: () => void;
  /** Giờ gợi ý ban đầu cho ô giờ bắt đầu (giờ địa phương). */
  defaultStart: Date;
  onCreated: () => void;
}

/** Hộp thoại mở slot — chỉ render khi đang mở, nên state/mutation luôn mới mỗi lần mở. */
export function OpenSlotModal({ onClose, defaultStart, onCreated }: OpenSlotModalProps) {
  const openMutation = useOpenInterviewSlot();

  const [startsAt, setStartsAt] = useState(() => toLocalInputValue(defaultStart));
  const [meetingUrl, setMeetingUrl] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const newErrors: FormErrors = {};
    const iso = localInputToIso(startsAt);

    if (iso === null) {
      newErrors.startsAt = INTERVIEWS_COPY.openSlotModal.errors.startsAtRequired;
    }

    const trimmedUrl = meetingUrl.trim();
    if (trimmedUrl && !/^https?:\/\//.test(trimmedUrl)) {
      newErrors.meetingUrl = INTERVIEWS_COPY.openSlotModal.errors.meetingUrlInvalid;
    }

    if (iso === null || newErrors.meetingUrl !== undefined) {
      setErrors(newErrors);
      return;
    }

    setErrors({});
    openMutation.mutate(
      { startsAt: iso, meetingUrl: trimmedUrl === '' ? null : trimmedUrl },
      {
        onSuccess: () => {
          onCreated();
          onClose();
        },
      },
    );
  }

  const apiError = openMutation.error;
  const errorInfo = apiError ? messageFor(isApiError(apiError) ? apiError : { code: 'UNKNOWN' }) : null;

  return (
    <Modal open onClose={onClose} title={INTERVIEWS_COPY.openSlotModal.title}>
      {errorInfo ? (
        <div
          role="alert"
          className="bg-error-container text-on-error-container rounded-lg p-space-md mb-space-md flex flex-col gap-space-xs"
        >
          <span className="font-semibold text-body-md">{errorInfo.title}</span>
          {errorInfo.action ? <span className="text-body-sm">{errorInfo.action}</span> : null}
        </div>
      ) : null}

      <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-space-md">
        <TextField
          id="open-slot-starts-at"
          type="datetime-local"
          label={INTERVIEWS_COPY.openSlotModal.startsAtLabel}
          hint={INTERVIEWS_COPY.openSlotModal.durationHint(INTERVIEW_DURATION_MINUTES)}
          value={startsAt}
          onChange={(e) => {
            setStartsAt(e.target.value);
            if (errors.startsAt) {
              setErrors((prev) => ({ ...prev, startsAt: undefined }));
            }
          }}
          {...(errors.startsAt ? { error: errors.startsAt } : {})}
        />

        <TextField
          id="open-slot-meeting-url"
          type="url"
          label={INTERVIEWS_COPY.openSlotModal.meetingUrlLabel}
          placeholder={INTERVIEWS_COPY.openSlotModal.meetingUrlPlaceholder}
          value={meetingUrl}
          onChange={(e) => {
            setMeetingUrl(e.target.value);
            if (errors.meetingUrl) {
              setErrors((prev) => ({ ...prev, meetingUrl: undefined }));
            }
          }}
          {...(errors.meetingUrl ? { error: errors.meetingUrl } : {})}
        />

        <div className="flex items-center justify-end gap-space-sm mt-space-md">
          <Button type="button" variant="ghost" onClick={onClose} disabled={openMutation.isPending}>
            {INTERVIEWS_COPY.openSlotModal.cancel}
          </Button>
          <Button type="submit" variant="primary" loading={openMutation.isPending}>
            {INTERVIEWS_COPY.openSlotModal.submit}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
