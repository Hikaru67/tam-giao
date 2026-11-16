/** Payload event module identity phát ra ngoài (qua outbox). Không chứa PII — consumer tự tra theo id. */
export const USER_REGISTERED = 'UserRegistered';
export interface UserRegisteredPayload {
  readonly userId: string;
}
