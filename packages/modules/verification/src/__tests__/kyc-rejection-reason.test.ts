import { describe, expect, it } from 'vitest';
import {
  REJECTION_NOTE_MAX_LENGTH,
  REJECTION_REASON_CODES,
  RejectionReason,
} from '../domain/rejection-reason.js';

describe('RejectionReason', () => {
  it.each(REJECTION_REASON_CODES.filter((c) => c !== 'OTHER'))('accepts %s without a note', (code) => {
    const result = RejectionReason.create({ code });
    expect(result.isOk() && { code: result.value.code, note: result.value.note }).toEqual({
      code,
      note: null,
    });
  });

  it('trims the note and keeps it', () => {
    const result = RejectionReason.create({ code: 'INFO_MISMATCH', note: '  Họ tên lệch  ' });
    expect(result.isOk() && result.value.note).toBe('Họ tên lệch');
  });

  it.each([
    ['missing code', { code: undefined }],
    ['null code', { code: null }],
    ['empty code', { code: '  ' }],
    ['unknown code', { code: 'BECAUSE' }],
  ])('rejects %s with REJECTION_REASON_REQUIRED (field=code)', (_label, input) => {
    const result = RejectionReason.create(input);
    expect(result.isErr() && result.error).toEqual({
      code: 'REJECTION_REASON_REQUIRED',
      details: { field: 'code' },
    });
  });

  it.each([null, '', '   '])('OTHER requires a note (note=%j)', (note) => {
    const result = RejectionReason.create({ code: 'OTHER', note });
    expect(result.isErr() && result.error).toEqual({
      code: 'REJECTION_REASON_REQUIRED',
      details: { field: 'note' },
    });
  });

  it('rejects a note longer than the max length', () => {
    const result = RejectionReason.create({ code: 'OTHER', note: 'x'.repeat(REJECTION_NOTE_MAX_LENGTH + 1) });
    expect(result.isErr() && result.error.code).toBe('REJECTION_REASON_REQUIRED');
    const atLimit = RejectionReason.create({ code: 'OTHER', note: 'x'.repeat(REJECTION_NOTE_MAX_LENGTH) });
    expect(atLimit.isOk()).toBe(true);
  });
});
