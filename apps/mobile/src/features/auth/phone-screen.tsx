import { useState } from 'react';
import { normalizeVnPhone } from '@tamgiao/ui-core';
import { Badge, Button, PhoneInput, Text } from '@tamgiao/ui-mobile';
import { useRouter } from 'expo-router';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { AUTH_COPY } from './copy.js';
import { otpErrorView, useRequestOtp } from './use-otp-flow.js';

export function PhoneScreen() {
  const router = useRouter();
  const [rawPhone, setRawPhone] = useState('');
  const [e164Phone, setE164Phone] = useState<string | null>(null);

  const requestOtp = useRequestOtp();
  const errorView = requestOtp.isError ? otpErrorView(requestOtp.error) : null;

  const isValidPhone = Boolean(e164Phone && normalizeVnPhone(e164Phone));

  const handleRequestOtp = async () => {
    if (!e164Phone || !isValidPhone || requestOtp.isPending) {
      return;
    }

    try {
      const response = await requestOtp.mutateAsync({ phone: e164Phone });
      router.push({
        pathname: '/(auth)/otp',
        params: {
          phone: e164Phone,
          resendAfter: String(response.resendAfterSeconds),
        },
      });
    } catch {
      // Lỗi được lưu trong requestOtp.error và hiển thị qua errorView
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-surface"
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        className="flex-1 px-margin pt-safe pb-safe"
      >
        <View className="py-space-md gap-space-md">
          {/* Brand Header */}
          <View className="items-center text-center gap-space-xs mt-space-sm">
            <View className="w-16 h-16 rounded-full bg-primary-container/10 items-center justify-center">
              <Text variant="headline-md" className="text-primary font-bold">
                TG
              </Text>
            </View>
            <View className="flex-row items-center gap-space-xs mt-space-xs">
              <Text variant="title-md" className="font-bold text-on-surface tracking-tight">
                {AUTH_COPY.brand.name}
              </Text>
              <Badge tone="primary">{AUTH_COPY.brand.tagline}</Badge>
            </View>
            <Text variant="label-md" className="text-primary font-medium italic text-center">
              {AUTH_COPY.brand.quote}
            </Text>
          </View>

          {/* Welcome Pitch Card */}
          <View className="p-space-md rounded-xl bg-surface-container-low gap-space-xs">
            <Text variant="headline-sm" className="font-bold text-on-surface tracking-tight">
              {AUTH_COPY.phoneScreen.pitchTitle}
            </Text>
            <Text variant="body-sm" className="text-on-surface-variant leading-relaxed">
              {AUTH_COPY.phoneScreen.pitchDescription}
            </Text>
            <View className="flex-row gap-space-xs mt-space-xs">
              <View className="flex-1 bg-surface-container-lowest p-space-xs rounded-lg items-center">
                <Text variant="label-sm" className="text-primary font-semibold truncate">
                  ✓ {AUTH_COPY.phoneScreen.ekycBadge}
                </Text>
              </View>
              <View className="flex-1 bg-surface-container-lowest p-space-xs rounded-lg items-center">
                <Text variant="label-sm" className="text-tertiary font-semibold truncate">
                  🔒 {AUTH_COPY.phoneScreen.encryptionBadge}
                </Text>
              </View>
            </View>
          </View>

          {/* Phone Form Card */}
          <View className="bg-surface-container-lowest p-space-md rounded-xl gap-space-md border border-outline-variant/30">
            <PhoneInput
              label={AUTH_COPY.phoneScreen.phoneLabel}
              placeholder={AUTH_COPY.phoneScreen.phonePlaceholder}
              value={rawPhone}
              onChangeRaw={setRawPhone}
              onChangeE164={setE164Phone}
              disabled={requestOtp.isPending}
              accessibilityLabel={AUTH_COPY.phoneScreen.phoneLabel}
              accessibilityHint={AUTH_COPY.phoneScreen.phoneHint}
            />

            {errorView ? (
              <View className="gap-space-xs" accessibilityRole="alert">
                <Text variant="body-sm" className="text-error font-medium">
                  {errorView.message}
                </Text>
                {errorView.action ? (
                  <Text variant="body-sm" className="text-secondary">
                    {errorView.action}
                  </Text>
                ) : null}
              </View>
            ) : null}

            <Button
              variant="primary"
              size="lg"
              fullWidth
              disabled={!isValidPhone || requestOtp.isPending}
              loading={requestOtp.isPending}
              onPress={handleRequestOtp}
            >
              {AUTH_COPY.phoneScreen.submitButton}
            </Button>
          </View>

          {/* Trust and Security Section */}
          <View className="p-space-md rounded-xl bg-surface-container-low gap-space-sm">
            <Text variant="title-md" className="font-semibold text-on-surface">
              {AUTH_COPY.trust.title}
            </Text>
            <View className="gap-space-xs">
              <Text variant="body-sm" className="text-on-surface">
                <Text variant="body-sm" className="font-bold text-on-surface">
                  {AUTH_COPY.trust.privacyTitle}{' '}
                </Text>
                {AUTH_COPY.trust.privacyContent}
              </Text>
              <Text variant="body-sm" className="text-on-surface">
                <Text variant="body-sm" className="font-bold text-on-surface">
                  {AUTH_COPY.trust.verifiedTitle}{' '}
                </Text>
                {AUTH_COPY.trust.verifiedContent}
              </Text>
            </View>
          </View>

          {/* Legal Terms Footer */}
          <View className="items-center px-space-xs py-space-xs">
            <Text variant="body-sm" className="text-secondary text-center leading-relaxed">
              {AUTH_COPY.legal.prefix}
              <Text variant="body-sm" className="text-primary font-medium underline">
                {AUTH_COPY.legal.terms}
              </Text>
              {AUTH_COPY.legal.and}
              <Text variant="body-sm" className="text-primary font-medium underline">
                {AUTH_COPY.legal.privacy}
              </Text>
              {AUTH_COPY.legal.suffix}
            </Text>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
