import type { ConversationMessageDto } from '@tamgiao/contracts/messaging';

/**
 * Trộn danh sách tin nhắn hiện có với tin mới (từ realtime hoặc lịch sử REST).
 * - Khử trùng theo messageId (bản incoming thay bản cũ).
 * - Sắp xếp tăng dần theo messageId (UUID v7 có thứ tự thời gian tự nhiên).
 * - Không làm thay đổi mảng đầu vào (không mutate).
 * - Không có gì thay đổi → trả lại đúng tham chiếu existing.
 */
export function mergeMessages(
  existing: readonly ConversationMessageDto[],
  incoming: readonly ConversationMessageDto[],
): readonly ConversationMessageDto[] {
  if (incoming.length === 0) {
    return existing;
  }

  const existingMap = new Map<string, ConversationMessageDto>();
  for (const msg of existing) {
    existingMap.set(msg.messageId, msg);
  }

  // Kiểm tra xem incoming có mang lại thay đổi nào không (tin mới hoặc bản cập nhật)
  let hasChanges = false;
  for (const msg of incoming) {
    const current = existingMap.get(msg.messageId);
    if (current === undefined || current !== msg) {
      hasChanges = true;
      break;
    }
  }

  if (!hasChanges) {
    return existing;
  }

  const mergedMap = new Map<string, ConversationMessageDto>(existingMap);
  for (const msg of incoming) {
    mergedMap.set(msg.messageId, msg);
  }

  const result = Array.from(mergedMap.values());
  result.sort((a, b) => (a.messageId < b.messageId ? -1 : a.messageId > b.messageId ? 1 : 0));

  return result;
}
