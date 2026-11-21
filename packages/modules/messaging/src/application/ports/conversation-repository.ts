import type { Tx } from '@tamgiao/kernel';
import type { Conversation, ConversationId, ConversationMatchId } from '../../domain/conversation.js';

/** Lưu / tải aggregate `Conversation` (`messaging.conversations`). Mọi thao tác chạy trong `tx` của caller (A5). */
export interface ConversationRepository {
  /**
   * Lưu hội thoại mới hoặc thay đổi + ghi event chờ phát vào outbox trong cùng `tx` (A6). Kiểm tra version lạc quan
   * (version trước = version − số event chờ: `0` → INSERT, khác → UPDATE có điều kiện, lệch → throw). Hội thoại thứ
   * hai cho cùng match vi phạm unique `match_id` → throw (handler chạy lại sẽ thấy hội thoại đã có). Không event → no-op.
   */
  save(tx: Tx, conversation: Conversation): Promise<void>;

  findById(tx: Tx, id: ConversationId): Promise<Conversation | null>;

  /** Tải và khoá dòng (`SELECT … FOR UPDATE`): tuần tự hoá gửi tin với đóng hội thoại, đếm rate limit chính xác. */
  findByIdForUpdate(tx: Tx, id: ConversationId): Promise<Conversation | null>;

  /** Hội thoại của match (khoá `FOR UPDATE`) — handler mở/đóng theo event matching. */
  findByMatchIdForUpdate(tx: Tx, matchId: ConversationMatchId): Promise<Conversation | null>;
}
