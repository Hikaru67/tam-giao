import { useState } from 'react';
import { isApiError, messageFor } from '@tamgiao/api-client';
import { COOLDOWN_DAYS } from '@tamgiao/contracts/constants';
import {
  FEEDBACK_DECISION_NAMES,
  FEEDBACK_FEELING_NAMES,
  FEEDBACK_NOTE_MAX_LENGTH,
  FEEDBACK_PROFILE_MATCH_NAMES,
  FEEDBACK_RATING_MAX,
  FEEDBACK_RATING_MIN,
  FEEDBACK_STOP_REASON_NAMES,
} from '@tamgiao/contracts/dating';
import { BottomSheet, Button, ErrorState, Text, useToast } from '@tamgiao/ui-mobile';
import { colors } from '@tamgiao/ui-tokens';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, TextInput, View } from 'react-native';
import { useCurrentMatch } from '../match/use-match.js';
import {
  FEEDBACK_COPY,
  FEEDBACK_DECISION_COPY,
  FEEDBACK_FEELING_COPY,
  FEEDBACK_PROFILE_MATCH_COPY,
  FEEDBACK_STOP_REASON_COPY,
} from './copy.js';
import {
  emptyDraft,
  isDraftComplete,
  isNoteTooLong,
  noteLength,
  toSubmitBody,
  type FeedbackDraft,
} from './feedback-form.js';
import { useMyFeedback, useSubmitFeedback } from './use-feedback.js';

export interface FeedbackScreenProps {
  readonly datePlanId: string;
}

const RATING_STARS = Array.from(
  { length: FEEDBACK_RATING_MAX - FEEDBACK_RATING_MIN + 1 },
  (_, i) => FEEDBACK_RATING_MIN + i,
);

function FeedbackHeader({ onBack }: { readonly onBack: () => void }) {
  return (
    <View className="pt-safe bg-surface border-b border-surface-container-high/60 z-30">
      <View className="h-16 px-gutter flex-row items-center gap-space-sm">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={FEEDBACK_COPY.header.back}
          onPress={onBack}
          className="w-10 h-10 rounded-full items-center justify-center bg-surface-container-low"
        >
          <Text variant="title-md" className="text-primary font-bold">
            {FEEDBACK_COPY.header.backIcon}
          </Text>
        </Pressable>
        <Text variant="title-md" numberOfLines={1} className="font-semibold text-on-surface flex-1">
          {FEEDBACK_COPY.header.title}
        </Text>
      </View>
    </View>
  );
}

