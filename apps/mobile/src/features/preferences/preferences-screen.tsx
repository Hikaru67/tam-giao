import { useEffect, useState } from 'react';
import { isApiError, messageFor } from '@tamgiao/api-client';
import {
  CHILDREN_PLANS,
  CORE_TRAITS,
  CORE_TRAITS_COUNT,
  DAILY_RHYTHMS,
  DRINKING_HABITS,
  EDUCATION_LEVELS,
  FINANCIAL_INDEPENDENCE,
  RELIGIONS,
  SMOKING_HABITS,
  SPORTS_HABITS,
  type UpdatePreferencesBody,
} from '@tamgiao/contracts/profile';
import { Button, Card, ErrorState, Stepper, Text, TextField } from '@tamgiao/ui-mobile';
import { useRouter } from 'expo-router';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { AgeStepper } from './age-stepper.js';
import { ChoiceChip } from './choice-chip.js';
import { PREFERENCES_COPY } from './copy.js';
import type {
  ChildrenPlan,
  CoreTrait,
  DailyRhythm,
  DrinkingHabit,
  EducationLevel,
  FinancialIndependence,
  Religion,
  SmokingHabit,
  SportsHabit,
} from './types.js';
import { DEFAULT_PREFERENCES, usePreferences, useSavePreferences } from './use-preferences.js';

