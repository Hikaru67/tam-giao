import { useState, type FormEvent } from 'react';
import { isApiError, messageFor } from '@tamgiao/api-client';
import { Button, Modal } from '@tamgiao/ui-web';
import { INTERVIEW_OUTCOME_VALUES, type AdminInterviewSlot } from '@tamgiao/contracts/verification';
import { INTERVIEWS_COPY, type InterviewOutcome } from './copy';
import { useRecordInterviewNotes } from './use-interview-slots';
import { formatDayLabel, formatTime } from './week';

/** Khớp `recordInterviewResultBodySchema` (notes tối đa 4000 ký tự). */
const NOTES_MAX_LENGTH = 4000;

interface FormErrors {
  outcome?: string | undefined;
  notes?: string | undefined;
}

export interface InterviewNotesModalProps {
  slot: AdminInterviewSlot;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Hộp thoại ghi nhận xét + kết quả cho slot BOOKED/COMPLETED. Nơi render đặt `key={slot.id}` để state không lẫn
 * giữa các slot. Nhận xét có thể chứa thông tin cá nhân — không log.
 */

export function InterviewNotesModal({ slot, onClose, onSaved }: InterviewNotesModalProps) {
  const recordMutation = useRecordInterviewNotes();

  const [outcome, setOutcome] = useState<InterviewOutcome | null>(slot.outcome);
  const [notes, setNotes] = useState<string>(slot.notes ?? '');
  const [errors, setErrors] = useState<FormErrors>({});

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const newErrors: FormErrors = {};
    if (outcome === null) {
      newErrors.outcome = INTERVIEWS_COPY.notesModal.errors.outcomeRequired;
    }

    const trimmedNotes = notes.trim();
    if (!trimmedNotes) {
      newErrors.notes = INTERVIEWS_COPY.notesModal.errors.notesRequired;
    }

    if (outcome === null || newErrors.notes !== undefined) {
      setErrors(newErrors);
      return;
    }

    setErrors({});
    recordMutation.mutate(
      { slotId: slot.id, body: { outcome, notes: trimmedNotes } },
      {
        onSuccess: () => {
          onSaved();
          onClose();
        },
      },
    );
  }

  const slotDate = new Date(slot.startsAt);
  const { weekday, date } = formatDayLabel(slotDate);
  const timeLabel = `${weekday}, ${date} · ${formatTime(slot.startsAt)}–${formatTime(slot.endsAt)}`;

  const apiError = recordMutation.error;
  const errorInfo = apiError ? messageFor(isApiError(apiError) ? apiError : { code: 'UNKNOWN' }) : null;

  return (
    <Modal open onClose={onClose} title={INTERVIEWS_COPY.notesModal.title}>
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
        {/* Thời gian slot */}
        <div className="p-space-sm rounded-lg bg-surface-container-low text-on-surface">
          <span className="text-body-sm text-secondary block">{INTERVIEWS_COPY.notesModal.timeLabel}</span>
          <span className="text-title-md font-semibold">{timeLabel}</span>
        </div>

        {/* Nhóm radio kết quả */}
        <fieldset className="flex flex-col gap-space-xs">
          <legend className="text-label-md font-medium text-on-surface">
            {INTERVIEWS_COPY.notesModal.outcomeLabel}
          </legend>
          <div className="flex items-center gap-space-lg mt-space-xs">
            {INTERVIEW_OUTCOME_VALUES.map((val) => (
              <label
                key={val}
                className="flex items-center gap-space-xs cursor-pointer text-body-md text-on-surface"
              >
                <input
                  type="radio"
                  name="outcome"
                  value={val}
                  checked={outcome === val}
                  onChange={() => {
                    setOutcome(val);
                    if (errors.outcome) {
                      setErrors((prev) => ({ ...prev, outcome: undefined }));
                    }
                  }}
                  className="accent-primary w-4 h-4 cursor-pointer"
                />
                <span>{INTERVIEWS_COPY.outcomeLabels[val]}</span>
              </label>
            ))}
          </div>
          {errors.outcome ? <p className="text-body-sm text-error">{errors.outcome}</p> : null}
        </fieldset>

        {/* Textarea nhận xét */}
        <div className="flex flex-col gap-space-xs w-full">
          <div className="flex items-center justify-between">
            <label htmlFor="interview-notes-textarea" className="text-label-md font-medium text-on-surface">
              {INTERVIEWS_COPY.notesModal.notesLabel}
            </label>
            <span className="text-body-sm text-secondary">
              {notes.length}/{NOTES_MAX_LENGTH}
            </span>
          </div>
          <textarea
            id="interview-notes-textarea"
            rows={4}
            maxLength={NOTES_MAX_LENGTH}
            placeholder={INTERVIEWS_COPY.notesModal.notesPlaceholder}
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
              if (errors.notes) {
                setErrors((prev) => ({ ...prev, notes: undefined }));
              }
            }}
            className={`w-full min-h-[100px] p-space-md rounded-md bg-surface-container-lowest text-on-surface text-body-md border transition-colors outline-none focus:ring-2 focus:ring-primary ${
              errors.notes
                ? 'border-error focus:border-error'
                : 'border-outline-variant hover:border-outline focus:border-primary'
            }`}
          />
          {errors.notes ? <p className="text-body-sm text-error">{errors.notes}</p> : null}
        </div>

        <div className="flex items-center justify-end gap-space-sm mt-space-md">
          <Button type="button" variant="ghost" onClick={onClose} disabled={recordMutation.isPending}>
            {INTERVIEWS_COPY.notesModal.cancel}
          </Button>
          <Button type="submit" variant="primary" loading={recordMutation.isPending}>
            {INTERVIEWS_COPY.notesModal.submit}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
