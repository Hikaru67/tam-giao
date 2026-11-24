import { messageFor } from '@tamgiao/api-client';
import { MESSAGE_MAX_LENGTH } from '@tamgiao/contracts/constants';
import { Button, Text } from '@tamgiao/ui-mobile';
import { colors } from '@tamgiao/ui-tokens';
import { TextInput, View } from 'react-native';
import { CHAT_COPY } from './copy.js';

export interface ChatComposerProps {
  text: string;
  setText: (text: string) => void;
  onSend: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function ChatComposer({
  text,
  setText,
  onSend,
  disabled = false,
  placeholder = CHAT_COPY.composer.placeholder,
}: ChatComposerProps) {
  const codePoints = [...text].length;
  const isTooLong = codePoints > MESSAGE_MAX_LENGTH;
  const isEmpty = text.trim().length === 0;

  const errorMessage = isTooLong
    ? messageFor({
        code: 'MESSAGE_TOO_LONG',
        meta: { maxLength: MESSAGE_MAX_LENGTH },
      }).title
    : null;

  const handleSend = () => {
    if (!isEmpty && !isTooLong && !disabled) {
      onSend(text.trim());
      setText('');
    }
  };

  return (
    <View className="px-margin pb-safe pt-space-xs bg-surface border-t border-surface-container-high/40">
      {errorMessage ? (
        <View className="pb-space-xs">
          <Text variant="label-sm" className="text-error font-medium">
            {errorMessage}
          </Text>
        </View>
      ) : null}

      <View className="bg-surface-container-lowest rounded-xl p-2 shadow-sm flex-row items-center gap-2">
        <TextInput
          testID="chat-input"
          multiline
          editable={!disabled}
          value={text}
          onChangeText={setText}
          placeholder={placeholder}
          placeholderTextColor={colors.secondary}
          className="flex-1 text-body-md text-on-surface px-2 py-1 max-h-24 min-h-[40px]"
        />

        <Button
          testID="chat-send"
          variant="primary"
          size="md"
          disabled={disabled || isEmpty || isTooLong}
          onPress={handleSend}
          className="rounded-full px-space-md"
        >
          {CHAT_COPY.composer.send}
        </Button>
      </View>
    </View>
  );
}