export function PreferencesScreen() {
  const router = useRouter();
  const { data: initialPreferences, isLoading, isError, refetch } = usePreferences();
  const savePreferencesMutation = useSavePreferences();

  const [form, setForm] = useState<UpdatePreferencesBody>(DEFAULT_PREFERENCES);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<{ title: string; action?: string } | null>(null);

  useEffect(() => {
    if (initialPreferences) {
      setForm(initialPreferences);
    }
  }, [initialPreferences]);

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-surface p-space-md gap-space-sm">
        <ActivityIndicator size="large" color="#b80035" />
        <Text variant="title-md" className="font-semibold text-primary">
          {PREFERENCES_COPY.loading}
        </Text>
      </View>
    );
  }

  if (isError) {
    return (
      <View className="flex-1 items-center justify-center bg-surface p-space-md">
        <ErrorState
          title={PREFERENCES_COPY.error.title}
          action={PREFERENCES_COPY.error.retry}
          onRetry={() => {
            void refetch();
          }}
        />
      </View>
    );
  }

  const handleToggleTrait = (trait: CoreTrait) => {
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next.coreTraits;
      return next;
    });

    if (form.coreTraits.includes(trait)) {
      setForm((prev) => ({
        ...prev,
        coreTraits: prev.coreTraits.filter((t) => t !== trait),
      }));
    } else {
      if (form.coreTraits.length < CORE_TRAITS_COUNT) {
        setForm((prev) => ({
          ...prev,
          coreTraits: [...prev.coreTraits, trait],
        }));
      }
    }
  };

  const handleSave = async () => {
    setFieldErrors({});
    setServerError(null);

    const newFieldErrors: Record<string, string> = {};

    if (form.ageMin > form.ageMax) {
      newFieldErrors.ageMax = PREFERENCES_COPY.validation.ageMinGreaterThanMax;
    }

    if (form.coreTraits.length !== CORE_TRAITS_COUNT) {
      newFieldErrors.coreTraits = PREFERENCES_COPY.validation.coreTraitsCount;
    }

    if (Object.keys(newFieldErrors).length > 0) {
      setFieldErrors(newFieldErrors);
      return;
    }

    try {
      await savePreferencesMutation.mutateAsync(form);
    } catch (err) {
      if (isApiError(err)) {
        if (err.fieldErrors && err.fieldErrors.length > 0) {
          const errorsMap: Record<string, string> = {};
          for (const fe of err.fieldErrors) {
            errorsMap[fe.path] = fe.message;
          }
          setFieldErrors(errorsMap);
        } else if (err.code === 'INVALID_CORE_TRAITS') {
          setFieldErrors({ coreTraits: PREFERENCES_COPY.validation.coreTraitsCount });
        }
        setServerError(messageFor(err));
      } else {
        setServerError(messageFor({ code: 'NETWORK_ERROR' }));
      }
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-surface"
    >
      {/* Fixed Header */}
      <View className="pt-safe bg-surface border-b border-surface-container-high/60 z-30">
        <View className="h-16 px-margin flex-row items-center justify-between">
          <View className="flex-row items-center gap-space-xs flex-1 mr-2">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={PREFERENCES_COPY.header.back}
              onPress={() => router.back()}
              className="w-10 h-10 rounded-full items-center justify-center bg-surface-container-low"
            >
              <Text variant="title-md" className="text-primary font-bold">
                ←
              </Text>
            </Pressable>
            <Text variant="title-md" className="font-semibold text-on-surface truncate flex-1">
              {PREFERENCES_COPY.header.title}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={PREFERENCES_COPY.header.saveChanges}
            disabled={savePreferencesMutation.isPending}
            onPress={handleSave}
            className="px-2 py-1"
          >
            <Text variant="label-md" className="text-primary font-semibold">
              {PREFERENCES_COPY.header.saveChanges}
            </Text>
          </Pressable>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        className="flex-1 px-margin"
      >
        <View className="py-space-md gap-space-lg pb-48 max-w-md mx-auto w-full">
          {/* Top Progress Subheader */}
          <View className="flex-col gap-2 py-space-xs">
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center gap-space-xs">
                <View className="px-2 py-0.5 rounded-full bg-primary-fixed">
                  <Text
                    variant="label-sm"
                    className="text-on-primary-fixed font-semibold uppercase tracking-wider"
                  >
                    {PREFERENCES_COPY.progress.stepBadge}
                  </Text>
                </View>
                <Text variant="title-md" className="font-semibold text-on-surface">
                  {PREFERENCES_COPY.progress.stepTitle}
                </Text>
              </View>
            </View>

            <Stepper
              steps={[
                { label: PREFERENCES_COPY.progress.steps.profile, state: 'done' },
                { label: PREFERENCES_COPY.progress.steps.preferences, state: 'current' },
                { label: PREFERENCES_COPY.progress.steps.verification, state: 'todo' },
              ]}
            />
          </View>

          {/* Philosophy Banner */}
          <Card className="bg-surface-container-low border-none">
            <View className="flex-row items-start gap-space-sm">
              <View className="w-9 h-9 rounded-full bg-primary-container/10 items-center justify-center shrink-0">
                <Text variant="title-md" className="text-primary font-bold">
                  ✓
                </Text>
              </View>
              <View className="flex-1">
                <Text variant="title-md" className="text-on-surface font-semibold mb-1">
                  {PREFERENCES_COPY.philosophyBanner.title}
                </Text>
                <Text variant="body-sm" className="text-secondary leading-snug">
                  {PREFERENCES_COPY.philosophyBanner.content}
                </Text>
              </View>
            </View>
          </Card>

          {/* Server / General Error Alert */}
          {serverError ? (
            <View
              accessibilityRole="alert"
              className="p-space-md rounded-xl bg-error-container/40 border border-error/30 gap-1"
            >
              <Text variant="title-md" className="font-semibold text-error">
                {serverError.title}
              </Text>
              {serverError.action ? (
                <Text variant="body-sm" className="text-secondary">
                  {serverError.action}
                </Text>
              ) : null}
            </View>
          ) : null}

          {/* Block 1: Deal-Breakers (Bộ lọc cứng) */}
          <View className="flex-col gap-space-md">
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center gap-2">
                <View className="w-2.5 h-2.5 rounded-full bg-primary" />
                <Text variant="headline-sm" className="font-semibold text-on-surface">
                  {PREFERENCES_COPY.dealBreakers.title}
                </Text>
              </View>
              <View className="px-2 py-0.5 rounded-full bg-primary/10">
                <Text variant="label-sm" className="text-primary uppercase font-bold tracking-wider">
                  {PREFERENCES_COPY.dealBreakers.badge}
                </Text>
              </View>
            </View>

            {/* Age Range Card */}
            <Card className="flex-col gap-space-sm">
              <View className="flex-row justify-between items-center">
                <Text variant="title-md" className="font-semibold text-on-surface">
                  {PREFERENCES_COPY.dealBreakers.age.title}
                </Text>
                <View className="bg-primary-fixed/30 px-2.5 py-0.5 rounded-full">
                  <Text variant="title-md" className="text-primary font-bold">
                    {PREFERENCES_COPY.dealBreakers.age.rangeDisplay(form.ageMin, form.ageMax)}
                  </Text>
                </View>
              </View>
              <Text variant="body-sm" className="text-secondary">
                {PREFERENCES_COPY.dealBreakers.age.subtitle}
              </Text>

              <AgeStepper
                ageMin={form.ageMin}
                ageMax={form.ageMax}
                onChange={({ ageMin, ageMax }) => {
                  setFieldErrors((prev) => {
                    const next = { ...prev };
                    delete next.ageMax;
                    delete next.ageMin;
                    return next;
                  });
                  setForm((prev) => ({ ...prev, ageMin, ageMax }));
                }}
                error={fieldErrors.ageMax ?? fieldErrors.ageMin}
                disabled={savePreferencesMutation.isPending}
              />
            </Card>

            {/* Location & Distance */}
            <Card className="flex-col gap-space-sm">
              <View className="flex-row items-center justify-between">
                <Text variant="title-md" className="font-semibold text-on-surface">
                  {PREFERENCES_COPY.dealBreakers.area.title}
                </Text>
                <Text variant="label-sm" className="text-secondary font-medium">
                  {form.area.radiusKm ? `Bán kính ${form.area.radiusKm}km` : 'Cả tỉnh/thành'}
                </Text>
              </View>

              {/* Radius Chips */}
              <View className="flex-col gap-1.5 mt-1">
                <Text variant="label-sm" className="text-secondary font-medium">
                  {PREFERENCES_COPY.dealBreakers.area.radiusTitle}
                </Text>
                <View className="flex-row flex-wrap gap-1.5">
                  <ChoiceChip
                    label={PREFERENCES_COPY.dealBreakers.area.radii.km20}
                    selected={form.area.radiusKm === 20}
                    onPress={() => setForm((prev) => ({ ...prev, area: { ...prev.area, radiusKm: 20 } }))}
                    disabled={savePreferencesMutation.isPending}
                  />
                  <ChoiceChip
                    label={PREFERENCES_COPY.dealBreakers.area.radii.km50}
                    selected={form.area.radiusKm === 50}
                    onPress={() => setForm((prev) => ({ ...prev, area: { ...prev.area, radiusKm: 50 } }))}
                    disabled={savePreferencesMutation.isPending}
                  />
                  <ChoiceChip
                    label={PREFERENCES_COPY.dealBreakers.area.radii.km100}
                    selected={form.area.radiusKm === 100}
                    onPress={() => setForm((prev) => ({ ...prev, area: { ...prev.area, radiusKm: 100 } }))}
                    disabled={savePreferencesMutation.isPending}
                  />
                  <ChoiceChip
                    label={PREFERENCES_COPY.dealBreakers.area.radii.all}
                    selected={form.area.radiusKm === null}
                    onPress={() => setForm((prev) => ({ ...prev, area: { ...prev.area, radiusKm: null } }))}
                    disabled={savePreferencesMutation.isPending}
                  />
                </View>
              </View>

              {/* City Selection */}
              <View className="flex-col gap-1.5 mt-2">
                <Text variant="label-sm" className="text-secondary font-medium">
                  {PREFERENCES_COPY.dealBreakers.area.cityTitle}
                </Text>
                <View className="flex-row flex-wrap gap-1.5 mb-1">
                  <ChoiceChip
                    label={PREFERENCES_COPY.dealBreakers.area.cities.hcm}
                    selected={form.area.city === 'TP. Hồ Chí Minh'}
                    onPress={() =>
                      setForm((prev) => ({
                        ...prev,
                        area: { ...prev.area, city: 'TP. Hồ Chí Minh' },
                      }))
                    }
                    disabled={savePreferencesMutation.isPending}
                  />
                  <ChoiceChip
                    label={PREFERENCES_COPY.dealBreakers.area.cities.hanoi}
                    selected={form.area.city === 'Hà Nội'}
                    onPress={() =>
                      setForm((prev) => ({
                        ...prev,
                        area: { ...prev.area, city: 'Hà Nội' },
                      }))
                    }
                    disabled={savePreferencesMutation.isPending}
                  />
                  <ChoiceChip
                    label={PREFERENCES_COPY.dealBreakers.area.cities.danang}
                    selected={form.area.city === 'Đà Nẵng'}
                    onPress={() =>
                      setForm((prev) => ({
                        ...prev,
                        area: { ...prev.area, city: 'Đà Nẵng' },
                      }))
                    }
                    disabled={savePreferencesMutation.isPending}
                  />
                  <ChoiceChip
                    label={PREFERENCES_COPY.dealBreakers.area.cities.all}
                    selected={form.area.city === null}
                    onPress={() =>
                      setForm((prev) => ({
                        ...prev,
                        area: { ...prev.area, city: null },
                      }))
                    }
                    disabled={savePreferencesMutation.isPending}
                  />
                </View>

                <TextField
                  placeholder={PREFERENCES_COPY.dealBreakers.area.cityPlaceholder}
                  value={form.area.city ?? ''}
                  onChangeText={(text) =>
                    setForm((prev) => ({
                      ...prev,
                      area: {
                        ...prev.area,
                        city: text.trim().length > 0 ? text : null,
                      },
                    }))
                  }
                  disabled={savePreferencesMutation.isPending}
                  error={fieldErrors['area.city'] ?? fieldErrors.city}
                />
              </View>
            </Card>

            {/* Children Plan */}
            <Card className="flex-col gap-space-sm">
              <Text variant="title-md" className="font-semibold text-on-surface">
                {PREFERENCES_COPY.dealBreakers.childrenPlan.title}
              </Text>
              <View className="flex-col gap-2">
                {CHILDREN_PLANS.map((plan) => (
                  <ChoiceChip
                    key={plan}
                    label={PREFERENCES_COPY.dealBreakers.childrenPlan.options[plan as ChildrenPlan]}
                    selected={form.childrenPlan === plan}
                    onPress={() => setForm((prev) => ({ ...prev, childrenPlan: plan as ChildrenPlan }))}
                    disabled={savePreferencesMutation.isPending}
                    className="justify-start py-2.5 px-4"
                  />
                ))}
              </View>
              {fieldErrors.childrenPlan ? (
                <Text variant="body-sm" className="text-error font-medium">
                  {fieldErrors.childrenPlan}
                </Text>
              ) : null}
            </Card>

            {/* Religion Preference */}
            <Card className="flex-col gap-space-sm">
              <Text variant="title-md" className="font-semibold text-on-surface">
                {PREFERENCES_COPY.dealBreakers.religion.title}
              </Text>
              <View className="flex-row flex-wrap gap-1.5">
                {RELIGIONS.map((rel) => (
                  <ChoiceChip
                    key={rel}
                    label={PREFERENCES_COPY.dealBreakers.religion.options[rel as Religion]}
                    selected={form.religion === rel}
                    onPress={() => setForm((prev) => ({ ...prev, religion: rel as Religion }))}
                    disabled={savePreferencesMutation.isPending}
                  />
                ))}
              </View>
              {fieldErrors.religion ? (
                <Text variant="body-sm" className="text-error font-medium">
                  {fieldErrors.religion}
                </Text>
              ) : null}
            </Card>

            {/* Lifestyle & Habits */}
            <Card className="flex-col gap-space-md">
              <Text variant="title-md" className="font-semibold text-on-surface">
                {PREFERENCES_COPY.dealBreakers.lifestyle.title}
              </Text>

              {/* Smoking */}
              <View className="flex-col gap-1.5">
                <Text variant="label-md" className="font-semibold text-on-surface">
                  {PREFERENCES_COPY.dealBreakers.lifestyle.smoking.title}
                </Text>
                <View className="flex-row flex-wrap gap-1.5">
                  {SMOKING_HABITS.map((habit) => (
                    <ChoiceChip
                      key={habit}
                      label={PREFERENCES_COPY.dealBreakers.lifestyle.smoking.options[habit as SmokingHabit]}
                      selected={form.lifestyle.smoking === habit}
                      onPress={() =>
                        setForm((prev) => ({
                          ...prev,
                          lifestyle: { ...prev.lifestyle, smoking: habit as SmokingHabit },
                        }))
                      }
                      disabled={savePreferencesMutation.isPending}
                    />
                  ))}
                </View>
              </View>

              {/* Drinking */}
              <View className="flex-col gap-1.5">
                <Text variant="label-md" className="font-semibold text-on-surface">
                  {PREFERENCES_COPY.dealBreakers.lifestyle.drinking.title}
                </Text>
                <View className="flex-row flex-wrap gap-1.5">
                  {DRINKING_HABITS.map((habit) => (
                    <ChoiceChip
                      key={habit}
                      label={PREFERENCES_COPY.dealBreakers.lifestyle.drinking.options[habit as DrinkingHabit]}
                      selected={form.lifestyle.drinking === habit}
                      onPress={() =>
                        setForm((prev) => ({
                          ...prev,
                          lifestyle: { ...prev.lifestyle, drinking: habit as DrinkingHabit },
                        }))
                      }
                      disabled={savePreferencesMutation.isPending}
                    />
                  ))}
                </View>
              </View>

              {/* Daily Rhythm */}
              <View className="flex-col gap-1.5">
                <Text variant="label-md" className="font-semibold text-on-surface">
                  {PREFERENCES_COPY.dealBreakers.lifestyle.dailyRhythm.title}
                </Text>
                <View className="flex-row flex-wrap gap-1.5">
                  {DAILY_RHYTHMS.map((rhythm) => (
                    <ChoiceChip
                      key={rhythm}
                      label={
                        PREFERENCES_COPY.dealBreakers.lifestyle.dailyRhythm.options[rhythm as DailyRhythm]
                      }
                      selected={form.lifestyle.dailyRhythm === rhythm}
                      onPress={() =>
                        setForm((prev) => ({
                          ...prev,
                          lifestyle: { ...prev.lifestyle, dailyRhythm: rhythm as DailyRhythm },
                        }))
                      }
                      disabled={savePreferencesMutation.isPending}
                    />
                  ))}
                </View>
              </View>

              {/* Sports */}
              <View className="flex-col gap-1.5">
                <Text variant="label-md" className="font-semibold text-on-surface">
                  {PREFERENCES_COPY.dealBreakers.lifestyle.sports.title}
                </Text>
                <View className="flex-row flex-wrap gap-1.5">
                  {SPORTS_HABITS.map((habit) => (
                    <ChoiceChip
                      key={habit}
                      label={PREFERENCES_COPY.dealBreakers.lifestyle.sports.options[habit as SportsHabit]}
                      selected={form.lifestyle.sports === habit}
                      onPress={() =>
                        setForm((prev) => ({
                          ...prev,
                          lifestyle: { ...prev.lifestyle, sports: habit as SportsHabit },
                        }))
                      }
                      disabled={savePreferencesMutation.isPending}
                    />
                  ))}
                </View>
              </View>
            </Card>
          </View>

          {/* Block 2: Education & Background */}
          <View className="flex-col gap-space-md">
            <View className="flex-row items-center gap-2">
              <View className="w-2.5 h-2.5 rounded-full bg-secondary" />
              <Text variant="headline-sm" className="font-semibold text-on-surface">
                {PREFERENCES_COPY.educationAndBackground.title}
              </Text>
            </View>

            {/* Minimum Education */}
            <Card className="flex-col gap-space-sm">
              <View className="flex-row items-center justify-between">
                <Text variant="title-md" className="font-semibold text-on-surface">
                  {PREFERENCES_COPY.educationAndBackground.minEducation.title}
                </Text>
                <View className="px-2 py-0.5 rounded-full bg-secondary-container">
                  <Text variant="label-sm" className="text-on-secondary-container font-semibold">
                    {form.minEducation
                      ? PREFERENCES_COPY.educationAndBackground.minEducation.options[form.minEducation]
                      : PREFERENCES_COPY.educationAndBackground.minEducation.options.none}
                  </Text>
                </View>
              </View>
              <Text variant="body-sm" className="text-secondary">
                {PREFERENCES_COPY.educationAndBackground.minEducation.subtitle}
              </Text>
              <View className="flex-row flex-wrap gap-1.5 mt-1">
                <ChoiceChip
                  label={PREFERENCES_COPY.educationAndBackground.minEducation.options.none}
                  selected={form.minEducation === null}
                  onPress={() => setForm((prev) => ({ ...prev, minEducation: null }))}
                  disabled={savePreferencesMutation.isPending}
                />
                {EDUCATION_LEVELS.map((level) => (
                  <ChoiceChip
                    key={level}
                    label={
                      PREFERENCES_COPY.educationAndBackground.minEducation.options[level as EducationLevel]
                    }
                    selected={form.minEducation === level}
                    onPress={() => setForm((prev) => ({ ...prev, minEducation: level as EducationLevel }))}
                    disabled={savePreferencesMutation.isPending}
                  />
                ))}
              </View>
            </Card>

            {/* Financial Independence */}
            <Card className="flex-col gap-space-sm">
              <Text variant="title-md" className="font-semibold text-on-surface">
                {PREFERENCES_COPY.educationAndBackground.financialIndependence.title}
              </Text>
              <Text variant="body-sm" className="text-secondary">
                {PREFERENCES_COPY.educationAndBackground.financialIndependence.subtitle}
              </Text>
              <View className="flex-row flex-wrap gap-1.5 mt-1">
                {FINANCIAL_INDEPENDENCE.map((item) => (
                  <ChoiceChip
                    key={item}
                    label={
                      PREFERENCES_COPY.educationAndBackground.financialIndependence.options[
                        item as FinancialIndependence
                      ]
                    }
                    selected={form.financialIndependence === item}
                    onPress={() =>
                      setForm((prev) => ({
                        ...prev,
                        financialIndependence: item as FinancialIndependence,
                      }))
                    }
                    disabled={savePreferencesMutation.isPending}
                  />
                ))}
              </View>
            </Card>
          </View>

          {/* Block 3: Core Values (3 Phẩm chất cốt lõi ưu tiên) */}
          <View className="flex-col gap-space-md">
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center gap-2">
                <View className="w-2.5 h-2.5 rounded-full bg-tertiary" />
                <Text variant="headline-sm" className="font-semibold text-on-surface">
                  {PREFERENCES_COPY.coreTraits.title}
                </Text>
              </View>
              <Text variant="label-sm" className="text-primary font-semibold">
                {PREFERENCES_COPY.coreTraits.counter(form.coreTraits.length, CORE_TRAITS_COUNT)}
              </Text>
            </View>

            <Text variant="body-sm" className="text-secondary -mt-2">
              {PREFERENCES_COPY.coreTraits.subtitle}
            </Text>

            <View className="flex-row flex-wrap gap-2">
              {CORE_TRAITS.map((trait) => {
                const isSelected = form.coreTraits.includes(trait as CoreTrait);
                return (
                  <ChoiceChip
                    key={trait}
                    label={PREFERENCES_COPY.coreTraits.options[trait as CoreTrait]}
                    selected={isSelected}
                    onPress={() => handleToggleTrait(trait as CoreTrait)}
                    disabled={savePreferencesMutation.isPending}
                  />
                );
              })}
            </View>

            {fieldErrors.coreTraits ? (
              <Text variant="body-sm" className="text-error font-medium">
                {fieldErrors.coreTraits}
              </Text>
            ) : null}
          </View>

          {/* Mutual Match Assurance Box */}
          <Card className="bg-surface-container border-none flex-row items-start gap-space-sm">
            <View className="w-9 h-9 rounded-full bg-surface-container-highest items-center justify-center shrink-0">
              <Text variant="title-md" className="text-on-surface font-bold">
                ⇄
              </Text>
            </View>
            <View className="flex-1">
              <Text variant="title-md" className="font-semibold text-on-surface mb-0.5">
                {PREFERENCES_COPY.mutualAssurance.title}
              </Text>
              <Text variant="body-sm" className="text-secondary leading-relaxed">
                {PREFERENCES_COPY.mutualAssurance.content}
              </Text>
            </View>
          </Card>
        </View>
      </ScrollView>

      {/* Bottom Fixed Action Bar */}
      <View className="absolute bottom-0 left-0 right-0 p-margin bg-surface/95 border-t border-surface-container-high/60 flex-col gap-2 shadow-lg">
        {/* Hint banner */}
        <View className="flex-row items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-fixed/25 border border-primary-fixed/40">
          <Text variant="label-sm" className="text-primary font-semibold text-center">
            {PREFERENCES_COPY.submit.hint}
          </Text>
        </View>

        {/* Main CTA Button */}
        <Button
          testID="preferences-submit"
          variant="primary"
          size="lg"
          fullWidth
          loading={savePreferencesMutation.isPending}
          disabled={savePreferencesMutation.isPending}
          onPress={handleSave}
        >
          {PREFERENCES_COPY.submit.button}
        </Button>

        <Text variant="label-sm" className="text-secondary text-center">
          {PREFERENCES_COPY.submit.subtitle}
        </Text>

        <Text variant="label-sm" className="text-secondary text-center opacity-80">
          {PREFERENCES_COPY.submit.securityNotice}
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}
