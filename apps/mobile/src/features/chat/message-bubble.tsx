import { messageFor } from '@tamgiao/api-client';
import type { PendingMessage } from '@tamgiao/api-client/ws';
import type { ConversationMessageDto } from '@tamgiao/contracts/messaging';
import { Text } from '@tamgiao/ui-mobile';
import { Pressable, View } from 'react-native';
import { CHAT_COPY } from './copy.js';

export function formatMessageTime(dateInput: string | number): string {
  const date = new Date(dateInput);
  if (Number.isNaN(date.getTime())) return '';
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

export interface MessageBubbleProps {
  item: ConversationMessageDto | PendingMessage;
  peerUserId: string | null;
  peerName: string;
  isRead?: boolean;
  onRetry: (clientMessageId: string) => void;
  onDiscard: (clientMessageId: string) => void;
}

export function MessageBubble({
  item,
  peerUserId,
  peerName,
  isRead = false,
  onRetry,
  onDiscard,
}: MessageBubbleProps) {
  const isPending = 'status' in item;

  if (isPending) {
    const timeStr = formatMessageTime(item.createdAt);
    const isSending = item.status === 'sending';
    const isFailed = item.status === 'failed';
    const errorCode = item.error?.code ?? 'UNKNOWN';
    const errorTitle = messageFor({
      code: errorCode,
      ...(item.error?.meta !== undefined ? { meta: item.error.meta } : {}),
    }).title;
    const isClosedError = errorCode === 'CONVERSATION_CLOSED';

    return (
      <View className="flex-col items-end self-end max-w-[85%] px-margin my-1 gap-1">
        <View className="flex-row items-center gap-1.5 px-1">
          {timeStr ? (
            <Text variant="label-sm" className="text-secondary/60">
              {timeStr}
            </Text>
          ) : null}
          <Text variant="label-sm" className="text-primary font-medium">
            {CHAT_COPY.bubble.you}
          </Text>
        </View>

        <View className="bg-primary/80 rounded-xl rounded-tr-sm p-space-sm shadow-sm">
          <Text variant="body-md" className="text-on-primary">
            {item.body}
          </Text>
        </View>

        {isSending ? (
          <View className="flex-row items-center gap-1 px-1">
            <Text variant="label-sm" className="text-secondary">
              {CHAT_COPY.bubble.sending}
            </Text>
          </View>
        ) : null}

        {isFailed ? (
          <View className="flex-col items-end gap-1 px-1">
            <Text variant="label-sm" className="text-error font-medium">
              {errorTitle}
            </Text>
            <View className="flex-row items-center gap-2">
              {!isClosedError ? (
                <Pressable
                  testID={`chat-retry-${item.clientMessageId}`}
                  accessibilityRole="button"
                  accessibilityLabel={CHAT_COPY.bubble.retry}
                  onPress={() => onRetry(item.clientMessageId)}
                  className="px-2 py-0.5 rounded bg-surface-container-high active:bg-surface-container-highest"
                >
                  <Text variant="label-sm" className="text-primary font-semibold">
                    {CHAT_COPY.bubble.retry}
                  </Text>
                </Pressable>
              ) : null}
              <Pressable
                testID={`chat-discard-${item.clientMessageId}`}
                accessibilityRole="button"
                accessibilityLabel={CHAT_COPY.bubble.discard}
                onPress={() => onDiscard(item.clientMessageId)}
                className="px-2 py-0.5 rounded bg-surface-container-high active:bg-surface-container-highest"
              >
                <Text variant="label-sm" className="text-secondary font-semibold">
                  {CHAT_COPY.bubble.discard}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>
    );
  }

  // Khối tin nhắn hệ thống
  if (item.kind === 'SYSTEM') {
    if (item.systemCode === 'FRAUD_WARNING') {
      return (
        <View
          testID="chat-fraud-warning"
          className="bg-error-container p-space-sm rounded-xl mx-margin my-space-xs items-center border border-error/30"
        >
          <Text variant="body-md" className="text-on-error-container text-center font-semibold">
            {item.body}
          </Text>
        </View>
      );
    }

    return (
      <View className="items-center my-space-xs px-margin">
        <View className="bg-surface-container-high/60 px-3 py-1 rounded-full">
          <Text variant="label-sm" className="text-secondary text-center">
            {item.body}
          </Text>
        </View>
      </View>
    );
  }

  const isMe = item.senderId !== null && item.senderId !== peerUserId;
  const timeStr = formatMessageTime(item.sentAt);

  if (isMe) {
    return (
      <View className="flex-col items-end self-end max-w-[85%] px-margin my-1 gap-1">
        <View className="flex-row items-center gap-1.5 px-1">
          {timeStr ? (
            <Text variant="label-sm" className="text-secondary/60">
              {timeStr}
            </Text>
          ) : null}
          <Text variant="label-sm" className="text-primary font-medium">
            {CHAT_COPY.bubble.you}
          </Text>
        </View>

        <View className="bg-primary rounded-xl rounded-tr-sm p-space-sm shadow-sm">
          {item.kind === 'IMAGE' ? (
            <Text variant="body-md" className="text-on-primary italic">
              {CHAT_COPY.bubble.unsupported}
            </Text>
          ) : (
            <Text variant="body-md" className="text-on-primary">
              {item.body}
            </Text>
          )}
        </View>

        {item.masked ? (
          <Text variant="label-sm" className="text-secondary/80 italic px-1">
            {CHAT_COPY.bubble.maskedNotice}
          </Text>
        ) : null}

        {isRead ? (
          <View className="flex-row items-center gap-1 px-1">
            <Text variant="label-sm" className="text-primary font-medium">
              {CHAT_COPY.bubble.read}
            </Text>
          </View>
        ) : null}
      </View>
    );
  }

  // Tin nhắn của đối phương
  return (
    <View className="flex-col items-start self-start max-w-[85%] px-margin my-1 gap-1">
      <View className="flex-row items-center gap-1.5 px-1">
        <Text variant="label-sm" className="text-secondary font-medium">
          {peerName}
        </Text>
        {timeStr ? (
          <Text variant="label-sm" className="text-secondary/60">
            {timeStr}
          </Text>
        ) : null}
      </View>

      <View className="bg-surface-container-lowest rounded-xl rounded-tl-sm p-space-sm shadow-sm">
        {item.kind === 'IMAGE' ? (
          <Text variant="body-md" className="text-on-surface italic">
            {CHAT_COPY.bubble.unsupported}
          </Text>
        ) : (
          <Text variant="body-md" className="text-on-surface">
            {item.body}
          </Text>
        )}
      </View>

      {item.masked ? (
        <Text variant="label-sm" className="text-secondary/80 italic px-1">
          {CHAT_COPY.bubble.maskedNotice}
        </Text>
      ) : null}
    </View>
  );
}
