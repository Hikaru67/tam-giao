import { Badge } from '@tamgiao/ui-web';
import type { AdminInterviewSlot } from '@tamgiao/contracts/verification';
import { INTERVIEWS_COPY } from './copy';
import { formatDayLabel, formatTime, groupSlotsByDay, isSameLocalDay, weekDays } from './week';

export interface InterviewWeekCalendarProps {
  weekStart: Date;
  slots: readonly AdminInterviewSlot[];
  onSelectSlot: (slot: AdminInterviewSlot) => void;
}

export function InterviewWeekCalendar({ weekStart, slots, onSelectSlot }: InterviewWeekCalendarProps) {
  const days = weekDays(weekStart);
  const slotGroups = groupSlotsByDay(slots, weekStart);
  const today = new Date();

  return (
    <div className="flex flex-col gap-space-md">
      {/* Chú thích (legend) 3 trạng thái */}
      <div className="flex flex-wrap items-center gap-space-md p-space-sm bg-surface-container-low rounded-lg text-body-sm text-secondary">
        <span className="font-medium text-on-surface">{INTERVIEWS_COPY.legendTitle}:</span>
        <div className="flex items-center gap-space-xs">
          <span className="w-3 h-3 rounded-full border border-dashed border-outline-variant bg-surface-container-lowest inline-block" />
          <span>{INTERVIEWS_COPY.statusLabels.OPEN}</span>
        </div>
        <div className="flex items-center gap-space-xs">
          <span className="w-3 h-3 rounded-full bg-primary-fixed border border-primary inline-block" />
          <span>{INTERVIEWS_COPY.statusLabels.BOOKED}</span>
        </div>
        <div className="flex items-center gap-space-xs">
          <span className="w-3 h-3 rounded-full bg-secondary-container border border-secondary inline-block" />
          <span>{INTERVIEWS_COPY.statusLabels.COMPLETED}</span>
        </div>
      </div>

      {/* Lưới 7 cột */}
      <div className="overflow-x-auto">
        <div className="grid grid-cols-7 gap-space-xs min-w-[760px]">
          {days.map((day, index) => {
            const isToday = isSameLocalDay(day, today);
            const { weekday, date } = formatDayLabel(day);
            const daySlots = slotGroups[index] ?? [];

            return (
              <div
                key={day.toISOString()}
                className={`flex flex-col rounded-lg border border-surface-container-high bg-surface-container-low/40 p-space-xs min-h-[320px] ${
                  isToday ? 'ring-2 ring-primary ring-offset-1 bg-surface-container-low' : ''
                }`}
              >
                {/* Header ngày */}
                <div
                  className={`p-space-xs text-center border-b border-surface-container-high rounded-t-md mb-space-xs ${
                    isToday ? 'bg-primary-fixed text-on-primary-fixed font-bold' : 'bg-surface-container'
                  }`}
                >
                  <div className={`text-label-md ${isToday ? 'font-bold' : 'font-semibold'}`}>{weekday}</div>
                  <div className={`text-body-sm ${isToday ? 'opacity-90' : 'text-secondary'}`}>{date}</div>
                </div>

                {/* Danh sách slot trong ngày */}
                <div className="flex-1 flex flex-col gap-space-xs">
                  {daySlots.length === 0 ? (
                    <p className="text-body-sm text-secondary py-space-md text-center">
                      {INTERVIEWS_COPY.emptyDay}
                    </p>
                  ) : (
                    daySlots.map((slot) => {
                      const timeRange = `${formatTime(slot.startsAt)}–${formatTime(slot.endsAt)}`;
                      const statusLabel = INTERVIEWS_COPY.statusLabels[slot.status];
                      const ariaLabel = INTERVIEWS_COPY.slotAriaLabel(timeRange, statusLabel);

                      let slotClasses = '';
                      let badgeTone: 'neutral' | 'primary' | 'success' = 'neutral';

                      if (slot.status === 'OPEN') {
                        slotClasses =
                          'border border-dashed border-outline-variant bg-surface-container-lowest text-on-surface opacity-80 cursor-not-allowed';
                        badgeTone = 'neutral';
                      } else if (slot.status === 'BOOKED') {
                        slotClasses =
                          'border border-primary bg-primary-fixed text-on-primary-fixed hover:opacity-90 cursor-pointer shadow-sm';
                        badgeTone = 'primary';
                      } else {
                        slotClasses =
                          'border border-secondary-container bg-secondary-container text-on-secondary-container hover:opacity-90 cursor-pointer shadow-sm';
                        badgeTone = 'success';
                      }

                      return (
                        <button
                          key={slot.id}
                          type="button"
                          disabled={slot.status === 'OPEN'}
                          data-status={slot.status}
                          aria-label={ariaLabel}
                          onClick={slot.status !== 'OPEN' ? () => onSelectSlot(slot) : undefined}
                          className={`flex flex-col gap-space-xs p-space-xs rounded-md text-left transition-all ${slotClasses}`}
                        >
                          <div className="flex items-center justify-between gap-space-xs flex-wrap">
                            <span className="text-label-md font-bold">{timeRange}</span>
                            <Badge tone={badgeTone}>{statusLabel}</Badge>
                          </div>
                          {slot.status === 'COMPLETED' && slot.outcome ? (
                            <div>
                              <Badge tone={slot.outcome === 'PASSED' ? 'success' : 'danger'}>
                                {INTERVIEWS_COPY.outcomeLabels[slot.outcome]}
                              </Badge>
                            </div>
                          ) : null}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