export function FeedbackScreen({ datePlanId }: FeedbackScreenProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const myFeedbackQuery = useMyFeedback(datePlanId);
  const submitMutation = useSubmitFeedback(datePlanId);
  const matchQuery = useCurrentMatch();

  const [draft, setDraft] = useState<FeedbackDraft>(emptyDraft);
  const [confirmSheetOpen, setConfirmSheetOpen] = useState(false);
  const [notAllowedError, setNotAllowedError] = useState<{ title: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(main)/dates');
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([myFeedbackQuery.refetch(), matchQuery.refetch()]);
    setRefreshing(false);
  };

  const handleSubmit = async () => {
    if (!isDraftComplete(draft)) return;

    try {
      await submitMutation.mutateAsync(toSubmitBody(draft));
      setConfirmSheetOpen(false);
      setNotAllowedError(null);
    } catch (err) {
      setConfirmSheetOpen(false);
      if (isApiError(err)) {
        if (err.code === 'FEEDBACK_NOT_ALLOWED') {
          setNotAllowedError({ title: messageFor(err).title });
          return;
        }
        // Hook đã làm mới đánh giá → chuyển sang màn xem lại.
        if (err.code === 'FEEDBACK_ALREADY_SUBMITTED') return;
        showToast(messageFor(err).title, 'danger');
        return;
      }
      showToast(messageFor({ code: 'UNKNOWN' }).title, 'danger');
    }
  };

  const isInitialLoading = myFeedbackQuery.isLoading;
  const isInitialError = myFeedbackQuery.isError && myFeedbackQuery.data === undefined;

  if (isInitialLoading) {
    return (
      <View className="flex-1 bg-surface">
        <FeedbackHeader onBack={handleBack} />
        <View className="flex-1 items-center justify-center p-space-md gap-space-sm">
          <ActivityIndicator size="large" color={colors.primary} />
          <Text variant="body-md" className="text-secondary font-medium">
            {FEEDBACK_COPY.loading}
          </Text>
        </View>
      </View>
    );
  }

  if (isInitialError) {
    const errorTitle = messageFor(
      isApiError(myFeedbackQuery.error) ? myFeedbackQuery.error : { code: 'UNKNOWN' },
    ).title;
    return (
      <View className="flex-1 bg-surface">
        <FeedbackHeader onBack={handleBack} />
        <View className="flex-1 items-center justify-center p-space-md">
          <ErrorState title={errorTitle} onRetry={() => void myFeedbackQuery.refetch()} />
        </View>
      </View>
    );
  }

  const existingFeedback = myFeedbackQuery.data?.feedback ?? null;

  // Màn xem lại (chỉ đọc) khi đã gửi đánh giá
  if (existingFeedback !== null) {
    const currentMatch = matchQuery.data?.match ?? null;
    const isMatchStillOpen = currentMatch !== null && currentMatch.matchId === existingFeedback.matchId;

    return (
      <View className="flex-1 bg-surface">
        <FeedbackHeader onBack={handleBack} />

        <ScrollView
          contentContainerClassName="p-gutter pb-safe gap-space-md"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void handleRefresh()}
              tintColor={colors.primary}
            />
          }
        >
          {/* Thông báo bảo mật */}
          <View
            testID="feedback-confidentiality-notice"
            className="p-space-md rounded-xl bg-surface-container-high/60 border border-surface-container-high"
          >
            <Text variant="body-sm" className="text-secondary leading-relaxed">
              {FEEDBACK_COPY.confidentialNotice}
            </Text>
          </View>

          {/* Khối kết quả (3 nhánh) */}
          {existingFeedback.decision === 'B_STOP' ? (
            <View
              testID="feedback-result-stopped"
              className="p-space-md rounded-xl bg-surface-container-lowest border border-surface-container-high/60 gap-space-xs"
            >
              <Text variant="title-md" className="font-semibold text-on-surface">
                {FEEDBACK_COPY.result.stopped.title}
              </Text>
              <Text variant="body-md" className="text-secondary leading-relaxed">
                {FEEDBACK_COPY.result.stopped.description(COOLDOWN_DAYS)}
              </Text>
            </View>
          ) : matchQuery.data === undefined ? (
            // Chưa biết match còn mở hay không: không kết luận.
            <View testID="feedback-result-loading" className="p-space-md items-center">
              {matchQuery.isError ? (
                <ErrorState
                  title={
                    messageFor(isApiError(matchQuery.error) ? matchQuery.error : { code: 'UNKNOWN' }).title
                  }
                  onRetry={() => void matchQuery.refetch()}
                />
              ) : (
                <ActivityIndicator size="small" color={colors.primary} />
              )}
            </View>
          ) : isMatchStillOpen ? (
            <View
              testID="feedback-result-waiting"
              className="p-space-md rounded-xl bg-surface-container-lowest border border-surface-container-high/60 gap-space-xs"
            >
              <Text variant="title-md" className="font-semibold text-primary">
                {FEEDBACK_COPY.result.waiting.title}
              </Text>
              <Text variant="body-md" className="text-secondary leading-relaxed">
                {FEEDBACK_COPY.result.waiting.description}
              </Text>
            </View>
          ) : (
            <View
              testID="feedback-result-closed"
              className="p-space-md rounded-xl bg-surface-container-lowest border border-surface-container-high/60 gap-space-xs"
            >
              <Text variant="title-md" className="font-semibold text-on-surface">
                {FEEDBACK_COPY.result.closed.title}
              </Text>
              <Text variant="body-md" className="text-secondary leading-relaxed">
                {FEEDBACK_COPY.result.closed.description}
              </Text>
            </View>
          )}

          {/* Chi tiết đánh giá đã gửi (chỉ đọc) */}
          <View
            testID="feedback-review"
            className="p-space-md rounded-xl bg-surface-container-lowest border border-surface-container-high/60 gap-space-md"
          >
            <View>
              <Text variant="title-md" className="font-semibold text-on-surface">
                {FEEDBACK_COPY.review.title}
              </Text>
              <Text variant="body-sm" className="text-secondary mt-0.5">
                {FEEDBACK_COPY.review.subtitle}
              </Text>
            </View>

            <View className="gap-space-sm pt-space-xs border-t border-surface-container-high/40">
              <View className="flex-row items-center justify-between">
                <Text variant="body-sm" className="text-secondary">
                  {FEEDBACK_COPY.review.ratingLabel}
                </Text>
                <Text variant="title-md" className="font-semibold text-primary">
                  {FEEDBACK_COPY.review.ratingValue(existingFeedback.rating, FEEDBACK_RATING_MAX)}
                </Text>
              </View>

              <View className="flex-row items-center justify-between">
                <Text variant="body-sm" className="text-secondary">
                  {FEEDBACK_COPY.review.profileMatchLabel}
                </Text>
                <Text variant="body-md" className="font-medium text-on-surface">
                  {FEEDBACK_PROFILE_MATCH_COPY[existingFeedback.profileMatch]}
                </Text>
              </View>

              <View className="flex-row items-center justify-between">
                <Text variant="body-sm" className="text-secondary">
                  {FEEDBACK_COPY.review.feelingLabel}
                </Text>
                <Text variant="body-md" className="font-medium text-on-surface">
                  {FEEDBACK_FEELING_COPY[existingFeedback.feeling]}
                </Text>
              </View>

              <View className="flex-row items-center justify-between">
                <Text variant="body-sm" className="text-secondary">
                  {FEEDBACK_COPY.review.decisionLabel}
                </Text>
                <Text variant="body-md" className="font-semibold text-primary">
                  {FEEDBACK_DECISION_COPY[existingFeedback.decision]}
                </Text>
              </View>

              {existingFeedback.decision === 'B_STOP' ? (
                <>
                  {existingFeedback.stopReasons.length > 0 ? (
                    <View className="gap-1">
                      <Text variant="body-sm" className="text-secondary">
                        {FEEDBACK_COPY.review.stopReasonsLabel}
                      </Text>
                      {existingFeedback.stopReasons.map((reason) => (
                        <Text key={reason} variant="body-md" className="text-on-surface">
                          • {FEEDBACK_STOP_REASON_COPY[reason]}
                        </Text>
                      ))}
                    </View>
                  ) : null}

                  {existingFeedback.stopNote !== null ? (
                    <View className="gap-1">
                      <Text variant="body-sm" className="text-secondary">
                        {FEEDBACK_COPY.review.stopNoteLabel}
                      </Text>
                      <Text variant="body-md" className="text-on-surface leading-relaxed">
                        {existingFeedback.stopNote}
                      </Text>
                    </View>
                  ) : null}
                </>
              ) : null}
            </View>
          </View>
        </ScrollView>
      </View>
    );
  }

  // Form đánh giá
  const isSubmitDisabled = !isDraftComplete(draft) || submitMutation.isPending;
  const isNoteOverLimit = isNoteTooLong(draft.stopNote);

  return (
    <View className="flex-1 bg-surface">
      <FeedbackHeader onBack={handleBack} />

      <ScrollView contentContainerClassName="p-gutter pb-safe gap-space-md">
        {/* Thông báo bảo mật */}
        <View
          testID="feedback-confidentiality-notice"
          className="p-space-md rounded-xl bg-surface-container-high/60 border border-surface-container-high"
        >
          <Text variant="body-sm" className="text-secondary leading-relaxed">
            {FEEDBACK_COPY.confidentialNotice}
          </Text>
        </View>

        {/* Khối lỗi khi FEEDBACK_NOT_ALLOWED */}
        {notAllowedError !== null ? (
          <View
            testID="feedback-not-allowed"
            className="p-space-md rounded-xl bg-surface-container-low border border-error gap-space-xs"
          >
            <Text variant="title-md" className="font-semibold text-error">
              {notAllowedError.title}
            </Text>
            <Text variant="body-md" className="text-secondary leading-relaxed">
              {FEEDBACK_COPY.form.notAllowedExplanation}
            </Text>
          </View>
        ) : null}

        {/* 1. Đánh giá sao */}
        <View className="p-space-md rounded-xl bg-surface-container-lowest border border-surface-container-high/60 gap-space-sm">
          <View>
            <Text variant="title-md" className="font-semibold text-on-surface">
              {FEEDBACK_COPY.sections.rating.title}
            </Text>
            <Text variant="body-sm" className="text-secondary mt-0.5">
              {FEEDBACK_COPY.sections.rating.subtitle}
            </Text>
          </View>

          <View className="flex-row items-center justify-between py-space-xs">
            {RATING_STARS.map((n) => {
              const isSelected = draft.rating !== null && n <= draft.rating;
              return (
                <Pressable
                  key={n}
                  testID={`feedback-star-${n}`}
                  accessibilityRole="button"
                  accessibilityLabel={FEEDBACK_COPY.stars.label(n)}
                  onPress={() => setDraft((prev) => ({ ...prev, rating: n }))}
                  className={`w-12 h-12 rounded-xl items-center justify-center ${
                    isSelected ? 'bg-tertiary-fixed' : 'bg-surface-container-low'
                  }`}
                >
                  <Text
                    variant="headline-sm"
                    className={isSelected ? 'text-on-tertiary-fixed font-bold' : 'text-secondary'}
                  >
                    ★
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* 2. Ngoại hình & phong thái */}
        <View className="p-space-md rounded-xl bg-surface-container-lowest border border-surface-container-high/60 gap-space-sm">
          <View>
            <Text variant="title-md" className="font-semibold text-on-surface">
              {FEEDBACK_COPY.sections.profileMatch.title}
            </Text>
            <Text variant="body-sm" className="text-secondary mt-0.5">
              {FEEDBACK_COPY.sections.profileMatch.subtitle}
            </Text>
          </View>

          <View className="gap-space-xs">
            {FEEDBACK_PROFILE_MATCH_NAMES.map((val) => {
              const isSelected = draft.profileMatch === val;
              return (
                <Pressable
                  key={val}
                  testID={`feedback-profileMatch-${val}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected }}
                  onPress={() => setDraft((prev) => ({ ...prev, profileMatch: val }))}
                  className={`p-space-md rounded-xl border flex-row items-center gap-space-sm ${
                    isSelected
                      ? 'bg-primary-fixed/25 border-primary'
                      : 'bg-surface-container-lowest border-surface-container-high/60'
                  }`}
                >
                  <View
                    className={`w-5 h-5 rounded-full border items-center justify-center ${
                      isSelected ? 'border-primary bg-primary' : 'border-outline bg-transparent'
                    }`}
                  >
                    {isSelected ? <View className="w-2 h-2 rounded-full bg-on-primary" /> : null}
                  </View>
                  <Text variant="body-md" className="text-on-surface font-medium flex-1">
                    {FEEDBACK_PROFILE_MATCH_COPY[val]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* 3. Cảm xúc kết nối */}
        <View className="p-space-md rounded-xl bg-surface-container-lowest border border-surface-container-high/60 gap-space-sm">
          <View>
            <Text variant="title-md" className="font-semibold text-on-surface">
              {FEEDBACK_COPY.sections.feeling.title}
            </Text>
            <Text variant="body-sm" className="text-secondary mt-0.5">
              {FEEDBACK_COPY.sections.feeling.subtitle}
            </Text>
          </View>

          <View className="gap-space-xs">
            {FEEDBACK_FEELING_NAMES.map((val) => {
              const isSelected = draft.feeling === val;
              return (
                <Pressable
                  key={val}
                  testID={`feedback-feeling-${val}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected }}
                  onPress={() => setDraft((prev) => ({ ...prev, feeling: val }))}
                  className={`p-space-md rounded-xl border flex-row items-center gap-space-sm ${
                    isSelected
                      ? 'bg-primary-fixed/25 border-primary'
                      : 'bg-surface-container-lowest border-surface-container-high/60'
                  }`}
                >
                  <View
                    className={`w-5 h-5 rounded-full border items-center justify-center ${
                      isSelected ? 'border-primary bg-primary' : 'border-outline bg-transparent'
                    }`}
                  >
                    {isSelected ? <View className="w-2 h-2 rounded-full bg-on-primary" /> : null}
                  </View>
                  <Text variant="body-md" className="text-on-surface font-medium flex-1">
                    {FEEDBACK_FEELING_COPY[val]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* 4. Quyết định định hướng */}
        <View className="p-space-md rounded-xl bg-surface-container-lowest border border-surface-container-high/60 gap-space-sm">
          <View>
            <Text variant="title-md" className="font-semibold text-on-surface">
              {FEEDBACK_COPY.sections.decision.title}
            </Text>
            <Text variant="body-sm" className="text-secondary mt-0.5">
              {FEEDBACK_COPY.sections.decision.subtitle}
            </Text>
          </View>

          <View className="gap-space-xs">
            {FEEDBACK_DECISION_NAMES.map((val) => {
              const isSelected = draft.decision === val;
              return (
                <Pressable
                  key={val}
                  testID={`feedback-decision-${val}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected }}
                  onPress={() => setDraft((prev) => ({ ...prev, decision: val }))}
                  className={`p-space-md rounded-xl border flex-row items-center gap-space-sm ${
                    isSelected
                      ? 'bg-primary-fixed/25 border-primary'
                      : 'bg-surface-container-lowest border-surface-container-high/60'
                  }`}
                >
                  <View
                    className={`w-5 h-5 rounded-full border items-center justify-center ${
                      isSelected ? 'border-primary bg-primary' : 'border-outline bg-transparent'
                    }`}
                  >
                    {isSelected ? <View className="w-2 h-2 rounded-full bg-on-primary" /> : null}
                  </View>
                  <Text variant="body-md" className="text-on-surface font-medium flex-1">
                    {FEEDBACK_DECISION_COPY[val]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* 5. Khối lý do & ghi chú khi chọn B_STOP (đổi về A thì ẩn nhưng giữ draft) */}
        {draft.decision === 'B_STOP' ? (
          <View className="p-space-md rounded-xl bg-surface-container-lowest border border-surface-container-high/60 gap-space-md">
            <View>
              <Text variant="title-md" className="font-semibold text-on-surface">
                {FEEDBACK_COPY.sections.stopReasons.title}
              </Text>
              <Text variant="body-sm" className="text-secondary mt-0.5">
                {FEEDBACK_COPY.sections.stopReasons.subtitle}
              </Text>
            </View>

            <View className="gap-space-xs">
              {FEEDBACK_STOP_REASON_NAMES.map((val) => {
                const isChecked = draft.stopReasons.includes(val);
                return (
                  <Pressable
                    key={val}
                    testID={`feedback-reason-${val}`}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: isChecked }}
                    onPress={() =>
                      setDraft((prev) => {
                        const exists = prev.stopReasons.includes(val);
                        return {
                          ...prev,
                          stopReasons: exists
                            ? prev.stopReasons.filter((r) => r !== val)
                            : [...prev.stopReasons, val],
                        };
                      })
                    }
                    className={`p-space-md rounded-xl border flex-row items-center gap-space-sm ${
                      isChecked
                        ? 'bg-primary-fixed/25 border-primary'
                        : 'bg-surface-container-lowest border-surface-container-high/60'
                    }`}
                  >
                    <View
                      className={`w-5 h-5 rounded border items-center justify-center ${
                        isChecked ? 'border-primary bg-primary' : 'border-outline bg-transparent'
                      }`}
                    >
                      {isChecked ? (
                        <Text variant="label-sm" className="text-on-primary font-bold">
                          ✓
                        </Text>
                      ) : null}
                    </View>
                    <Text variant="body-md" className="text-on-surface font-medium flex-1">
                      {FEEDBACK_STOP_REASON_COPY[val]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Ghi chú */}
            <View className="gap-space-xs">
              <Text variant="label-md" className="font-semibold text-on-surface">
                {FEEDBACK_COPY.sections.stopNote.title}
              </Text>
              <TextInput
                testID="feedback-note"
                multiline
                numberOfLines={3}
                value={draft.stopNote}
                onChangeText={(text) => setDraft((prev) => ({ ...prev, stopNote: text }))}
                placeholder={FEEDBACK_COPY.sections.stopNote.placeholder}
                placeholderTextColor={colors.secondary}
                textAlignVertical="top"
                className="w-full bg-surface-container-low rounded-xl p-space-md text-body-md text-on-surface min-h-[80px]"
              />
              <View className="flex-row items-center justify-between">
                {isNoteOverLimit ? (
                  <Text testID="feedback-note-error" variant="body-sm" className="text-error font-medium">
                    {FEEDBACK_COPY.form.noteTooLong(FEEDBACK_NOTE_MAX_LENGTH)}
                  </Text>
                ) : (
                  <View />
                )}
                <Text variant="label-sm" className="text-secondary text-right">
                  {FEEDBACK_COPY.form.noteCounter(noteLength(draft.stopNote), FEEDBACK_NOTE_MAX_LENGTH)}
                </Text>
              </View>
            </View>

            {/* Thông báo COOLDOWN_DAYS */}
            <View className="p-space-md rounded-xl bg-surface-container-high/50 border border-surface-container-high">
              <Text variant="body-sm" className="text-secondary leading-relaxed">
                {FEEDBACK_COPY.form.cooldownNotice(COOLDOWN_DAYS)}
              </Text>
            </View>
          </View>
        ) : null}

        {/* Nút gửi */}
        <View className="pt-space-xs">
          <Button
            testID="feedback-submit"
            variant="primary"
            size="lg"
            fullWidth
            disabled={isSubmitDisabled}
            onPress={() => setConfirmSheetOpen(true)}
          >
            {FEEDBACK_COPY.form.submitButton}
          </Button>
        </View>
      </ScrollView>

      {/* BottomSheet xác nhận gửi */}
      <BottomSheet
        open={confirmSheetOpen}
        onClose={() => setConfirmSheetOpen(false)}
        title={FEEDBACK_COPY.confirmSheet.title}
      >
        <View testID="feedback-confirm-dialog" className="gap-space-md">
          <Text variant="body-md" className="text-secondary leading-relaxed">
            {draft.decision === 'B_STOP'
              ? FEEDBACK_COPY.confirmSheet.bodyStop(COOLDOWN_DAYS)
              : FEEDBACK_COPY.confirmSheet.bodyCommit}
          </Text>

          <View className="gap-space-sm mt-space-xs">
            <Button
              testID="feedback-submit-ok"
              variant={draft.decision === 'B_STOP' ? 'danger' : 'primary'}
              size="lg"
              fullWidth
              loading={submitMutation.isPending}
              disabled={submitMutation.isPending}
              onPress={() => void handleSubmit()}
            >
              {FEEDBACK_COPY.confirmSheet.confirm}
            </Button>
            <Button
              variant="ghost"
              size="md"
              fullWidth
              disabled={submitMutation.isPending}
              onPress={() => setConfirmSheetOpen(false)}
            >
              {FEEDBACK_COPY.confirmSheet.cancel}
            </Button>
          </View>
        </View>
      </BottomSheet>
    </View>
  );
}
