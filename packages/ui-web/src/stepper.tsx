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
    <nav aria-label="Các bước tiến trình" className={`w-full ${className}`.trim()}>
      <ol className="flex items-center w-full">
        {steps.map((step, index) => {
          const isLast = index === steps.length - 1;
          const isDone = step.state === 'done';
          const isCurrent = step.state === 'current';

          return (
            <li
              key={index}
              className={`flex items-center ${isLast ? '' : 'flex-1'}`}
              aria-current={isCurrent ? 'step' : undefined}
            >
              <div className="flex flex-col items-center gap-1">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-label-sm font-bold transition-colors ${
                    isDone
                      ? 'bg-primary text-on-primary'
                      : isCurrent
                        ? 'bg-primary-container text-on-primary ring-4 ring-primary-fixed'
                        : 'bg-surface-container-high text-secondary border border-outline-variant'
                  }`}
                >
                  {isDone ? '✓' : index + 1}
                </div>
                <span
                  className={`text-label-sm whitespace-nowrap ${
                    isCurrent
                      ? 'font-bold text-primary'
                      : isDone
                        ? 'font-medium text-on-surface'
                        : 'text-secondary'
                  }`}
                >
                  {step.label}
                </span>
              </div>
              {!isLast ? (
                <div
                  className={`h-0.5 flex-1 mx-space-sm self-start mt-4 transition-colors ${
                    isDone ? 'bg-primary' : 'bg-outline-variant'
                  }`}
                  aria-hidden="true"
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
