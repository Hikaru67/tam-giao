import { z } from 'zod';
import { conversationMessageSchema, messageBodyInputSchema } from './dto.js';

/**
 * Giao thức WebSocket chat (BE-S6-02). Endpoint `GET /ws` (upgrade).
 *
 * **Xác thực (handshake):** access token của người dùng app qua header `Authorization: Bearer <token>`; client không
 * đặt được header (trình duyệt) thì dùng query `?access_token=<token>`. Server nhận upgrade rồi mới xác thực: thiếu /
 * sai / hết hạn token → frame `error` + đóng kết nối với mã `WS_CLOSE_CODES` (lý do = mã lỗi). Thành công → frame
 * `ready`. Token còn được kiểm tra lại mỗi nhịp heartbeat (hết hạn / phiên bị thu hồi → đóng `4401`); client làm mới
 * token (`/auth/refresh`) rồi nối lại.
 *
 * **Frame:** mỗi frame là một JSON text, phân loại theo `type`.
 * - Client → server: `conversation.join`, `conversation.leave`, `message.send`, `message.read`, `typing`, `ping`.
 * - Server → client: `ready`, `conversation.joined`, `message.ack`, `message.new`, `message.read`, `typing`, `pong`,
 *   `error`.
 *
 * **Phòng:** `conversation.join` kiểm tra người dùng thuộc hội thoại; không thuộc / không tồn tại / id sai → `error` +
 * đóng `4403`. Chỉ nhận `message.new`/`message.read`/`typing` của phòng đã join.
 *
 * **Gửi tin + ack + idempotency:** `message.send` kèm `clientMessageId` (UUID do client sinh, giữ nguyên khi gửi lại).
 * Thành công → `message.ack` (cùng `clientMessageId`, `duplicate: true` nếu là lần gửi lại của tin đã lưu — không tạo tin
 * trùng). Lỗi nghiệp vụ (`CONVERSATION_CLOSED`, `RATE_LIMITED`, `MESSAGE_EMPTY`, `MESSAGE_TOO_LONG`…) → `error` kèm
 * `clientMessageId`, kết nối giữ nguyên; `NOT_PARTICIPANT`/`NOT_FOUND` → đóng `4403`. Không nhận được ack (mất mạng) →
 * gửi lại cùng `clientMessageId`.
 *
 * **Heartbeat:** server gửi ping frame giao thức mỗi `WS_HEARTBEAT_INTERVAL_SECONDS` (client WebSocket chuẩn tự trả
 * pong); client cũng có thể gửi `{"type":"ping"}` để nhận `pong`. Không nhận được gì từ client trong
 * `WS_HEARTBEAT_TIMEOUT_SECONDS` → đóng `4408`.
 *
 * **Nối lại:** sau khi nối lại + join, gọi `GET /me/conversations/:id/messages?after=<messageId cuối đã có>` lấy tin bị
 * lỡ. Client khử trùng theo `messageId` (sự kiện realtime giao "ít nhất một lần" khi client gửi lại).
 */

/** Nhịp server gửi ping + kiểm tra lại access token. */
export const WS_HEARTBEAT_INTERVAL_SECONDS = 25;
/** Không nhận frame/pong nào trong khoảng này → server đóng kết nối (`HEARTBEAT_TIMEOUT`). */
export const WS_HEARTBEAT_TIMEOUT_SECONDS = 60;
/** Kích thước tối đa một frame client gửi lên (byte). */
export const WS_MAX_FRAME_BYTES = 16_384;

/**
 * Mã đóng kết nối (RFC 6455 dải 4000–4999 dành cho ứng dụng); `reason` của close frame = mã lỗi (vd `TOKEN_EXPIRED`).
 */
export const WS_CLOSE_CODES = {
  /** Thiếu / sai token (`UNAUTHENTICATED`) hoặc token hết hạn (`TOKEN_EXPIRED`). */
  UNAUTHENTICATED: 4401,
  TOKEN_EXPIRED: 4401,
  /** Không thuộc hội thoại (`NOT_PARTICIPANT`), hội thoại không tồn tại (`NOT_FOUND`), id sai (`INVALID_ID`). */
  NOT_PARTICIPANT: 4403,
  NOT_FOUND: 4403,
  INVALID_ID: 4403,
  /** Quá `WS_HEARTBEAT_TIMEOUT_SECONDS` không nhận được gì từ client. */
  HEARTBEAT_TIMEOUT: 4408,
} as const;
export type WsCloseReason = keyof typeof WS_CLOSE_CODES;

// ——— Client → server ———

const conversationIdField = z.uuid();

export const wsClientEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('conversation.join'), conversationId: conversationIdField }),
  z.object({ type: z.literal('conversation.leave'), conversationId: conversationIdField }),
  z.object({
    type: z.literal('message.send'),
    conversationId: conversationIdField,
    /** Idempotency key (UUID, client sinh một lần cho mỗi tin, giữ nguyên khi gửi lại). */
    clientMessageId: z.uuid(),
    body: messageBodyInputSchema,
  }),
  z.object({
    type: z.literal('message.read'),
    conversationId: conversationIdField,
    /**
     * Tin mới nhất người dùng đã đọc. BE-S6-04: được **lưu** như `POST /me/conversations/:id/read` (con trỏ chỉ tiến);
     * tin không thuộc hội thoại → frame `error` `NOT_FOUND` (giữ kết nối). Chỉ phát `message.read` cho phòng khi con trỏ
     * thật sự tiến.
     */
    messageId: z.uuid(),
  }),
  z.object({ type: z.literal('typing'), conversationId: conversationIdField, isTyping: z.boolean() }),
  z.object({ type: z.literal('ping') }),
]);
export type WsClientEvent = z.infer<typeof wsClientEventSchema>;

// ——— Server → client ———

export const wsServerEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready'), userId: z.uuid() }),
  z.object({
    type: z.literal('conversation.joined'),
    conversationId: z.uuid(),
    status: z.enum(['OPEN', 'CLOSED']),
  }),
  z.object({
    type: z.literal('message.ack'),
    clientMessageId: z.uuid(),
    /** `true` = lần gửi lại của tin đã lưu trước đó (không tạo tin mới). */
    duplicate: z.boolean(),
    message: conversationMessageSchema,
  }),
  /** Tin mới trong phòng đã join (từ người kia, hoặc từ thiết bị khác của chính mình). */
  z.object({ type: z.literal('message.new'), message: conversationMessageSchema }),
  z.object({
    type: z.literal('message.read'),
    conversationId: z.uuid(),
    readerId: z.uuid(),
    messageId: z.uuid(),
    readAt: z.iso.datetime(),
  }),
  z.object({ type: z.literal('typing'), conversationId: z.uuid(), userId: z.uuid(), isTyping: z.boolean() }),
  z.object({ type: z.literal('pong') }),
  z.object({
    type: z.literal('error'),
    /** Mã lỗi trong registry (`errorRegistry`). */
    code: z.string(),
    /** Có khi lỗi thuộc một `message.send`. */
    clientMessageId: z.uuid().optional(),
    conversationId: z.uuid().optional(),
    /** Chi tiết không nhạy cảm (vd `maxLength`), như `meta` của Problem JSON. */
    meta: z.record(z.string(), z.unknown()).optional(),
  }),
]);
export type WsServerEvent = z.infer<typeof wsServerEventSchema>;
