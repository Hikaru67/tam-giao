import { useState } from 'react';
import { isApiError, messageFor } from '@tamgiao/api-client';
import type { KycProgressResponse } from '@tamgiao/contracts/verification';
import { Badge, Button, Card, ErrorState, Text, type BadgeTone } from '@tamgiao/ui-mobile';
import { colors } from '@tamgiao/ui-tokens';
import { useRouter } from 'expo-router';
import { usePreventScreenCapture } from 'expo-screen-capture';
import { ActivityIndicator, Image, Pressable, ScrollView, View } from 'react-native';
import { useMe } from '../session/use-me.js';
import { KYC_COPY } from './copy.js';
import { KycCamera } from './kyc-camera.js';
import {
  isKycSlot,
  isKycSubmittable,
  KYC_SLOTS,
  slotForField,
  type KycDocumentKeys,
  type KycSlot,
} from './types.js';
import { useKycDocuments, useKycProgress, useSubmitKyc, useSubmittedKycKeys } from './use-kyc.js';

type FormViewState =
  { kind: 'overview' } | { kind: 'camera'; slot: KycSlot } | { kind: 'preview'; slot: KycSlot; uri: string };

interface KycCaptureFormProps {
  userId: string;
  progress: KycProgressResponse;
  previousKeys: KycDocumentKeys;
}

