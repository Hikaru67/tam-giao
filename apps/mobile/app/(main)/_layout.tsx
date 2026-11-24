import { useState } from 'react';
import { Stack } from 'expo-router';
import { ChatClientProvider } from '../../src/features/chat/chat-client-context.js';
import { createMobileChatClient } from '../../src/features/chat/mobile-chat-client.js';

export default function MainLayout() {
  const [client] = useState(createMobileChatClient);

  return (
    <ChatClientProvider client={client}>
      <Stack screenOptions={{ headerShown: false }} />
    </ChatClientProvider>
  );
}
