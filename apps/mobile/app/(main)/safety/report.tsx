import { Redirect, useLocalSearchParams } from 'expo-router';
import { ReportScreen } from '../../../src/features/safety/index.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_REGEX.test(value);
}

export default function ReportRoute() {
  const { reportedUserId } = useLocalSearchParams<{ reportedUserId?: string }>();

  if (!isValidUuid(reportedUserId)) {
    return <Redirect href="/(main)/safety" />;
  }

  return <ReportScreen reportedUserId={reportedUserId} />;
}
