import { describe, it, expect } from 'vitest';
import type { ConversationMessageDto } from '@tamgiao/contracts/messaging';
import { mergeMessages } from './message-list.js';

describe('mergeMessages', () => {
  const conversationId = '01890a5d-ac96-774b-bcce-b302099a8010';
  const senderId = '01890a5d-ac96-774b-bcce-b302099a8001';

  function createMockMessage(
    idNumber: number,
    body: string,
    overrides: Partial<ConversationMessageDto> = {},
  ): ConversationMessageDto {
    const padded = String(idNumber).padStart(4, '0');
    return {
      messageId: `01890a5d-ac96-774b-bcce-b302099a${padded}`,
      conversationId,
      senderId,
      kind: 'TEXT',
      systemCode: null,
      body,
      masked: false,
      clientMessageId: `01890a5d-ac96-774b-bcce-c302099a${padded}`,
      sentAt: `2026-11-24T10:00:${String(idNumber % 60).padStart(2, '0')}.000Z`,
      ...overrides,
    };
  }

  it('incoming rỗng trả lại đúng tham chiếu existing', () => {
    const existing = [createMockMessage(1, 'Tin 1')];
    const result = mergeMessages(existing, []);
    expect(result).toBe(existing);
  });

  it('incoming chỉ chứa các tin đã có trong existing với cùng tham chiếu → trả lại đúng tham chiếu existing', () => {
    const msg1 = createMockMessage(1, 'Tin 1');
    const msg2 = createMockMessage(2, 'Tin 2');
    const existing = [msg1, msg2];

    const result = mergeMessages(existing, [msg1]);
    expect(result).toBe(existing);
  });

  it('khử trùng theo messageId: bản incoming thay thế bản cũ', () => {
    const msg1Old = createMockMessage(1, 'Nội dung cũ', { masked: false });
    const msg1New = createMockMessage(1, 'Nội dung mới', { masked: true });
    const msg2 = createMockMessage(2, 'Tin 2');

    const existing = [msg1Old, msg2];
    const incoming = [msg1New];

    const result = mergeMessages(existing, incoming);
    expect(result).not.toBe(existing);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(msg1New);
    expect(result[0]?.body).toBe('Nội dung mới');
    expect(result[0]?.masked).toBe(true);
    expect(result[1]).toEqual(msg2);
  });

  it('sắp xếp tăng dần theo messageId (UUID v7 theo thứ tự thời gian)', () => {
    const msg1 = createMockMessage(1, 'Tin 1');
    const msg2 = createMockMessage(2, 'Tin 2');
    const msg3 = createMockMessage(3, 'Tin 3');

    // Truyền vào không theo thứ tự
    const existing = [msg3, msg1];
    const incoming = [msg2];

    const result = mergeMessages(existing, incoming);
    expect(result.map((m) => m.messageId)).toEqual([msg1.messageId, msg2.messageId, msg3.messageId]);
  });

  it('không làm thay đổi (không mutate) mảng existing hay incoming', () => {
    const msg1 = createMockMessage(1, 'Tin 1');
    const msg2 = createMockMessage(2, 'Tin 2');
    const existing = Object.freeze([msg1]);
    const incoming = Object.freeze([msg2]);

    expect(() => mergeMessages(existing, incoming)).not.toThrow();
  });

  it('AC2: kết hợp tin từ realtime và phân trang lịch sử REST không bị nhân đôi', () => {
    // 1. Khởi tạo với 2 tin từ REST ban đầu
    const restMsg1 = createMockMessage(1, 'Tin lịch sử 1');
    const restMsg2 = createMockMessage(2, 'Tin lịch sử 2');
    let messages = mergeMessages([], [restMsg1, restMsg2]);
    expect(messages).toHaveLength(2);

    // 2. Nhận thêm 1 tin qua WebSocket realtime
    const wsMsg3 = createMockMessage(3, 'Tin realtime 3');
    messages = mergeMessages(messages, [wsMsg3]);
    expect(messages).toHaveLength(3);

    // 3. Tải phân trang tiếp theo từ REST (chứa lại tin 2 và tin 3 do con trỏ)
    const restPage2 = [restMsg2, wsMsg3, createMockMessage(4, 'Tin mới 4')];
    messages = mergeMessages(messages, restPage2);

    // 4. Kiểm tra không bị trùng lặp và giữ đúng thứ tự 1, 2, 3, 4
    expect(messages).toHaveLength(4);
    expect(messages.map((m) => m.messageId)).toEqual([
      createMockMessage(1, '').messageId,
      createMockMessage(2, '').messageId,
      createMockMessage(3, '').messageId,
      createMockMessage(4, '').messageId,
    ]);
  });
});
