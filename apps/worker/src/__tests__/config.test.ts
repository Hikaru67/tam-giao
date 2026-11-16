import { ConfigError } from '@tamgiao/config';
import { describe, expect, it } from 'vitest';
import { parseWorkerConfig } from '../config.js';

describe('worker config', () => {
  it('env hợp lệ → map đúng cấu trúc', () => {
    expect(
      parseWorkerConfig({
        DATABASE_URL: 'postgres://tamgiao:tamgiao@localhost:5433/tamgiao',
        NODE_ENV: 'test',
      }),
    ).toEqual({
      nodeEnv: 'test',
      logLevel: 'info',
      database: { url: 'postgres://tamgiao:tamgiao@localhost:5433/tamgiao' },
    });
  });

  it('thiếu DATABASE_URL → ConfigError', () => {
    expect(() => parseWorkerConfig({})).toThrow(ConfigError);
  });
});
