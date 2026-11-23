import { useRouter } from 'expo-router';
import { Button, Card, Text } from '@tamgiao/ui-mobile';
import { INTERVIEW_ROUTE } from './constants.js';
import { INTERVIEW_COPY } from './copy.js';
import { formatLocalDate, formatLocalTime } from './interview-time.js';
import { useMyInterview } from './use-interview.js';

export function InterviewEntryCard() {
  const router = useRouter();
  const { data, isLoading, isError } = useMyInterview();

  if (isLoading || isError || !data) {
    return null;
  }

  const booking = data.booking;

  return (
    <Card testID="interview-entry-card" className="gap-space-sm">
      <Text variant="title-md" className="font-bold text-on-surface">
        {INTERVIEW_COPY.entry.title}
      </Text>
      {booking ? (
        <>
          <Text variant="body-md" className="text-secondary leading-relaxed">
            {INTERVIEW_COPY.entry.booked(
              formatLocalDate(booking.startsAt),
              formatLocalTime(booking.startsAt),
            )}
          </Text>
          <Button variant="secondary" size="md" onPress={() => router.push(INTERVIEW_ROUTE)}>
            {INTERVIEW_COPY.entry.viewCta}
          </Button>
        </>
      ) : (
        <>
          <Text variant="body-md" className="text-secondary leading-relaxed">
            {INTERVIEW_COPY.entry.notBooked}
          </Text>
          <Button variant="primary" size="md" onPress={() => router.push(INTERVIEW_ROUTE)}>
            {INTERVIEW_COPY.entry.bookCta}
          </Button>
        </>
      )}
    </Card>
  );
}
