import { View } from 'react-native';
import { Text } from './text.js';

export type StepState = 'done' | 'current' | 'todo';

export interface StepItem {
  label: string;
  state: StepState;
}

export interface StepperProps {
  steps: StepItem[];
  className?: string;
}

export function Stepper({ steps, className = '' }: StepperProps) {
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Các bước tiến trình"
      className={`flex-row items-center w-full ${className}`.trim()}
    >
      {steps.map((step, index) => {
        const isLast = index === steps.length - 1;
        const isDone = step.state === 'done';
        const isCurrent = step.state === 'current';

        return (
          <View key={index} className={`flex-row items-center ${isLast ? '' : 'flex-1'}`}>
            <View className="items-center gap-1">
              <View
                className={`w-8 h-8 rounded-full items-center justify-center ${
                  isDone
                    ? 'bg-primary'
                    : isCurrent
                      ? 'bg-primary-container ring-4 ring-primary-fixed'
                      : 'bg-surface-container-high border border-outline-variant'
                }`}
              >
                <Text
                  variant="label-sm"
                  className={`font-bold ${isDone || isCurrent ? 'text-on-primary' : 'text-secondary'}`}
                >
                  {isDone ? '✓' : String(index + 1)}
                </Text>
              </View>
              <Text
                variant="label-sm"
                className={`${
                  isCurrent
                    ? 'font-bold text-primary'
                    : isDone
                      ? 'font-medium text-on-surface'
                      : 'text-secondary'
                }`}
              >
                {step.label}
              </Text>
            </View>
            {!isLast ? (
              <View
                className={`h-0.5 flex-1 mx-space-sm self-start mt-4 ${
                  isDone ? 'bg-primary' : 'bg-outline-variant'
                }`}
              />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
