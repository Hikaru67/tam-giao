import type { DomainError, Result, Tx } from '@tamgiao/kernel';

/**
 * Độc quyền 1-1 (ARCHITECTURE mục 5, A10): mỗi người dùng chỉ giữ tối đa một "slot" = một match đang mở.
 * Ràng buộc nằm ở DB (`matching.active_slots.user_id` PK), không chỉ kiểm tra ở code.
 *
 * Id dùng `string` (uuid) để port không phụ thuộc domain matching; `Id<'User'>` / id match gán vào được.
 */
export interface ActiveSlotRepository {
  /**
   * Giữ slot cho tất cả `userIds` thuộc `matchId` trong cùng `tx` — tất cả hoặc không.
   * Có người đang giữ slot của match khác → `USER_BUSY` với `details.userIds` = các uuid đang bận; khi đó không slot
   * nào được giữ thêm và `tx` của caller vẫn dùng tiếp được (không bị abort). Claim lại đúng `matchId` đã giữ → `ok`
   * (idempotent). `userIds` rỗng → lỗi lập trình (throw).
   */
  claim(
    tx: Tx,
    userIds: readonly string[],
    matchId: string,
    now: Date,
  ): Promise<Result<void, DomainError<'USER_BUSY'>>>;

  /** Trả slot của mọi người trong `matchId`. Idempotent: gọi lại khi đã trả → không làm gì. */
  release(tx: Tx, matchId: string): Promise<void>;
}
