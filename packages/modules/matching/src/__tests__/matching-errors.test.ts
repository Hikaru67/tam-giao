import {
  MATCH_AWAITING_RESPONSE,
  MATCH_CLOSED,
  MATCH_CLOSE_OUTCOME_NAMES,
  MATCH_CLOSE_TRIGGER_NAMES,
  MATCH_DECLINED,
  MATCH_EXPIRED,
  MATCH_LOCKED,
  MATCH_MET,
  MATCH_OFFERED,
  MATCH_STARTED_DATING,
  MATCH_STATUS_NAMES,
  errorRegistry,
} from '@tamgiao/contracts';
import { describe, expect, it } from 'vitest';
import { MATCHING_DOMAIN_ERRORS } from '../domain/errors.js';
import { MATCH_EVENT_TYPES } from '../domain/match-events.js';
import { MATCH_CLOSE_OUTCOMES, MATCH_CLOSE_TRIGGERS, MATCH_STATUSES } from '../domain/match.js';

describe('mã lỗi matching (domain)', () => {
  it.each(MATCHING_DOMAIN_ERRORS)('%s đã đăng ký trong contracts bởi matching', (code) => {
    expect(errorRegistry.get(code)?.owner).toBe('matching');
  });

  it('HTTP status theo hợp đồng', () => {
    expect(MATCHING_DOMAIN_ERRORS.map((c) => [c, errorRegistry.statusOf(c)])).toEqual([
      ['INVALID_TRANSITION', 409],
      ['OFFER_EXPIRED', 410],
      ['NOT_PARTICIPANT', 403],
      ['NOT_YET_EXPIRED', 409],
      ['ALREADY_RESPONDED', 409],
    ]);
  });
});

// Domain không được import contracts ngoài `constants` (A1) → giữ bản sao, test này bảo đảm hai nơi khớp nhau.
describe('tên event / enum matching khớp contracts', () => {
  it('event types', () => {
    expect([...MATCH_EVENT_TYPES]).toEqual([
      MATCH_OFFERED,
      MATCH_AWAITING_RESPONSE,
      MATCH_STARTED_DATING,
      MATCH_DECLINED,
      MATCH_EXPIRED,
      MATCH_MET,
      MATCH_CLOSED,
      MATCH_LOCKED,
    ]);
  });

  it('trạng thái, outcome, trigger', () => {
    expect([...MATCH_STATUSES]).toEqual([...MATCH_STATUS_NAMES]);
    expect([...MATCH_CLOSE_OUTCOMES]).toEqual([...MATCH_CLOSE_OUTCOME_NAMES]);
    expect([...MATCH_CLOSE_TRIGGERS]).toEqual([...MATCH_CLOSE_TRIGGER_NAMES]);
  });
});