function KycCaptureForm({ userId, progress, previousKeys }: KycCaptureFormProps) {
  const router = useRouter();

  const isNeedsMoreInfo = progress.status === 'NEEDS_MORE_INFO';
  const initialRequiredSlots = isNeedsMoreInfo
    ? (progress.moreInfo?.items.filter(isKycSlot) ?? [])
    : KYC_SLOTS;

  const {
    slots,
    requiredSlots,
    trackTempPhoto,
    discardTempPhoto,
    uploadPhoto,
    resetSlot,
    canSubmit,
    documentKeys,
  } = useKycDocuments({
    requiredSlots: initialRequiredSlots,
    previousKeys: isNeedsMoreInfo ? previousKeys : {},
  });

  const submit = useSubmitKyc(userId);
  const [view, setView] = useState<FormViewState>({ kind: 'overview' });
  const [submitError, setSubmitError] = useState<{
    code?: string;
    title: string;
    action?: string;
  } | null>(null);

  if (view.kind === 'camera') {
    return (
      <KycCamera
        slot={view.slot}
        onCaptured={(uri) => {
          trackTempPhoto(uri);
          setView({ kind: 'preview', slot: view.slot, uri });
        }}
        onCancel={() => setView({ kind: 'overview' })}
      />
    );
  }

  if (view.kind === 'preview') {
    return (
      <View className="flex-1 bg-surface p-space-md justify-between">
        <View className="pt-safe items-center gap-space-sm">
          <Text variant="title-md" className="font-bold text-on-surface">
            {KYC_COPY.preview.title}
          </Text>
          <Text variant="body-sm" className="text-secondary text-center">
            {KYC_COPY.preview.hint}
          </Text>
          <Image
            testID="kyc-preview-image"
            source={{ uri: view.uri }}
            style={{ width: '100%', height: 360, borderRadius: 12, resizeMode: 'contain' }}
          />
        </View>

        <View className="pb-safe gap-space-sm">
          <Button
            testID="kyc-preview-use"
            variant="primary"
            size="lg"
            fullWidth
            onPress={() => {
              const { slot, uri } = view;
              setView({ kind: 'overview' });
              void uploadPhoto(slot, uri);
            }}
          >
            {KYC_COPY.actions.usePhoto}
          </Button>
          <Button
            testID="kyc-preview-retake"
            variant="secondary"
            size="md"
            fullWidth
            onPress={() => {
              const { slot, uri } = view;
              discardTempPhoto(uri);
              setView({ kind: 'camera', slot });
            }}
          >
            {KYC_COPY.actions.retake}
          </Button>
          <Button
            testID="kyc-preview-cancel"
            variant="ghost"
            size="md"
            fullWidth
            onPress={() => {
              const { uri } = view;
              discardTempPhoto(uri);
              setView({ kind: 'overview' });
            }}
          >
            {KYC_COPY.actions.cancel}
          </Button>
        </View>
      </View>
    );
  }

  const handleSubmit = async () => {
    if (!documentKeys) return;
    setSubmitError(null);
    try {
      await submit.mutateAsync(documentKeys);
      router.replace('/(verification)/status');
    } catch (err) {
      if (isApiError(err)) {
        if (err.code === 'KYC_DOCS_MISSING') {
          const missing: unknown = err.meta?.['missing'];
          for (const field of Array.isArray(missing) ? missing : []) {
            if (typeof field === 'string') {
              const slot = slotForField(field);
              if (slot) resetSlot(slot);
            }
          }
        } else if (err.code === 'UPLOAD_INVALID' || err.code === 'UPLOAD_NOT_OWNED') {
          const field: unknown = err.meta?.['field'];
          if (typeof field === 'string') {
            const slot = slotForField(field);
            if (slot) resetSlot(slot);
          }
        }
        const msg = messageFor(err);
        setSubmitError({ code: err.code, title: msg.title, action: msg.action });
      } else {
        setSubmitError({ title: KYC_COPY.genericError });
      }
    }
  };

  return (
    <View className="flex-1 bg-surface">
      {/* Header */}
      <View className="pt-safe bg-surface border-b border-surface-container-high/60 z-30">
        <View className="h-16 px-margin flex-row items-center gap-space-sm">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={KYC_COPY.header.back}
            onPress={() => {
              if (router.canGoBack?.()) {
                router.back();
              }
            }}
            className="w-10 h-10 rounded-full items-center justify-center bg-surface-container-low"
          >
            <Text variant="title-md" className="text-primary font-bold">
              ←
            </Text>
          </Pressable>
          <Text variant="title-md" numberOfLines={1} className="font-semibold text-on-surface flex-1">
            {KYC_COPY.header.title}
          </Text>
        </View>
      </View>

      <ScrollView className="flex-1" contentContainerClassName="p-margin pb-32 gap-space-md">
        {/* Khối yêu cầu bổ sung khi NEEDS_MORE_INFO */}
        {isNeedsMoreInfo && progress.moreInfo ? (
          <Card testID="kyc-more-info" className="gap-space-xs bg-error-container/20 border-error/30">
            <Text variant="title-md" className="font-bold text-error">
              {KYC_COPY.moreInfo.title}
            </Text>
            <Text variant="label-md" className="font-semibold text-on-surface">
              {KYC_COPY.moreInfo.itemsLabel}
            </Text>
            {progress.moreInfo.items.map((item) => (
              <Text key={item} variant="body-sm" className="text-secondary pl-space-sm">
                • {KYC_COPY.moreInfo.items[item]}
              </Text>
            ))}
            {progress.moreInfo.note !== null ? (
              <View className="mt-space-xs gap-1">
                <Text variant="label-md" className="font-semibold text-on-surface">
                  {KYC_COPY.moreInfo.noteLabel}
                </Text>
                <Text variant="body-sm" className="text-secondary">
                  {progress.moreInfo.note}
                </Text>
              </View>
            ) : null}
          </Card>
        ) : null}

        {/* Hướng dẫn chụp ảnh */}
        <Card className="gap-space-xs bg-surface-container-low">
          <Text variant="title-md" className="font-bold text-on-surface">
            {KYC_COPY.guide.title}
          </Text>
          <Text variant="body-sm" className="text-secondary leading-relaxed">
            {KYC_COPY.guide.intro}
          </Text>
          {KYC_COPY.guide.tips.map((tip, idx) => (
            <Text key={idx} variant="body-sm" className="text-secondary leading-relaxed pl-space-sm">
              • {tip}
            </Text>
          ))}
          <Text variant="body-sm" className="text-secondary italic mt-space-xs leading-relaxed">
            {KYC_COPY.guide.privacy}
          </Text>
        </Card>

        {/* 4 Slot tài liệu */}
        {KYC_SLOTS.map((slot) => {
          const slotState = slots[slot];
          const isRequired = requiredSlots.includes(slot);

          let badgeTone: BadgeTone = 'neutral';
          let badgeLabel = '';
          if (slotState.status === 'empty') {
            if (isRequired && isNeedsMoreInfo) {
              badgeTone = 'warning';
              badgeLabel = KYC_COPY.slotStatus.required;
            } else {
              badgeTone = 'neutral';
              badgeLabel = KYC_COPY.slotStatus.empty;
            }
          } else if (slotState.status === 'uploading') {
            badgeTone = 'neutral';
            badgeLabel = KYC_COPY.slotStatus.uploading;
          } else if (slotState.status === 'uploaded') {
            if (slotState.source === 'new') {
              badgeTone = 'success';
              badgeLabel = KYC_COPY.slotStatus.uploaded;
            } else {
              badgeTone = 'neutral';
              badgeLabel = KYC_COPY.slotStatus.previous;
            }
          } else if (slotState.status === 'failed') {
            badgeTone = 'danger';
            badgeLabel = KYC_COPY.slotStatus.failed;
          }

          const isCaptureDisabled = slotState.status === 'uploading' || submit.isPending;
          const captureLabel =
            slotState.status === 'uploaded' ? KYC_COPY.actions.retake : KYC_COPY.actions.capture;

          return (
            <Card key={slot} testID={`kyc-slot-${slot}`} className="gap-space-sm bg-surface-container-lowest">
              <View className="flex-row items-center justify-between">
                <Text variant="title-md" className="font-bold text-on-surface">
                  {KYC_COPY.slots[slot].label}
                </Text>
                <Badge testID={`kyc-slot-status-${slot}`} tone={badgeTone}>
                  {badgeLabel}
                </Badge>
              </View>
              <Text variant="body-sm" className="text-secondary">
                {KYC_COPY.slots[slot].hint}
              </Text>
              {slotState.status === 'failed' ? (
                <Text variant="body-sm" className="text-error">
                  {slotState.message}
                </Text>
              ) : null}
              <Button
                testID={`kyc-capture-${slot}`}
                variant="secondary"
                size="md"
                disabled={isCaptureDisabled}
                onPress={() => setView({ kind: 'camera', slot })}
              >
                {captureLabel}
              </Button>
            </Card>
          );
        })}

        {/* Khối lỗi submit */}
        {submitError ? (
          <View
            accessibilityRole="alert"
            className="p-space-sm rounded-lg bg-error-container/40 border border-error/30 gap-1"
          >
            <Text variant="label-md" className="font-semibold text-error text-center">
              {submitError.title}
            </Text>
            {submitError.action ? (
              <Text variant="body-sm" className="text-secondary text-center">
                {submitError.action}
              </Text>
            ) : null}
            {submitError.code === 'PAYMENT_REQUIRED' ? (
              <Button
                testID="kyc-go-payment"
                variant="primary"
                size="md"
                className="mt-space-xs"
                onPress={() => router.replace('/(verification)/payment')}
              >
                {KYC_COPY.actions.goToPayment}
              </Button>
            ) : null}
            {submitError.code === 'KYC_ALREADY_SUBMITTED' ? (
              <Button
                testID="kyc-go-status"
                variant="primary"
                size="md"
                className="mt-space-xs"
                onPress={() => router.replace('/(verification)/status')}
              >
                {KYC_COPY.actions.viewStatus}
              </Button>
            ) : null}
          </View>
        ) : null}

        {/* Gợi ý khi chưa đủ điều kiện nộp */}
        {!canSubmit ? (
          <Text variant="body-sm" className="text-secondary text-center">
            {KYC_COPY.submitHint}
          </Text>
        ) : null}

        {/* Nút nộp */}
        <Button
          testID="kyc-submit"
          variant="primary"
          size="lg"
          fullWidth
          disabled={!canSubmit || submit.isPending}
          loading={submit.isPending}
          onPress={() => void handleSubmit()}
        >
          {isNeedsMoreInfo ? KYC_COPY.actions.resubmit : KYC_COPY.actions.submit}
        </Button>
      </ScrollView>
    </View>
  );
}

