import { describe, expect, it } from 'vitest';
import { CccdNumber } from '../domain/cccd-number.js';

describe('CccdNumber', () => {
  it.each(['001090012345', '096123456789', '079 200 000 001', '079.200.000.001', '079-200-000-001'])(
    'accepts %s',
    (raw) => {
      const result = CccdNumber.parse(raw);
      expect(result.isOk() && result.value.value).toBe(raw.replace(/[\s.-]/g, ''));
    },
  );

  it.each([
    ['empty', ''],
    ['11 digits', '00109001234'],
    ['13 digits', '0010900123456'],
    ['letters', '00109001234A'],
    ['old 9-digit CMND', '123456789'],
    ['province code 000', '000090012345'],
    ['province code above 096', '097090012345'],
  ])('rejects %s', (_label, raw) => {
    const result = CccdNumber.parse(raw);
    expect(result.isErr() && result.error.code).toBe('INVALID_CCCD_NUMBER');
  });

  it('compares by value', () => {
    const a = CccdNumber.parse('001090012345');
    const b = CccdNumber.parse('001 090 012 345');
    expect(a.isOk() && b.isOk() && a.value.equals(b.value)).toBe(true);
  });

  it('masks the number in toString/toJSON so accidental logging does not leak it', () => {
    const result = CccdNumber.parse('001090012345');
    if (result.isErr()) throw new Error('expected Ok');
    const cccd = result.value;
    expect(cccd.masked()).toBe('********2345');
    expect(String(cccd)).toBe('********2345');
    expect(JSON.stringify({ cccd })).toBe('{"cccd":"********2345"}');
  });
});
