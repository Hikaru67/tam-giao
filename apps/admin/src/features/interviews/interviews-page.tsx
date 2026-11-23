import { useState } from 'react';
import { isApiError, messageFor } from '@tamgiao/api-client';
import { Button, Card, ErrorState } from '@tamgiao/ui-web';
import type { AdminInterviewSlot } from '@tamgiao/contracts/verification';
import { NAV_COPY } from '../../layout/copy';
import { INTERVIEWS_COPY } from './copy';
import { InterviewWeekCalendar } from './interview-week-calendar';
import { InterviewNotesModal } from './interview-notes-modal';
import { OpenSlotModal } from './open-slot-modal';
import { useInterviewSlots } from './use-interview-slots';
import { addDays, defaultSlotStart, formatWeekRange, startOfWeek } from './week';

export function InterviewsPage() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [openModal, setOpenModal] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<AdminInterviewSlot | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const query = useInterviewSlots(weekStart);

  if (query.isError && isApiError(query.error) && query.error.status === 403) {
    throw query.error;
  }

  return (
    <div className="flex flex-col gap-space-lg">
      {/* Tiêu đề & nút hành động */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-space-md">
        <div>
          <h1 className="text-headline-md font-bold text-on-surface">{NAV_COPY.interviews}</h1>
          <p className="text-body-md text-secondary mt-space-xs">{INTERVIEWS_COPY.description}</p>
        </div>
        <div>
          <Button
            variant="primary"
            size="md"
            onClick={() => {
              setNotice(null);
              setOpenModal(true);
            }}
          >
            {INTERVIEWS_COPY.openSlotButton}
          </Button>
        </div>
      </div>

      {/* Thông báo thao tác */}
      {notice ? (
        <div
          role="status"
          className="p-space-sm px-space-md rounded-md bg-secondary-container text-on-secondary-container text-body-sm font-medium flex items-center justify-between shadow-sm"
        >
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="text-secondary hover:text-on-surface font-bold text-label-md ml-space-sm cursor-pointer"
            aria-label={INTERVIEWS_COPY.dismissNotice}
          >
            ✕
          </button>
        </div>
      ) : null}

      {/* Thanh điều hướng tuần */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-space-sm">
        <div className="flex items-center gap-space-xs">
          <Button variant="secondary" size="md" onClick={() => setWeekStart((prev) => addDays(prev, -7))}>
            {INTERVIEWS_COPY.prevWeek}
          </Button>
          <Button variant="ghost" size="md" onClick={() => setWeekStart(startOfWeek(new Date()))}>
            {INTERVIEWS_COPY.currentWeek}
          </Button>
          <Button variant="secondary" size="md" onClick={() => setWeekStart((prev) => addDays(prev, 7))}>
            {INTERVIEWS_COPY.nextWeek}
          </Button>
        </div>
        <div className="flex flex-col sm:items-end">
          <span className="text-title-md font-bold text-on-surface">{formatWeekRange(weekStart)}</span>
          <span className="text-body-sm text-secondary">{INTERVIEWS_COPY.timezoneNotice}</span>
        </div>
      </div>

      {/* Nội dung lịch */}
      {query.isLoading ? (
        <div role="status" className="p-space-lg text-center text-secondary text-body-md">
          {INTERVIEWS_COPY.loading}
        </div>
      ) : query.isError ? (
        <ErrorState
          title={messageFor(isApiError(query.error) ? query.error : { code: 'UNKNOWN' }).title}
          onRetry={() => void query.refetch()}
        />
      ) : query.data ? (
        <Card>
          <InterviewWeekCalendar
            weekStart={weekStart}
            slots={query.data.items}
            onSelectSlot={(slot) => {
              setNotice(null);
              setSelectedSlot(slot);
            }}
          />
        </Card>
      ) : null}

      {/* Modal mở slot */}
      {openModal ? (
        <OpenSlotModal
          onClose={() => setOpenModal(false)}
          defaultStart={defaultSlotStart(weekStart, new Date())}
          onCreated={() => setNotice(INTERVIEWS_COPY.openSlotModal.successNotice)}
        />
      ) : null}

      {/* Modal ghi chú phỏng vấn */}
      {selectedSlot ? (
        <InterviewNotesModal
          key={selectedSlot.id}
          slot={selectedSlot}
          onClose={() => setSelectedSlot(null)}
          onSaved={() => setNotice(INTERVIEWS_COPY.notesModal.successNotice)}
        />
      ) : null}
    </div>
  );
}
