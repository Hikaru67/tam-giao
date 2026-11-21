/**
 * API công khai read-only của module messaging cho module khác (AGENTS.md A3). BE-S6-06: hàng chờ kiểm duyệt tin bị
 * gắn cờ lừa đảo (module safety). Chỉ kiểu + thao tác chỉ-đọc; không lộ domain/infrastructure.
 */

/** Vị trí phân trang hàng chờ tin gắn cờ: mới nhất trước theo (`sentAt`, `messageId`). */
export interface FlaggedMessageCursor {
  readonly sentAt: Date;
  readonly messageId: string;
}

/** Một dòng hàng chờ — **không có nội dung tin** (xem nội dung qua `getFlaggedMessage`, nơi gọi phải ghi audit). */
export interface FlaggedMessageSummary {
  readonly messageId: string;
  readonly conversationId: string;
  readonly matchId: string;
  readonly senderId: string;
  /** Người nhận (participant còn lại của hội thoại). */
  readonly recipientId: string;
  /** Mã luật của bộ lọc lừa đảo (BE-S6-03), vd `BANK_TRANSFER`. */
  readonly reasons: readonly string[];
  readonly sentAt: Date;
}

/** Chi tiết tin gắn cờ — **chứa nội dung chat (PII)**: không log; module gọi phải ghi audit mỗi lần đọc. */
export interface FlaggedMessageDetail extends FlaggedMessageSummary {
  /** Nội dung gốc người gửi nhập. */
  readonly body: string;
  /** Bản hiển thị cho người nhận khi bị che liên hệ (`null` = không che). */
  readonly maskedBody: string | null;
}

export interface FlaggedMessagePage {
  readonly items: readonly FlaggedMessageSummary[];
  /** `null` khi hết dữ liệu. */
  readonly nextCursor: FlaggedMessageCursor | null;
}

export interface MessagingFacade {
  /** Tin bị gắn cờ, mới nhất trước. `limit` do nơi gọi chặn (1…100). */
  listFlaggedMessages(query: {
    readonly cursor: FlaggedMessageCursor | null;
    readonly limit: number;
  }): Promise<FlaggedMessagePage>;
  /** Tin bị gắn cờ theo id; tin không tồn tại / không bị gắn cờ → `null`. */
  getFlaggedMessage(messageId: string): Promise<FlaggedMessageDetail | null>;
}
