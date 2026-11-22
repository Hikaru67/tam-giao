import {
  CONVERSATION_CLOSED,
  CONVERSATION_CLOSE_REASON_NAMES,
  CONVERSATION_OPENED,
  CONVERSATION_STATUS_NAMES,
  MESSAGE_FLAGGED,
  MESSAGE_KIND_NAMES,
  MESSAGE_SENT,
  SYSTEM_MESSAGE_CODE_NAMES,
  errorRegistry,
} from '@tamgiao/contracts';
import { describe, expect, it } from 'vitest';
import { CONVERSATION_CLOSE_REASONS, CONVERSATION_STATUSES } from '../domain/conversation.js';
import {
  MESSAGING_DOMAIN_ERRORS,
  MESSAGING_GATEWAY_ERRORS,
  MESSAGING_REUSED_ERRORS,
} from '../domain/errors.js';
import { MESSAGE_KINDS, SYSTEM_MESSAGE_CODES } from '../domain/message.js';
import { MESSAGING_EVENT_TYPES } from '../domain/messaging-events.js';

describe('mã lỗi messaging', () => {
  it.each([...MESSAGING_DOMAIN_ERRORS, ...MESSAGING_GATEWAY_ERRORS])(
    '%s đã đăng ký trong contracts bởi messaging',
    (code) => {
      expect(errorRegistry.get(code)?.owner).toBe('messaging');
    },
  );

  it('HTTP status theo hợp đồng (kể cả mã dùng lại của module khác)', () => {
    const all = [...MESSAGING_DOMAIN_ERRORS, ...MESSAGING_GATEWAY_ERRORS, ...MESSAGING_REUSED_ERRORS];
    expect(all.map((c) => [c, errorRegistry.get(c)?.owner, errorRegistry.statusOf(c)])).toEqual([
      ['CONVERSATION_CLOSED', 'messaging', 409],
      ['MESSAGE_EMPTY', 'messaging', 422],
      ['MESSAGE_TOO_LONG', 'messaging', 422],
      ['CLIENT_MESSAGE_ID_CONFLICT', 'messaging', 409],
      ['CONVERSATION_NOT_JOINED', 'messaging', 409],
      ['NOT_PARTICIPANT', 'matching', 403],
      ['RATE_LIMITED', 'common', 429],
      ['NOT_FOUND', 'common', 404],
      ['INVALID_ID', 'common', 400],
    ]);
  });
});

// Domain không được import contracts ngoài `constants` (A1) → giữ bản sao, test này bảo đảm hai nơi khớp nhau.
describe('tên event / enum messaging khớp contracts', () => {
  it('event types', () => {
    expect([...MESSAGING_EVENT_TYPES]).toEqual([
      CONVERSATION_OPENED,
      CONVERSATION_CLOSED,
      MESSAGE_SENT,
      MESSAGE_FLAGGED,
    ]);
  });

  it('trạng thái, lý do đóng, loại tin, mã tin hệ thống', () => {
    expect([...CONVERSATION_STATUSES]).toEqual([...CONVERSATION_STATUS_NAMES]);
    expect([...CONVERSATION_CLOSE_REASONS]).toEqual([...CONVERSATION_CLOSE_REASON_NAMES]);
    expect([...MESSAGE_KINDS]).toEqual([...MESSAGE_KIND_NAMES]);
    expect([...SYSTEM_MESSAGE_CODES]).toEqual([...SYSTEM_MESSAGE_CODE_NAMES]);
  });
});
