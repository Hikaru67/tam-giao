import { Redirect, useLocalSearchParams } from 'expo-router';
import { ChatScreen } from '../../../src/features/chat/index.js';

export default function ConversationRoute() {
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();

  if (!conversationId) {
    return <Redirect href="/(main)/home" />;
  }

  return <ChatScreen key={conversationId} conversationId={conversationId} />;
}
