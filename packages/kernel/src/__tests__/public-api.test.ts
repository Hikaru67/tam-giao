import { describe, expect, it } from 'vitest';
import * as kernel from '../index.js';

describe('@tamgiao/kernel public API', () => {
  it('xuất đúng các building block runtime', () => {
    expect(Object.keys(kernel).sort()).toEqual(
      [
        'AggregateRoot',
        'Entity',
        'Err',
        'FakeClock',
        'Money',
        'Ok',
        'SystemClock',
        'UPLOAD_PURPOSES',
        'addDuration',
        'domainError',
        'durationToMs',
        'err',
        'fail',
        'newId',
        'ok',
        'parseId',
      ].sort(),
    );
  });
});
