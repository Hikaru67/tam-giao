import { useCallback, useEffect, useRef, useState } from 'react';
import { isApiError, messageFor } from '@tamgiao/api-client';
import type { CurrentMatchDto } from '@tamgiao/contracts/matching';
import { Badge, BottomSheet, Button, Card, Countdown, ErrorState, Text, useToast } from '@tamgiao/ui-mobile';
import { colors } from '@tamgiao/ui-tokens';
import { ActivityIndicator, Image, Pressable, ScrollView, View } from 'react-native';
import { PROFILE_COPY } from '../profile/copy.js';
import { MATCH_COPY } from './copy.js';
import { useAcceptMatch, useDeclineMatch, useMatchProfile, useRefreshMatch } from './use-match.js';

export function MatchOfferCard({ match }: { match: CurrentMatchDto }) {
  const profileQuery = useMatchProfile(match.matchId);
  const refreshMatch = useRefreshMatch();
  const acceptMutation = useAcceptMatch();
  const declineMutation = useDeclineMatch();
  const { showToast } = useToast();

  const [expiredAt, setExpiredAt] = useState<string | null>(null);
  const [acceptSheetOpen, setAcceptSheetOpen] = useState(false);
  const [declineSheetOpen, setDeclineSheetOpen] = useState(false);
  const [selectedReasonId, setSelectedReasonId] = useState<string | null>(null);

  const retriedPhotoUrlsRef = useRef<Set<string>>(new Set());

  const isPast = match.expiresAt !== null && new Date(match.expiresAt).getTime() <= Date.now();
  const isExpired = (expiredAt !== null && expiredAt === match.expiresAt) || isPast;

  useEffect(() => {
    if (isExpired) {
      setAcceptSheetOpen(false);
      setDeclineSheetOpen(false);
    }
  }, [isExpired]);

  const handleExpire = useCallback(() => {
    if (match.expiresAt !== null) {
      setExpiredAt(match.expiresAt);
      void refreshMatch();
    }
  }, [match.expiresAt, refreshMatch]);

  const handlePhotoError = useCallback(
    (url: string) => {
      if (!retriedPhotoUrlsRef.current.has(url)) {
        retriedPhotoUrlsRef.current.add(url);
        void profileQuery.refetch();
      }
    },
    [profileQuery],
  );

  const counterpart = profileQuery.data?.counterpart ?? null;
  const hasProfile = counterpart !== null;
  const isActionPending = acceptMutation.isPending || declineMutation.isPending;

  const handleConfirmAccept = async () => {
    if (isExpired || !hasProfile || isActionPending) return;
    try {
      await acceptMutation.mutateAsync();
      setAcceptSheetOpen(false);
      showToast(MATCH_COPY.toast.accepted, 'success');
    } catch (err) {
      setAcceptSheetOpen(false);
      const msg = messageFor(isApiError(err) ? err : { code: 'UNKNOWN' });
      showToast(msg.title, 'danger');
    }
  };

  const handleConfirmDecline = async () => {
    if (isExpired || isActionPending) return;
    try {
      const selectedReason = MATCH_COPY.declineReasons.find((r) => r.id === selectedReasonId);
      await declineMutation.mutateAsync({ reason: selectedReason ? selectedReason.label : null });
      setDeclineSheetOpen(false);
      showToast(MATCH_COPY.toast.declined, 'success');
    } catch (err) {
      setDeclineSheetOpen(false);
      const msg = messageFor(isApiError(err) ? err : { code: 'UNKNOWN' });
      showToast(msg.title, 'danger');
    }
  };

  return (
    <View className="gap-space-md">
      <Card className="gap-space-md p-space-md bg-surface-container-lowest">
        {/* Header badges */}
        <View className="flex-row items-center justify-between gap-space-xs">
          <Badge tone={match.phase === 'COUNTERPART_ACCEPTED' ? 'success' : 'primary'}>
            {MATCH_COPY.offer.badge}
          </Badge>
        </View>

        {match.phase === 'COUNTERPART_ACCEPTED' ? (
          <View className="p-space-sm rounded-lg bg-secondary-container gap-1">
            <Text variant="body-sm" className="font-semibold text-on-secondary-container">
              {MATCH_COPY.offer.counterpartAccepted}
            </Text>
          </View>
        ) : null}

        {/* Countdown */}
        {match.expiresAt !== null ? (
          <View className="flex-row items-center justify-between p-space-sm rounded-lg bg-surface-container-low">
            <Text variant="body-sm" className="text-secondary font-medium">
              {MATCH_COPY.offer.countdownLabel}
            </Text>
            <Countdown key={match.expiresAt} expiresAt={match.expiresAt} onExpire={handleExpire} />
          </View>
        ) : null}

        {/* Khối hết hạn (AC1) */}
        {isExpired ? (
          <View
            testID="match-expired"
            className="p-space-md rounded-xl bg-error-container/40 border border-error/30 gap-space-xs"
          >
            <Text variant="title-md" className="font-bold text-error">
              {MATCH_COPY.expired.title}
            </Text>
            <Text variant="body-sm" className="text-secondary leading-relaxed">
              {MATCH_COPY.expired.description}
            </Text>
            <View className="mt-space-xs items-start">
              <Button
                variant="secondary"
                size="md"
                onPress={() => {
                  void refreshMatch();
                }}
              >
                {MATCH_COPY.expired.refresh}
              </Button>
            </View>
          </View>
        ) : null}

        {/* Lời nhắc độc quyền */}
        <Text variant="body-sm" className="text-secondary leading-relaxed">
          {MATCH_COPY.offer.exclusiveHint}
        </Text>

        {/* Phần tải/lỗi của hồ sơ */}
        {profileQuery.isLoading ? (
          <View className="items-center justify-center py-space-xl gap-space-sm">
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : null}

        {profileQuery.isError && !hasProfile ? (
          <ErrorState
            title={
              isApiError(profileQuery.error) ? messageFor(profileQuery.error).title : MATCH_COPY.genericError
            }
            onRetry={() => {
              void profileQuery.refetch();
            }}
          />
        ) : null}

        {/* Chi tiết hồ sơ đối phương (AC2) */}
        {counterpart !== null ? (
          <View className="gap-space-md">
            {/* Ảnh hồ sơ */}
            {counterpart.photos.length === 0 ? (
              <View className="w-full aspect-[4/3] rounded-xl bg-surface-container-high items-center justify-center p-space-md">
                <Text variant="body-md" className="text-secondary text-center">
                  {MATCH_COPY.offer.noPhoto}
                </Text>
              </View>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} className="w-full">
                <View className="flex-row gap-space-sm">
                  {counterpart.photos.map((photo, idx) => (
                    <View
                      key={photo.url}
                      className="w-72 aspect-[3/4] rounded-xl overflow-hidden bg-surface-container-high"
                    >
                      <Image
                        source={{ uri: photo.url }}
                        accessibilityLabel={MATCH_COPY.offer.photoLabel(
                          counterpart.displayName,
                          idx + 1,
                          counterpart.photos.length,
                        )}
                        onError={() => handlePhotoError(photo.url)}
                        className="w-full h-full object-cover"
                        resizeMode="cover"
                      />
                    </View>
                  ))}
                </View>
              </ScrollView>
            )}

            {/* Thông tin cơ bản */}
            <View className="gap-space-xs">
              <Text variant="headline-sm" className="font-bold text-on-surface">
                {MATCH_COPY.offer.nameAge(counterpart.displayName, counterpart.age)}
              </Text>
              <Text variant="body-md" className="text-secondary font-medium">
                {counterpart.currentCity}
              </Text>
              <Text variant="body-md" className="text-on-surface">
                {counterpart.occupation}
              </Text>
              <Text variant="body-sm" className="text-secondary">
                {PROFILE_COPY.educationOptions[counterpart.education]}
              </Text>
            </View>

            {/* Bio (ẩn nếu null hoặc rỗng) */}
            {counterpart.bio !== null && counterpart.bio.trim().length > 0 ? (
              <View className="p-space-md rounded-xl bg-surface-container-low gap-space-xs">
                <Text variant="title-md" className="font-bold text-on-surface">
                  {MATCH_COPY.offer.bioTitle}
                </Text>
                <Text variant="body-md" className="text-on-surface italic leading-relaxed">
                  "{counterpart.bio}"
                </Text>
              </View>
            ) : null}

            {/* Sở thích (ẩn nếu rỗng) */}
            {counterpart.interests.length > 0 ? (
              <View className="gap-space-xs">
                <Text variant="title-md" className="font-bold text-on-surface">
                  {MATCH_COPY.offer.interestsTitle}
                </Text>
                <View className="flex-row flex-wrap gap-space-xs">
                  {counterpart.interests.map((interest) => (
                    <Badge key={interest} tone="neutral">
                      {interest}
                    </Badge>
                  ))}
                </View>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Nút hành động */}
        <View className="flex-row gap-space-sm mt-space-xs">
          <View className="flex-1">
            <Button
              testID="match-decline"
              variant="secondary"
              size="lg"
              fullWidth
              disabled={isExpired || isActionPending}
              onPress={() => {
                if (isExpired || isActionPending) return;
                setDeclineSheetOpen(true);
              }}
            >
              {MATCH_COPY.offer.decline}
            </Button>
          </View>
          <View className="flex-1">
            <Button
              testID="match-accept"
              variant="primary"
              size="lg"
              fullWidth
              disabled={isExpired || !hasProfile || isActionPending}
              onPress={() => {
                if (isExpired || !hasProfile || isActionPending) return;
                setAcceptSheetOpen(true);
              }}
            >
              {MATCH_COPY.offer.accept}
            </Button>
          </View>
        </View>

        <Text variant="body-sm" className="text-secondary text-center leading-relaxed">
          {MATCH_COPY.offer.acceptHint}
        </Text>
      </Card>

      {/* Sheet xác nhận đồng ý */}
      <BottomSheet
        open={acceptSheetOpen}
        onClose={() => setAcceptSheetOpen(false)}
        title={MATCH_COPY.acceptSheet.title}
      >
        <View className="gap-space-md">
          <Text variant="body-md" className="text-secondary leading-relaxed">
            {MATCH_COPY.acceptSheet.body}
          </Text>
          <View className="gap-space-sm">
            <Button
              testID="match-accept-confirm"
              variant="primary"
              size="lg"
              fullWidth
              loading={acceptMutation.isPending}
              disabled={acceptMutation.isPending}
              onPress={() => void handleConfirmAccept()}
            >
              {MATCH_COPY.acceptSheet.confirm}
            </Button>
            <Button
              variant="ghost"
              size="md"
              fullWidth
              disabled={acceptMutation.isPending}
              onPress={() => setAcceptSheetOpen(false)}
            >
              {MATCH_COPY.acceptSheet.cancel}
            </Button>
          </View>
        </View>
      </BottomSheet>

      {/* Sheet chọn lý do bỏ qua */}
      <BottomSheet
        open={declineSheetOpen}
        onClose={() => setDeclineSheetOpen(false)}
        title={MATCH_COPY.declineSheet.title}
      >
        <View className="gap-space-md">
          <Text variant="body-md" className="text-secondary leading-relaxed">
            {MATCH_COPY.declineSheet.body}
          </Text>

          <View className="gap-space-xs">
            {MATCH_COPY.declineReasons.map((reason) => {
              const isSelected = selectedReasonId === reason.id;
              return (
                <Pressable
                  key={reason.id}
                  testID={`match-decline-reason-${reason.id}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected }}
                  onPress={() => {
                    setSelectedReasonId((current) => (current === reason.id ? null : reason.id));
                  }}
                  className={`p-space-sm rounded-xl border flex-row items-center gap-space-sm ${
                    isSelected
                      ? 'bg-primary-fixed/30 border-primary'
                      : 'bg-surface-container-low border-surface-container-high'
                  }`}
                >
                  <View
                    className={`w-5 h-5 rounded-full border items-center justify-center ${
                      isSelected ? 'border-primary bg-primary' : 'border-secondary bg-surface'
                    }`}
                  >
                    {isSelected ? <View className="w-2 h-2 rounded-full bg-on-primary" /> : null}
                  </View>
                  <Text
                    variant="body-md"
                    className={`flex-1 ${isSelected ? 'text-on-surface font-semibold' : 'text-on-surface'}`}
                  >
                    {reason.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View className="gap-space-sm">
            <Button
              testID="match-decline-confirm"
              variant="danger"
              size="lg"
              fullWidth
              loading={declineMutation.isPending}
              disabled={declineMutation.isPending}
              onPress={() => void handleConfirmDecline()}
            >
              {MATCH_COPY.declineSheet.confirm}
            </Button>
            <Button
              variant="ghost"
              size="md"
              fullWidth
              disabled={declineMutation.isPending}
              onPress={() => setDeclineSheetOpen(false)}
            >
              {MATCH_COPY.declineSheet.cancel}
            </Button>
          </View>
        </View>
      </BottomSheet>
    </View>
  );
}
