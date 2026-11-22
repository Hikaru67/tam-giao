import { MIN_AGE } from '@tamgiao/contracts/constants';
import { PREFERENCE_AGE_MAX } from '@tamgiao/contracts/profile';
import { Text } from '@tamgiao/ui-mobile';
import { Pressable, View } from 'react-native';
import { PREFERENCES_COPY } from './copy.js';

export interface AgeStepperProps {
  ageMin: number;
  ageMax: number;
  onChange: (range: { ageMin: number; ageMax: number }) => void;
  error?: string | undefined;
  disabled?: boolean | undefined;
}

export function AgeStepper({ ageMin, ageMax, onChange, error, disabled = false }: AgeStepperProps) {
  const rangeSpan = PREFERENCE_AGE_MAX - MIN_AGE;
  const leftPercent = Math.max(0, Math.min(100, ((ageMin - MIN_AGE) / rangeSpan) * 100));
  const rightPercent = Math.max(0, Math.min(100, ((PREFERENCE_AGE_MAX - ageMax) / rangeSpan) * 100));

  const isMinAtFloor = ageMin <= MIN_AGE;
  const isMinAtMax = ageMin >= ageMax;
  const isMaxAtMin = ageMax <= ageMin;
  const isMaxAtCeiling = ageMax >= PREFERENCE_AGE_MAX;

  const handleDecreaseMin = () => {
    if (disabled || isMinAtFloor) return;
    onChange({ ageMin: ageMin - 1, ageMax });
  };

  const handleIncreaseMin = () => {
    if (disabled || isMinAtMax || ageMin >= PREFERENCE_AGE_MAX) return;
    onChange({ ageMin: ageMin + 1, ageMax });
  };

  const handleDecreaseMax = () => {
    if (disabled || isMaxAtMin || ageMax <= MIN_AGE) return;
    onChange({ ageMin, ageMax: ageMax - 1 });
  };

  const handleIncreaseMax = () => {
    if (disabled || isMaxAtCeiling) return;
    onChange({ ageMin, ageMax: ageMax + 1 });
  };

  const hasRangeError = ageMin > ageMax || Boolean(error);
  const displayError =
    error ?? (ageMin > ageMax ? PREFERENCES_COPY.validation.ageMinGreaterThanMax : undefined);

  return (
    <View className="flex-col gap-space-sm w-full">
      {/* Visual slider progress bar matching design */}
      <View className="pt-2 px-1">
        <View className="relative w-full h-2 bg-surface-container-high rounded-full overflow-hidden">
          <View
            className="absolute h-full bg-primary rounded-full"
            style={{ left: `${leftPercent}%`, right: `${rightPercent}%` }}
          />
        </View>
        <View className="flex-row justify-between mt-2">
          <Text variant="label-sm" className="text-secondary font-medium">
            {MIN_AGE} tuổi
          </Text>
          <Text variant="label-sm" className="text-secondary font-medium">
            50 tuổi
          </Text>
          <Text variant="label-sm" className="text-secondary font-medium">
            {PREFERENCE_AGE_MAX} tuổi
          </Text>
        </View>
      </View>

      {/* Two stepper controls */}
      <View className="flex-row gap-space-sm mt-space-xs">
        {/* Min age stepper */}
        <View className="flex-1 p-space-sm rounded-xl bg-surface-container-low border border-outline-variant/30 flex-col gap-1 items-center">
          <Text variant="label-sm" className="text-secondary font-medium">
            {PREFERENCES_COPY.dealBreakers.age.minLabel}
          </Text>
          <View className="flex-row items-center justify-between w-full mt-1">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={PREFERENCES_COPY.dealBreakers.age.decreaseMinA11y}
              accessibilityState={{ disabled: disabled || isMinAtFloor }}
              disabled={disabled || isMinAtFloor}
              onPress={handleDecreaseMin}
              className={`w-9 h-9 rounded-full bg-surface-container-lowest items-center justify-center border border-outline-variant/40 shadow-sm ${
                disabled || isMinAtFloor ? 'opacity-40' : 'active:bg-surface-container'
              }`}
            >
              <Text variant="title-md" className="font-bold text-primary">
                −
              </Text>
            </Pressable>
            <Text
              testID="age-min-value"
              variant="title-md"
              className="font-bold text-primary text-center px-1"
            >
              {ageMin} {PREFERENCES_COPY.dealBreakers.age.unit}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={PREFERENCES_COPY.dealBreakers.age.increaseMinA11y}
              accessibilityState={{ disabled: disabled || isMinAtMax }}
              disabled={disabled || isMinAtMax}
              onPress={handleIncreaseMin}
              className={`w-9 h-9 rounded-full bg-surface-container-lowest items-center justify-center border border-outline-variant/40 shadow-sm ${
                disabled || isMinAtMax ? 'opacity-40' : 'active:bg-surface-container'
              }`}
            >
              <Text variant="title-md" className="font-bold text-primary">
                +
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Max age stepper */}
        <View className="flex-1 p-space-sm rounded-xl bg-surface-container-low border border-outline-variant/30 flex-col gap-1 items-center">
          <Text variant="label-sm" className="text-secondary font-medium">
            {PREFERENCES_COPY.dealBreakers.age.maxLabel}
          </Text>
          <View className="flex-row items-center justify-between w-full mt-1">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={PREFERENCES_COPY.dealBreakers.age.decreaseMaxA11y}
              accessibilityState={{ disabled: disabled || isMaxAtMin }}
              disabled={disabled || isMaxAtMin}
              onPress={handleDecreaseMax}
              className={`w-9 h-9 rounded-full bg-surface-container-lowest items-center justify-center border border-outline-variant/40 shadow-sm ${
                disabled || isMaxAtMin ? 'opacity-40' : 'active:bg-surface-container'
              }`}
            >
              <Text variant="title-md" className="font-bold text-primary">
                −
              </Text>
            </Pressable>
            <Text
              testID="age-max-value"
              variant="title-md"
              className="font-bold text-primary text-center px-1"
            >
              {ageMax} {PREFERENCES_COPY.dealBreakers.age.unit}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={PREFERENCES_COPY.dealBreakers.age.increaseMaxA11y}
              accessibilityState={{ disabled: disabled || isMaxAtCeiling }}
              disabled={disabled || isMaxAtCeiling}
              onPress={handleIncreaseMax}
              className={`w-9 h-9 rounded-full bg-surface-container-lowest items-center justify-center border border-outline-variant/40 shadow-sm ${
                disabled || isMaxAtCeiling ? 'opacity-40' : 'active:bg-surface-container'
              }`}
            >
              <Text variant="title-md" className="font-bold text-primary">
                +
              </Text>
            </Pressable>
          </View>
        </View>
      </View>

      {hasRangeError && displayError ? (
        <Text variant="body-sm" className="text-error font-medium">
          {displayError}
        </Text>
      ) : null}
    </View>
  );
}
