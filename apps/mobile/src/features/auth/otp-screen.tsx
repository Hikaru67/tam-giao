import { useEffect, useState } from 'react';
import { OTP_TTL_SECONDS } from '@tamgiao/contracts/constants';
import { formatVnPhoneDisplay } from '@tamgiao/ui-core';
import { Button, OtpInput, Text } from '@tamgiao/ui-mobile';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { AUTH_COPY } from './copy.js';
import { useResendTimer } from './resend-timer.js';
import { otpErrorView, useRequestOtp, useVerifyOtp } from './use-otp-flow.js';

/**
 * Định dạng SĐT hiển thị đã che 4 số giữa: ví dụ "0912 *** 678".
 */
export function maskPhoneForDisplay(phone: string): string {
  const formatted = formatVnPhoneDisplay(phone);
  const parts = formatted.split(' ');
  if (parts.length === 3) {
    return `${parts[0]} *** ${parts[2]}`;
  }
  return formatted;
}

export function OtpScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ phone?: string; resendAfter?: string }>();
  const phone = params.phone ?? '';
  const initialResendAfter = Number(params.resendAfter) || OTP_TTL_SECONDS;

  const [code, setCode] = useState('');
  const { secondsLeft, canResend, restart } = useResendTimer(initialResendAfter);

  const requestOtp = useRequestOtp();
  const verifyOtp = useVerifyOtp();

  const activeError = verifyOtp.error ?? requestOtp.error;
  const errorView = activeError ? otpErrorView(activeError) : null;

  useEffect(() => {
    if (errorView?.banned) {
      router.replace('/(auth)/banned');
    }
  }, [errorView?.banned, router]);

  const handleVerify = async (otpCode: string) => {
    if (errorView?.lockInput || verifyOtp.isPending || otpCode.length !== 6) {
      return;
    }

    try {
      await verifyOtp.mutateAsync({ phone, code: otpCode });
      router.replace('/');
    } catch (err) {
      const view = otpErrorView(err);
      if (view.banned) {
        router.replace('/(auth)/banned');
      }
    }
  };

  const handleResend = async () => {
    if (!canResend || requestOtp.isPending || !phone) {
      return;
    }

    try {
      const response = await requestOtp.mutateAsync({ phone });
      restart(response.resendAfterSeconds ?? OTP_TTL_SECONDS);
    } catch {
      // Lỗi được bắt bởi errorView
    }
  };

  const isInputLocked = Boolean(errorView?.lockInput);

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
        <View className="py-space-md gap-space-lg max-w-md mx-auto w-full">
          {/* Header & Back navigation */}
          <View className="flex-row items-center justify-between">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Quay lại"
              onPress={() => router.back()}
              className="px-space-xs py-space-xs rounded-full"
            >
              <Text variant="title-md" className="text-primary font-semibold">
                ← Quay lại
              </Text>
            </Pressable>
            <Text variant="title-md" className="font-semibold text-on-surface">
              {AUTH_COPY.otpScreen.headerTitle}
            </Text>
            <View className="w-10" />
          </View>

          {/* Instruction and Phone Display */}
          <View className="items-center text-center gap-space-xs mt-space-sm">
            <View className="w-16 h-16 rounded-full bg-secondary-container items-center justify-center">
              <Text variant="headline-md" className="text-primary">
                🔒
              </Text>
            </View>
            <Text variant="headline-sm" className="font-bold text-on-surface text-center">
              {AUTH_COPY.otpScreen.title}
            </Text>
            <Text variant="body-md" className="text-secondary text-center">
              {AUTH_COPY.otpScreen.instruction}
            </Text>
            <View className="flex-row items-center gap-space-xs px-space-md py-1.5 rounded-full bg-surface-container-low mt-space-xs">
              <Text variant="title-md" className="font-semibold text-on-surface tracking-wider">
                {maskPhoneForDisplay(phone)}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={AUTH_COPY.otpScreen.editPhoneA11y}
                onPress={() => router.back()}
                className="p-space-xs"
              >
                <Text variant="label-sm" className="text-primary font-semibold">
                  Sửa
                </Text>
              </Pressable>
            </View>
          </View>

          {/* OTP Input Section */}
          <View className="items-center gap-space-md my-space-xs">
            <OtpInput
              autoFocus
              disabled={isInputLocked || verifyOtp.isPending}
              accessibilityLabel={AUTH_COPY.otpScreen.inputA11yLabel}
              onComplete={(completedCode) => {
                setCode(completedCode);
                void handleVerify(completedCode);
              }}
            />

            {errorView ? (
              <View className="items-center gap-space-xs" accessibilityRole="alert">
                <Text variant="body-sm" className="text-error font-medium text-center">
                  {errorView.message}
                </Text>
                {errorView.action ? (
                  <Text variant="body-sm" className="text-secondary text-center">
                    {errorView.action}
                  </Text>
                ) : null}
              </View>
            ) : null}

            <Text variant="label-sm" className="text-secondary text-center">
              {AUTH_COPY.otpScreen.statusHint}
            </Text>
          </View>

          {/* Resend Timer & Button */}
          <View className="items-center gap-space-xs">
            {!canResend ? (
              <View className="flex-row items-center gap-space-xs">
                <Text variant="body-md" className="text-secondary">
                  {AUTH_COPY.otpScreen.resendPrefix}
                </Text>
                <Text variant="title-md" className="font-semibold text-primary">
                  {secondsLeft}s
                </Text>
              </View>
            ) : (
              <Button
                variant="ghost"
                size="md"
                disabled={requestOtp.isPending}
                loading={requestOtp.isPending}
                onPress={handleResend}
              >
                {AUTH_COPY.otpScreen.resendButton}
              </Button>
            )}
          </View>

          {/* Safety Warning Card */}
          <View className="bg-surface-container-low rounded-xl p-space-md gap-space-xs">
            <Text variant="title-md" className="font-semibold text-on-surface">
              {AUTH_COPY.otpScreen.safetyTitle}
            </Text>
            <Text variant="body-sm" className="text-on-surface-variant leading-relaxed">
              {AUTH_COPY.otpScreen.safetyContent}
            </Text>
          </View>

          {/* Submit Action Button */}
          <Button
            variant="primary"
            size="lg"
            fullWidth
            disabled={code.length !== 6 || isInputLocked || verifyOtp.isPending}
            loading={verifyOtp.isPending}
            onPress={() => handleVerify(code)}
          >
            {AUTH_COPY.otpScreen.submitButton}
          </Button>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
