import { SAFETY_RESPONSE_SLA_MINUTES } from '@tamgiao/contracts/constants';
import type { FileReportResponse } from '@tamgiao/contracts/safety';
import { Button, Text } from '@tamgiao/ui-mobile';
import { useRouter } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { REPORT_COPY } from './copy.js';

export interface ReportSentScreenProps {
  report: FileReportResponse;
}

export function ReportSentScreen({ report }: ReportSentScreenProps) {
  const router = useRouter();

  return (
    <ScrollView testID="report-sent" contentContainerClassName="flex-grow justify-center p-gutter bg-surface">
      <View className="items-center gap-space-md">
        <View className="w-16 h-16 rounded-full bg-primary/10 items-center justify-center">
          <Text variant="display" className="text-primary font-bold">
            ✓
          </Text>
        </View>

        <Text variant="headline-sm" className="font-bold text-on-surface text-center">
          {REPORT_COPY.sent.title}
        </Text>

        <Text variant="body-md" className="text-secondary text-center">
          {REPORT_COPY.sent.description}
        </Text>

        <View className="w-full bg-surface-container-low rounded-xl p-space-md mt-space-sm border border-surface-container-high/60">
          <Text variant="label-md" className="font-semibold text-on-surface mb-1">
            {report.urgent ? REPORT_COPY.sent.urgentTitle : REPORT_COPY.sent.normalTitle}
          </Text>
          <Text variant="body-sm" className="text-secondary">
            {report.urgent
              ? REPORT_COPY.sent.urgentNotice(SAFETY_RESPONSE_SLA_MINUTES)
              : REPORT_COPY.sent.normalNotice}
          </Text>
        </View>

        <View className="w-full mt-space-lg">
          <Button
            testID="report-sent-home"
            variant="primary"
            size="lg"
            fullWidth
            onPress={() => router.replace('/(main)/home')}
          >
            {REPORT_COPY.sent.backHome}
          </Button>
        </View>
      </View>
    </ScrollView>
  );
}
