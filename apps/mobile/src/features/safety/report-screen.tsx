import { useEffect, useRef, useState } from 'react';
import { isApiError, messageFor } from '@tamgiao/api-client';
import { useApiClient } from '@tamgiao/api-client/react';
import {
  REPORT_CATEGORY_NAMES,
  REPORT_DESCRIPTION_MAX_LENGTH,
  REPORT_MAX_EVIDENCE,
  type FileReportResponse,
  type ReportCategoryName,
} from '@tamgiao/contracts/safety';
import { SAFETY_RESPONSE_SLA_MINUTES } from '@tamgiao/contracts/constants';
import { Badge, BottomSheet, Button, Text, useToast } from '@tamgiao/ui-mobile';
import { colors } from '@tamgiao/ui-tokens';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Image, Pressable, ScrollView, Switch, TextInput, View } from 'react-native';
import { useCurrentMatch } from '../match/use-match.js';
import { REPORT_CATEGORIES_COPY, REPORT_COPY } from './copy.js';
import {
  deletePickedCopy,
  pickImageFromLibrary,
  processAndUploadEvidence,
  type PickedImageResult,
} from './evidence-service.js';
import { ReportSentScreen } from './report-sent-screen.js';
import { useFileReport } from './use-report.js';

export interface ReportScreenProps {
  reportedUserId: string;
}

interface EvidencePhotoItem {
  id: string;
  localUri: string;
  key?: string | undefined;
  status: 'uploading' | 'uploaded' | 'failed';
  originalAsset: PickedImageResult;
}

