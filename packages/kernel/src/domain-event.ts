/**
 * Sự kiện nghiệp vụ đã xảy ra (thì quá khứ, vd `MatchOffered`). Chỉ được phát qua outbox (AGENTS.md A6).
 * `payload` phải tuần tự hoá được thành JSON và không chứa PII thô.
 */
export interface DomainEvent<TType extends string = string, TPayload = unknown> {
  readonly eventId: string;
  readonly type: TType;
  readonly aggregateType: string;
  readonly aggregateId: string;
  /** Version của aggregate sau khi sự kiện xảy ra — dùng để sắp thứ tự và chống trùng. */
  readonly version: number;
  readonly occurredAt: Date;
  readonly payload: TPayload;
}
