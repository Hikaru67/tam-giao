export { REDACTED, SENSITIVE_KEYS, scrubBreadcrumb, scrubData, scrubEvent, scrubString } from './scrub.js';

export { FUNNEL_STEPS, createFunnelTracker } from './funnel.js';
export type { FunnelStep, FunnelTracker, OnboardingStep } from './funnel.js';

export { buildInitOptions, createObservability, shouldReportApiError } from './observability.js';
export type {
  CreateObservabilityOptions,
  Observability,
  ObservabilityInitOptions,
  ObservabilitySdk,
} from './observability.js';
