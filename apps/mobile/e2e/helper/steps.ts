/** Bước helper e2e mobile (FE-S6-01) → các key `output.*` mà bước đó trả về cho Maestro. */
export const HELPER_STEPS = {
  start: ['phone', 'fullName', 'partnerId'],
  'otp-window': [],
  otp: ['otp'],
  pay: [],
  approve: [],
  'counterpart-accept': ['conversationId'],
  'counterpart-message': ['replyText'],
  'date-repropose': [],
  'wait-date-start': [],
  'counterpart-feedback': [],
} as const satisfies Record<string, readonly string[]>;

export type HelperStep = keyof typeof HELPER_STEPS;
export type HelperStepOutput<S extends HelperStep> = Record<(typeof HELPER_STEPS)[S][number], string>;

export function isHelperStep(value: string): value is HelperStep {
  return Object.prototype.hasOwnProperty.call(HELPER_STEPS, value);
}
