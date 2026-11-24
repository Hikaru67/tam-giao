import type { DatePlanDto } from '@tamgiao/contracts/dating';
import { Button } from '@tamgiao/ui-mobile';
import { useRouter } from 'expo-router';
import type { DateView } from '../dates/date-view.js';
import { FEEDBACK_COPY } from './copy.js';
import { useMyFeedback } from './use-feedback.js';

export interface FeedbackEntryProps {
  readonly plan: DatePlanDto;
  readonly view: DateView;
}

export function FeedbackEntry({ plan, view }: FeedbackEntryProps) {
  const router = useRouter();
  // BE cho đánh giá từ giờ bắt đầu buổi hẹn.
  const isAvailable =
    view.kind === 'in_progress' || view.kind === 'awaiting_feedback' || view.kind === 'completed';
  const feedbackQuery = useMyFeedback(plan.id, isAvailable);

  if (!isAvailable) return null;

  const hasFeedback = Boolean(feedbackQuery.data?.feedback);
  const label = hasFeedback ? FEEDBACK_COPY.entry.viewFeedback : FEEDBACK_COPY.entry.giveFeedback;

  return (
    <Button
      testID="date-feedback"
      variant="secondary"
      size="md"
      fullWidth
      onPress={() => {
        router.push({
          pathname: '/(main)/dates/feedback',
          params: { datePlanId: plan.id },
        });
      }}
    >
      {label}
    </Button>
  );
}
