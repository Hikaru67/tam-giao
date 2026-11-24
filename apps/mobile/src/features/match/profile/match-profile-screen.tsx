import { useCallback, useRef } from 'react';
import { isApiError, messageFor } from '@tamgiao/api-client';
import { Badge, Button, Card, EmptyState, ErrorState, Text } from '@tamgiao/ui-mobile';
import { colors } from '@tamgiao/ui-tokens';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { PROFILE_COPY } from '../../profile/copy.js';
import { useCurrentMatch, useMatchProfile } from '../use-match.js';
import { MATCH_PROFILE_COPY } from './copy.js';
import { PhotoGallery } from './photo-gallery.js';

interface HeaderProps {
  onBack: () => void;
}

function MatchProfileHeader({ onBack }: HeaderProps) {
  return (
    <View className="pt-safe bg-surface border-b border-surface-container-high/60 z-30">
      <View className="h-16 px-margin flex-row items-center gap-space-sm">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={MATCH_PROFILE_COPY.header.back}
          onPress={onBack}
          className="w-10 h-10 rounded-full items-center justify-center bg-surface-container-low"
        >
          <Text variant="title-md" className="text-primary font-bold">
            {MATCH_PROFILE_COPY.header.backIcon}
          </Text>
        </Pressable>
        <Text variant="title-md" numberOfLines={1} className="font-semibold text-on-surface flex-1">
          {MATCH_PROFILE_COPY.header.title}
        </Text>
      </View>
    </View>
  );
}

interface ContentProps {
  matchId: string;
  onBack: () => void;
}

function MatchProfileContent({ matchId, onBack }: ContentProps) {
  const profileQuery = useMatchProfile(matchId);
  const retriedPhotoUrlsRef = useRef<Set<string>>(new Set());

  const handlePhotoError = useCallback(
    (url: string) => {
      if (!retriedPhotoUrlsRef.current.has(url)) {
        retriedPhotoUrlsRef.current.add(url);
        void profileQuery.refetch();
      }
    },
    [profileQuery],
  );

  if (profileQuery.isLoading) {
    return (
      <View className="flex-1 bg-surface">
        <MatchProfileHeader onBack={onBack} />
        <View className="flex-1 items-center justify-center p-space-md gap-space-sm">
          <ActivityIndicator size="large" color={colors.primary} />
          <Text variant="title-md" className="font-semibold text-primary">
            {MATCH_PROFILE_COPY.loading}
          </Text>
        </View>
      </View>
    );
  }

  if (profileQuery.isError && profileQuery.data === undefined) {
    const errorTitle = isApiError(profileQuery.error)
      ? messageFor(profileQuery.error).title
      : MATCH_PROFILE_COPY.genericError;
    return (
      <View className="flex-1 bg-surface">
        <MatchProfileHeader onBack={onBack} />
        <View className="flex-1 items-center justify-center p-space-md">
          <ErrorState
            title={errorTitle}
            onRetry={() => {
              void profileQuery.refetch();
            }}
          />
        </View>
      </View>
    );
  }

  const counterpart = profileQuery.data?.counterpart ?? null;
  if (counterpart === null) {
    return null;
  }

  return (
    <View className="flex-1 bg-surface">
      <MatchProfileHeader onBack={onBack} />
      <ScrollView
        testID="profile-scroll"
        contentContainerStyle={{ flexGrow: 1, paddingBottom: 60 }}
        className="flex-1 px-margin"
      >
        <View className="py-space-md gap-space-md max-w-md mx-auto w-full">
          <PhotoGallery
            photos={counterpart.photos}
            displayName={counterpart.displayName}
            onPhotoError={handlePhotoError}
          />

          <Card className="gap-space-xs">
            <Text variant="headline-sm" className="font-bold text-on-surface">
              {MATCH_PROFILE_COPY.nameAge(counterpart.displayName, counterpart.age)}
            </Text>
            <View className="flex-row items-center gap-space-sm">
              <Badge tone="primary">{MATCH_PROFILE_COPY.gender[counterpart.gender]}</Badge>
              <Text variant="body-md" className="text-secondary font-medium">
                {counterpart.currentCity}
              </Text>
            </View>
          </Card>

          <Card className="gap-space-xs">
            <Text variant="title-md" className="font-bold text-on-surface">
              {MATCH_PROFILE_COPY.sections.careerEducation}
            </Text>
            <Text variant="body-md" className="text-on-surface">
              {counterpart.occupation}
            </Text>
            <Text variant="body-sm" className="text-secondary">
              {PROFILE_COPY.educationOptions[counterpart.education]}
            </Text>
          </Card>

          <Card className="gap-space-xs">
            <Text variant="title-md" className="font-bold text-on-surface">
              {MATCH_PROFILE_COPY.sections.intro}
            </Text>
            {counterpart.bio !== null && counterpart.bio.trim().length > 0 ? (
              <Text variant="body-md" className="text-on-surface italic leading-relaxed">
                {MATCH_PROFILE_COPY.quoteBio(counterpart.bio)}
              </Text>
            ) : (
              <Text variant="body-md" className="text-secondary italic">
                {MATCH_PROFILE_COPY.emptyBio}
              </Text>
            )}
          </Card>

          <Card className="gap-space-xs">
            <Text variant="title-md" className="font-bold text-on-surface">
              {MATCH_PROFILE_COPY.sections.interests}
            </Text>
            {counterpart.interests.length > 0 ? (
              <View className="flex-row flex-wrap gap-space-xs">
                {counterpart.interests.map((interest) => (
                  <Badge key={interest} tone="neutral">
                    {interest}
                  </Badge>
                ))}
              </View>
            ) : (
              <Text variant="body-md" className="text-secondary">
                {MATCH_PROFILE_COPY.emptyInterests}
              </Text>
            )}
          </Card>

          <Card testID="profile-private-locked" className="gap-space-xs bg-surface-container-low">
            <View className="flex-row items-center justify-between">
              <Text variant="title-md" className="font-bold text-on-surface">
                {MATCH_PROFILE_COPY.private.title}
              </Text>
              <Badge tone="warning">{MATCH_PROFILE_COPY.private.badge}</Badge>
            </View>
            <Text variant="body-sm" className="text-secondary leading-relaxed">
              {MATCH_PROFILE_COPY.private.body}
            </Text>
          </Card>
        </View>
      </ScrollView>
    </View>
  );
}

