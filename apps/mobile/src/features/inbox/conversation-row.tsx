import { useCurrentMatch } from '../match/index.js';
import { Avatar, Badge, Text } from '@tamgiao/ui-mobile';
import type { ConversationSummaryDto } from '@tamgiao/contracts/messaging';
import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';
import { INBOX_COPY } from './copy.js';

export function formatConversationTime(isoString: string, now: Date = new Date()): string {
  const date = new Date(isoString);
  const time = date.getTime();
  if (Number.isNaN(time)) {
    return '';
  }
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');

  if (isToday) {
    return `${hours}:${minutes}`;
  }

  const day = date.getDate().toString().padStart(2, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  return `${day}/${month}`;
}

export function getLastMessageText(
  lastMessage: ConversationSummaryDto['lastMessage'],
  peerUserId: string,
): string {
  if (lastMessage === null) {
    return INBOX_COPY.noMessage;
  }
  if (lastMessage.kind === 'SYSTEM' || lastMessage.senderId === null) {
    return lastMessage.body;
  }
  if (lastMessage.senderId !== peerUserId) {
    return `${INBOX_COPY.youPrefix}${lastMessage.body}`;
  }
  return lastMessage.body;
}

export interface ConversationRowProps {
  conversation: ConversationSummaryDto;
}

export function ConversationRow({ conversation }: ConversationRowProps) {
  const router = useRouter();
  const matchQuery = useCurrentMatch();
  const match = matchQuery.data?.match ?? null;

  const counterpart = match?.counterpart ?? null;
  const isCounterpart = counterpart !== null && counterpart.userId === conversation.peerUserId;
  const displayName = isCounterpart ? counterpart.displayName : INBOX_COPY.peerFallback;
  const avatarUrl = isCounterpart ? (counterpart.avatar?.url ?? null) : null;
  const initials = displayName.slice(0, 2);

  const timestamp =
    conversation.lastMessage !== null ? conversation.lastMessage.sentAt : conversation.openedAt;
  const formattedTime = formatConversationTime(timestamp);
  const lastMessageText = getLastMessageText(conversation.lastMessage, conversation.peerUserId);

  const isOpen = conversation.status === 'OPEN';

  return (
    <Pressable
      testID={`inbox-row-${conversation.conversationId}`}
      accessibilityRole="button"
      accessibilityLabel={displayName}
      onPress={() => {
        router.push(`/(main)/chat/${conversation.conversationId}`);
      }}
      className="mx-margin mb-space-sm p-space-md rounded-xl bg-surface-container-lowest active:bg-surface-container-low shadow-sm gap-space-sm"
    >
      {isOpen ? (
        <View className="flex-row items-center justify-between px-space-sm py-space-xs rounded-xl bg-surface-container-high/60">
          <Text variant="label-md" className="font-semibold text-primary">
            {INBOX_COPY.dayMilestone(conversation.datingDay, conversation.datingDays)}
          </Text>
          <Pressable
            testID={`inbox-date-${conversation.conversationId}`}
            accessibilityRole="button"
            accessibilityLabel={INBOX_COPY.scheduleDate}
            onPress={() => {
              router.push('/(main)/dates');
            }}
            className="px-space-sm py-1 rounded-full bg-surface-container-lowest active:bg-surface-container"
          >
            <Text variant="label-sm" className="font-semibold text-primary">
              {INBOX_COPY.scheduleDate}
            </Text>
          </Pressable>
        </View>
      ) : null}

      <View className="flex-row items-center gap-space-sm">
        <Avatar src={avatarUrl} initials={initials} size="md" />
        <View className="flex-1 min-w-0 justify-center gap-0.5">
          <View className="flex-row items-center justify-between">
            <Text
              variant="title-md"
              numberOfLines={1}
              ellipsizeMode="tail"
              className="font-bold text-on-surface flex-1 mr-space-xs"
            >
              {displayName}
            </Text>
            <Text variant="body-sm" className="text-secondary shrink-0">
              {formattedTime}
            </Text>
          </View>
          <View className="flex-row items-center justify-between">
            <Text
              variant="body-sm"
              numberOfLines={1}
              ellipsizeMode="tail"
              className="text-secondary flex-1 mr-space-xs"
            >
              {lastMessageText}
            </Text>
            {conversation.unreadCount > 0 ? (
              <Badge testID={`inbox-unread-${conversation.conversationId}`} tone="primary">
                {conversation.unreadCount > 99 ? '99+' : conversation.unreadCount.toString()}
              </Badge>
            ) : null}
          </View>
        </View>
      </View>
    </Pressable>
  );
}