export function KycScreen() {
  usePreventScreenCapture();

  const router = useRouter();
  const me = useMe();
  const kycProgress = useKycProgress();
  const submittedKeysState = useSubmittedKycKeys(me.data?.userId);

  if (me.isError || kycProgress.isError) {
    const err = me.error ?? kycProgress.error;
    const errorTitle = isApiError(err) ? messageFor(err).title : KYC_COPY.genericError;
    return (
      <View className="flex-1 items-center justify-center bg-surface p-space-md">
        <ErrorState
          title={errorTitle}
          onRetry={() => {
            if (me.isError) void me.refetch();
            if (kycProgress.isError) void kycProgress.refetch();
          }}
        />
      </View>
    );
  }

  const progress = kycProgress.data;
  const userId = me.data?.userId;
  if (progress === undefined || userId === undefined || submittedKeysState.status === 'loading') {
    return (
      <View className="flex-1 items-center justify-center bg-surface p-space-md gap-space-sm">
        <ActivityIndicator size="large" color={colors.primary} />
        <Text variant="title-md" className="font-semibold text-primary">
          {KYC_COPY.loading}
        </Text>
      </View>
    );
  }

  if (!isKycSubmittable(progress.status)) {
    return (
      <View className="flex-1 bg-surface justify-center p-space-md">
        <Card
          testID="kyc-already-submitted"
          className="gap-space-md p-space-lg items-center bg-surface-container-low"
        >
          <Text variant="headline-sm" className="font-bold text-on-surface text-center">
            {KYC_COPY.submitted.title}
          </Text>
          <Text variant="body-md" className="text-secondary text-center">
            {KYC_COPY.submitted.body}
          </Text>
          <Button
            testID="kyc-view-status"
            variant="primary"
            size="lg"
            fullWidth
            onPress={() => router.replace('/(verification)/status')}
          >
            {KYC_COPY.actions.viewStatus}
          </Button>
        </Card>
      </View>
    );
  }

  return <KycCaptureForm userId={userId} progress={progress} previousKeys={submittedKeysState.keys} />;
}
