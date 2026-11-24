import { useEffect, useRef } from 'react';
import type { CurrentMatchDto } from '@tamgiao/contracts/matching';
import { Button, Card, Text } from '@tamgiao/ui-mobile';
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { MATCH_COPY } from './copy.js';
import { useOpenConversationId } from './use-match.js';

export function MatchDatingCard({ match, autoOpen }: { match: CurrentMatchDto; autoOpen: boolean }) {
  const router = useRouter();
  const conversationId = useOpenConversationId(match.counterpart?.userId ?? null);
  const hasAutoOpenedRef = useRef(false);

  useEffect(() => {
    if (autoOpen && conversationId !== null && !hasAutoOpenedRef.current) {
      hasAutoOpenedRef.current = true;
      router.push(`/(main)/chat/${conversationId}`);
    }
  }, [autoOpen, conversationId, router]);

  const phaseKey = match.phase === 'MET' ? 'MET' : 'DATING';
  const phaseContent = MATCH_COPY.phases[phaseKey];

  return (
    <Card
      testID={`match-phase-${match.phase}`}
      className="gap-space-md p-space-md bg-surface-container-lowest"
    >
      <View className="gap-space-xs">
        <Text variant="title-md" className="font-bold text-on-surface">
          {phaseContent.title}
        </Text>
        <Text variant="body-md" className="text-secondary leading-relaxed">
          {phaseContent.description}
        </Text>
      </View>
      <Button
        variant="primary"
        testID="match-open-chat"
        fullWidth
        disabled={conversationId === null}
        onPress={() => {
          if (conversationId !== null) {
            router.push(`/(main)/chat/${conversationId}`);
          }
        }}
      >
        {conversationId === null ? MATCH_COPY.dating.openingChat : MATCH_COPY.dating.openChat}
      </Button>
    </Card>
  );
}
