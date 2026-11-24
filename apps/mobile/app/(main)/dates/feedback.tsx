import { Redirect, useLocalSearchParams } from 'expo-router';
import { FeedbackScreen } from '../../../src/features/feedback/index.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_REGEX.test(value);
}

export default function FeedbackRoute() {
  const { datePlanId } = useLocalSearchParams<{ datePlanId?: string }>();

  if (!isValidUuid(datePlanId)) {
    return <Redirect href="/(main)/dates" />;
  }

  return <FeedbackScreen datePlanId={datePlanId} />;
}