export function ReportScreen({ reportedUserId }: ReportScreenProps) {
  const router = useRouter();
  const client = useApiClient();
  const { showToast } = useToast();
  const fileReportMutation = useFileReport();

  const [selectedCategory, setSelectedCategory] = useState<ReportCategoryName | null>(null);
  const [description, setDescription] = useState('');
  const [evidencePhotos, setEvidencePhotos] = useState<EvidencePhotoItem[]>([]);
  const nextIdRef = useRef(0);
  const [isUrgent, setIsUrgent] = useState(false);
  const [isConfirmOpen, setConfirmOpen] = useState(false);
  const [reportResult, setReportResult] = useState<FileReportResponse | null>(null);

  const currentMatchQuery = useCurrentMatch();
  const currentMatch = currentMatchQuery.data?.match ?? null;
  const counterpart = currentMatch?.counterpart ?? null;
  const isMatchPeer = counterpart !== null && counterpart.userId === reportedUserId;
  const peerDisplayName = isMatchPeer
    ? REPORT_COPY.reportedTarget.nameAge(counterpart.displayName, counterpart.age)
    : REPORT_COPY.reportedTarget.reportedFallback;

  // F5: bản sao ảnh bằng chứng trong cache không giữ lại sau khi rời màn.
  const pickedUrisRef = useRef(new Set<string>());
  useEffect(() => {
    const pickedUris = pickedUrisRef.current;
    return () => {
      for (const uri of pickedUris) deletePickedCopy(uri);
    };
  }, []);

  const uploadEvidence = async (id: string, asset: PickedImageResult) => {
    const update = (patch: Pick<EvidencePhotoItem, 'status' | 'key'>) =>
      setEvidencePhotos((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    update({ status: 'uploading' });
    try {
      const { key } = await processAndUploadEvidence(asset, client);
      update({ status: 'uploaded', key });
    } catch {
      update({ status: 'failed' });
    }
  };

  const handleAddEvidence = async () => {
    if (evidencePhotos.length >= REPORT_MAX_EVIDENCE) return;
    let picked: PickedImageResult | null;
    try {
      picked = await pickImageFromLibrary();
    } catch {
      showToast(REPORT_COPY.errors.photoAccess, 'danger');
      return;
    }
    if (picked === null) return;
    const asset = picked;
    pickedUrisRef.current.add(asset.uri);
    nextIdRef.current += 1;
    const id = `evidence-${nextIdRef.current}`;
    setEvidencePhotos((prev) => [
      ...prev,
      { id, localUri: asset.uri, status: 'uploading', originalAsset: asset },
    ]);
    await uploadEvidence(id, asset);
  };

  const handleRemoveEvidence = (id: string) => {
    setEvidencePhotos((prev) => prev.filter((p) => p.id !== id));
  };

  const hasFailedPhoto = evidencePhotos.some((p) => p.status === 'failed');
  const isAnyUploading = evidencePhotos.some((p) => p.status === 'uploading');
  const isSubmitDisabled = !selectedCategory || isAnyUploading || fileReportMutation.isPending;

  const handleConfirmSubmit = async () => {
    if (!selectedCategory) return;
    setConfirmOpen(false);

    const uploadedKeys = evidencePhotos.flatMap((p) =>
      p.status === 'uploaded' && p.key !== undefined ? [p.key] : [],
    );

    const trimmedDesc = description.trim();

    try {
      const res = await fileReportMutation.mutateAsync({
        reportedUserId,
        category: selectedCategory,
        ...(trimmedDesc.length > 0 ? { description: trimmedDesc } : {}),
        ...(uploadedKeys.length > 0 ? { evidenceKeys: uploadedKeys } : {}),
        ...(isUrgent ? { urgentIntervention: true } : {}),
      });
      setReportResult(res);
    } catch (err) {
      const errorTitle = isApiError(err) ? messageFor(err).title : REPORT_COPY.errors.generic;
      showToast(errorTitle, 'danger');
    }
  };

  if (reportResult !== null) {
    return <ReportSentScreen report={reportResult} />;
  }

  return (
    <View className="flex-1 bg-surface">
      {/* Header */}
      <View className="pt-safe bg-surface border-b border-surface-container-high/60 z-30">
        <View className="h-16 px-gutter flex-row items-center gap-space-sm">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={REPORT_COPY.header.back}
            onPress={() => {
              if (router.canGoBack()) {
                router.back();
              } else {
                router.replace('/(main)/safety');
              }
            }}
            className="w-10 h-10 rounded-full items-center justify-center bg-surface-container-low"
          >
            <Text variant="title-md" className="text-primary font-bold">
              {REPORT_COPY.header.backIcon}
            </Text>
          </Pressable>
          <Text variant="title-md" numberOfLines={1} className="font-semibold text-on-surface flex-1">
            {REPORT_COPY.header.title}
          </Text>
        </View>
      </View>

      <ScrollView contentContainerClassName="p-gutter pb-safe gap-space-md">
        {/* Thẻ đối tượng bị báo cáo */}
        <View className="bg-surface-container-lowest rounded-xl p-space-md border border-surface-container-high/60">
          <Text variant="label-sm" className="text-secondary mb-1">
            {REPORT_COPY.reportedTarget.title}
          </Text>
          <Text variant="title-md" className="font-semibold text-on-surface">
            {peerDisplayName}
          </Text>
        </View>

        {/* Chọn loại vi phạm */}
        <View className="gap-space-xs">
          <View className="flex-row items-center justify-between">
            <Text variant="title-md" className="font-semibold text-on-surface">
              {REPORT_COPY.categorySection.title}
            </Text>
            <Text variant="label-sm" className="text-primary font-medium">
              {REPORT_COPY.categorySection.requiredNotice}
            </Text>
          </View>
          <Text variant="body-sm" className="text-secondary mb-1">
            {REPORT_COPY.categorySection.subtitle}
          </Text>

          <View className="gap-space-xs">
            {REPORT_CATEGORY_NAMES.map((cat) => {
              const isSelected = selectedCategory === cat;
              const itemCopy = REPORT_CATEGORIES_COPY[cat];
              return (
                <Pressable
                  key={cat}
                  testID={`report-category-${cat}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected }}
                  onPress={() => setSelectedCategory(cat)}
                  className={`p-space-md rounded-xl border flex-row items-start gap-space-sm ${
                    isSelected
                      ? 'bg-primary-fixed/25 border-primary'
                      : 'bg-surface-container-lowest border-surface-container-high/60'
                  }`}
                >
                  <View
                    className={`w-5 h-5 rounded-full border items-center justify-center mt-0.5 ${
                      isSelected ? 'border-primary bg-primary' : 'border-outline bg-transparent'
                    }`}
                  >
                    {isSelected ? <View className="w-2 h-2 rounded-full bg-on-primary" /> : null}
                  </View>
                  <View className="flex-1">
                    <Text variant="title-md" className="font-semibold text-on-surface">
                      {itemCopy.label}
                    </Text>
                    <Text variant="body-sm" className="text-secondary mt-1">
                      {itemCopy.description}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Mô tả chi tiết */}
        <View className="bg-surface-container-lowest rounded-xl p-space-md border border-surface-container-high/60 gap-space-xs">
          <Text variant="title-md" className="font-semibold text-on-surface">
            {REPORT_COPY.descriptionSection.title}
          </Text>
          <TextInput
            testID="report-description"
            multiline
            numberOfLines={4}
            maxLength={REPORT_DESCRIPTION_MAX_LENGTH}
            value={description}
            onChangeText={setDescription}
            placeholder={REPORT_COPY.descriptionSection.placeholder}
            placeholderTextColor={colors.secondary}
            textAlignVertical="top"
            className="w-full bg-surface-container-low rounded-xl p-space-md text-body-md text-on-surface min-h-[100px]"
          />
          <Text variant="label-sm" className="text-secondary text-right">
            {REPORT_COPY.descriptionSection.counter(description.length, REPORT_DESCRIPTION_MAX_LENGTH)}
          </Text>
        </View>

        {/* Bằng chứng */}
        <View className="bg-surface-container-lowest rounded-xl p-space-md border border-surface-container-high/60 gap-space-sm">
          <View className="flex-row items-center justify-between">
            <Text variant="label-md" className="font-semibold text-on-surface">
              {REPORT_COPY.evidenceSection.title(REPORT_MAX_EVIDENCE)}
            </Text>
            <Text variant="label-sm" className="text-secondary">
              {REPORT_COPY.evidenceSection.recommendation}
            </Text>
          </View>

          <View className="flex-row flex-wrap gap-space-xs">
            {evidencePhotos.map((photo, i) => (
              <View
                key={photo.id}
                className="w-20 h-20 rounded-xl overflow-hidden bg-surface-container-high relative border border-surface-container-high"
              >
                <Image source={{ uri: photo.localUri }} className="w-full h-full" resizeMode="cover" />
                {photo.status === 'uploading' ? (
                  <View className="absolute inset-0 bg-on-surface/50 items-center justify-center">
                    <ActivityIndicator size="small" color={colors.primary} />
                  </View>
                ) : null}
                {photo.status === 'failed' ? (
                  <Pressable
                    testID={`report-retry-evidence-${i}`}
                    accessibilityRole="button"
                    accessibilityLabel={REPORT_COPY.evidenceSection.retry}
                    onPress={() => void uploadEvidence(photo.id, photo.originalAsset)}
                    className="absolute inset-0 bg-error/80 items-center justify-center p-1"
                  >
                    <Text variant="label-sm" className="text-on-error font-bold text-center">
                      {REPORT_COPY.evidenceSection.retry}
                    </Text>
                  </Pressable>
                ) : null}
                <Pressable
                  testID={`report-remove-evidence-${i}`}
                  accessibilityRole="button"
                  accessibilityLabel={REPORT_COPY.evidenceSection.removePhoto(i)}
                  onPress={() => handleRemoveEvidence(photo.id)}
                  className="absolute top-1 right-1 w-6 h-6 rounded-full bg-on-background/70 items-center justify-center"
                >
                  <Text variant="label-sm" className="text-on-primary font-bold">
                    ✕
                  </Text>
                </Pressable>
              </View>
            ))}

            {evidencePhotos.length < REPORT_MAX_EVIDENCE ? (
              <Pressable
                testID="report-add-evidence"
                accessibilityRole="button"
                accessibilityLabel={REPORT_COPY.evidenceSection.addPhoto}
                onPress={() => void handleAddEvidence()}
                className="w-20 h-20 rounded-xl border border-dashed border-outline items-center justify-center bg-surface-container-low"
              >
                <Text variant="headline-sm" className="text-secondary font-bold">
                  +
                </Text>
                <Text variant="label-sm" className="text-secondary">
                  {REPORT_COPY.evidenceSection.addPhoto}
                </Text>
              </Pressable>
            ) : null}
          </View>

          {hasFailedPhoto ? (
            <Text variant="body-sm" className="text-error">
              {REPORT_COPY.evidenceSection.failedNotice}
            </Text>
          ) : null}
          <Text variant="body-sm" className="text-secondary">
            {REPORT_COPY.evidenceSection.subtitle}
          </Text>
        </View>

        {/* Cờ khẩn cấp */}
        <View className="bg-surface-container-lowest rounded-xl p-space-md border border-surface-container-high/60 flex-row items-center justify-between gap-space-sm">
          <View className="flex-1">
            <View className="flex-row items-center gap-space-xs mb-1">
              <Text variant="label-md" className="font-semibold text-on-surface">
                {REPORT_COPY.urgentSection.title}
              </Text>
              <Badge tone="warning">{REPORT_COPY.urgentSection.slaBadge(SAFETY_RESPONSE_SLA_MINUTES)}</Badge>
            </View>
            <Text variant="body-sm" className="text-secondary">
              {REPORT_COPY.urgentSection.description(SAFETY_RESPONSE_SLA_MINUTES)}
            </Text>
          </View>
          <Switch
            testID="report-urgent"
            value={isUrgent}
            onValueChange={setIsUrgent}
            trackColor={{ false: colors['surface-container-high'], true: colors.primary }}
          />
        </View>

        {/* Nút gửi & huỷ */}
        <View className="gap-space-xs pt-space-xs">
          <Button
            testID="report-submit"
            variant="primary"
            size="lg"
            fullWidth
            disabled={isSubmitDisabled}
            onPress={() => setConfirmOpen(true)}
          >
            {REPORT_COPY.submitButton}
          </Button>

          <Button
            variant="ghost"
            size="md"
            fullWidth
            onPress={() => {
              if (router.canGoBack()) {
                router.back();
              } else {
                router.replace('/(main)/safety');
              }
            }}
          >
            {REPORT_COPY.cancelButton}
          </Button>
        </View>
      </ScrollView>

      {/* BottomSheet xác nhận */}
      <BottomSheet
        open={isConfirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={REPORT_COPY.confirmModal.title}
      >
        <View testID="report-confirm" className="gap-space-md">
          <Text variant="body-md" className="text-secondary">
            {REPORT_COPY.confirmModal.description}
          </Text>

          <View className="gap-space-xs mt-space-sm">
            <Button
              testID="report-confirm-submit"
              variant="danger"
              size="lg"
              fullWidth
              loading={fileReportMutation.isPending}
              onPress={() => void handleConfirmSubmit()}
            >
              {REPORT_COPY.confirmModal.confirmButton}
            </Button>
            <Button
              variant="ghost"
              size="md"
              fullWidth
              disabled={fileReportMutation.isPending}
              onPress={() => setConfirmOpen(false)}
            >
              {REPORT_COPY.confirmModal.cancelButton}
            </Button>
          </View>
        </View>
      </BottomSheet>
    </View>
  );
}
