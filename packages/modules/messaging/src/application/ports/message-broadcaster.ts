import type { MessageKind, SystemMessageCode } from '../../domain/message.js';

/**
 * Tin nhắn đẩy realtime giữa các instance API (BE-S6-02). Mang **cả** `body` gốc lẫn `maskedBody` để instance nhận tự
 * chọn theo người xem (người gửi thấy `body`, người khác thấy `maskedBody ?? body`). Là PII — chỉ đi qua kênh nội bộ
 * (Redis), không log. Thời gian dạng ISO 8601 UTC để tuần tự hoá JSON.
 */
export interface RealtimeMessage {
  readonly messageId: string;
  readonly conversationId: string;
  /** `null` với tin hệ thống. */
  readonly senderId: string | null;
  readonly kind: MessageKind;
  readonly systemCode: SystemMessageCode | null;
  readonly body: string;
  readonly maskedBody: string | null;
  readonly clientMessageId: string | null;
  /** Chỉ người này nhận (vd `FRAUD_WARNING`); `null` = mọi người trong phòng. */
  readonly visibleTo: string | null;
  readonly sentAt: string;
}

/**
 * Sự kiện realtime của một hội thoại, phát tới mọi instance. `originConnectionId` = kết nối WS phát ra sự kiện (instance
 * giữ kết nối đó không đẩy lại cho chính nó; `null` = không loại trừ ai).
 */
export type ConversationBroadcast =
  | {
      readonly type: 'message.new';
      readonly conversationId: string;
      readonly originConnectionId: string | null;
      readonly message: RealtimeMessage;
    }
  | {
      readonly type: 'message.read';
      readonly conversationId: string;
      readonly originConnectionId: string | null;
      readonly readerId: string;
      readonly messageId: string;
      readonly readAt: string;
    }
  | {
      readonly type: 'typing';
      readonly conversationId: string;
      readonly originConnectionId: string | null;
      readonly userId: string;
      readonly isTyping: boolean;
    };

export type ConversationBroadcastListener = (event: ConversationBroadcast) => void;

/**
 * Pub/sub realtime giữa các instance API (BE-S6-02): adapter Redis ở infrastructure, fake in-memory khi unit test.
 * Phát tới **mọi** instance đang subscribe (kể cả instance phát) — mỗi instance tự lọc theo phòng hội thoại có kết nối
 * cục bộ. Giao nhận "tốt nhất có thể": mất sự kiện thì client lấy bù qua `GET /me/conversations/:id/messages?after=`.
 */
export interface MessageBroadcaster {
  publish(event: ConversationBroadcast): Promise<void>;
  /** Đăng ký nhận sự kiện; trả hàm huỷ đăng ký. Promise resolve khi đã sẵn sàng nhận. */
  subscribe(listener: ConversationBroadcastListener): Promise<() => Promise<void>>;
}
