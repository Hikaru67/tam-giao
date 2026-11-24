import { useState } from 'react';
import { MATCH_STAFF_NOTE_MAX_LENGTH } from '@tamgiao/contracts/matching';
import { Button, Card, Modal } from '@tamgiao/ui-web';
import { MATCHING_COPY } from './copy';

export interface ProposeFormProps {
  readonly userAId: string;
  readonly userBId: string;
  readonly isSubmitting: boolean;
  readonly disabled?: boolean;
  readonly onSubmit: (data: { userAId: string; userBId: string; staffNote: string | null }) => void;
}

export function ProposeForm({
  userAId,
  userBId,
  isSubmitting,
  disabled = false,
  onSubmit,
}: ProposeFormProps) {
  const [staffNote, setStaffNote] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);

  function handleOpenConfirm() {
    setIsModalOpen(true);
  }

  function handleConfirm() {
    setIsModalOpen(false);
    const trimmed = staffNote.trim();
    onSubmit({
      userAId,
      userBId,
      staffNote: trimmed.length > 0 ? trimmed : null,
    });
  }

  return (
    <Card className="flex flex-col gap-space-md">
      <h3 className="text-title-md font-bold text-on-surface">{MATCHING_COPY.propose.staffNoteSection}</h3>

      <div className="flex flex-col gap-space-xs">
        <label htmlFor="staff-note-input" className="text-label-md font-medium text-on-surface">
          {MATCHING_COPY.propose.staffNoteLabel}
        </label>
        <textarea
          id="staff-note-input"
          value={staffNote}
          maxLength={MATCH_STAFF_NOTE_MAX_LENGTH}
          disabled={disabled || isSubmitting}
          placeholder={MATCHING_COPY.propose.staffNotePlaceholder}
          onChange={(e) => setStaffNote(e.target.value)}
          rows={3}
          className="w-full px-space-md py-space-xs rounded-md bg-surface-container-lowest text-on-surface text-body-md border border-outline-variant hover:border-outline focus:border-primary outline-none resize-none transition-colors"
        />
        <div className="flex justify-end">
          <span className="text-body-sm text-secondary">
            {MATCHING_COPY.propose.staffNoteCounter(staffNote.length, MATCH_STAFF_NOTE_MAX_LENGTH)}
          </span>
        </div>
      </div>

      <div className="flex justify-end pt-space-xs">
        <Button
          variant="primary"
          size="lg"
          disabled={disabled || isSubmitting}
          loading={isSubmitting}
          onClick={handleOpenConfirm}
        >
          {MATCHING_COPY.propose.submitButton}
        </Button>
      </div>

      <Modal
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={MATCHING_COPY.propose.confirmModalTitle}
      >
        <div className="flex flex-col gap-space-lg">
          <p className="text-body-md text-secondary">{MATCHING_COPY.propose.confirmModalDesc}</p>

          <div className="flex justify-end gap-space-sm">
            <Button variant="ghost" onClick={() => setIsModalOpen(false)} disabled={isSubmitting}>
              {MATCHING_COPY.propose.cancel}
            </Button>
            <Button variant="primary" onClick={handleConfirm} loading={isSubmitting}>
              {MATCHING_COPY.propose.confirmSubmit}
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}