export function MatchProfileScreen() {
  const router = useRouter();
  const matchQuery = useCurrentMatch();

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(main)/home');
    }
  }, [router]);

  if (matchQuery.isLoading) {
    return (
      <View className="flex-1 bg-surface">
        <MatchProfileHeader onBack={handleBack} />
        <View className="flex-1 items-center justify-center p-space-md gap-space-sm">
          <ActivityIndicator size="large" color={colors.primary} />
          <Text variant="title-md" className="font-semibold text-primary">
            {MATCH_PROFILE_COPY.loading}
          </Text>
        </View>
      </View>
    );
  }

  if (matchQuery.isError && matchQuery.data === undefined) {
    const errorTitle = isApiError(matchQuery.error)
      ? messageFor(matchQuery.error).title
      : MATCH_PROFILE_COPY.genericError;
    return (
      <View className="flex-1 bg-surface">
        <MatchProfileHeader onBack={handleBack} />
        <View className="flex-1 items-center justify-center p-space-md">
          <ErrorState
            title={errorTitle}
            onRetry={() => {
              void matchQuery.refetch();
            }}
          />
        </View>
      </View>
    );
  }

  const match = matchQuery.data?.match ?? null;
  if (match === null) {
    return (
      <View className="flex-1 bg-surface">
        <MatchProfileHeader onBack={handleBack} />
        <View className="flex-1 items-center justify-center p-space-md">
          <EmptyState
            title={MATCH_PROFILE_COPY.noMatch.title}
            description={MATCH_PROFILE_COPY.noMatch.description}
            action={
              <Button
                variant="primary"
                size="md"
                onPress={() => {
                  router.replace('/(main)/home');
                }}
              >
                {MATCH_PROFILE_COPY.noMatch.cta}
              </Button>
            }
          />
        </View>
      </View>
    );
  }

  return <MatchProfileContent matchId={match.matchId} onBack={handleBack} />;
}
