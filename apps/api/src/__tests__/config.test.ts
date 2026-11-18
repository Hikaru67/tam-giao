import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigError } from '@tamgiao/config';
import { describe, expect, it } from 'vitest';
import { parseApiConfig } from '../config.js';

/** Đọc .env.example ở root để chắc chắn file mẫu luôn đủ biến cho api. */
function envExample(): Record<string, string> {
  const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../.env.example');
  return Object.fromEntries(
    readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '' && !line.trim().startsWith('#'))
      .map((line) => {
        const i = line.indexOf('=');
        return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
      }),
  );
}

describe('api config', () => {
  it('.env.example hợp lệ và map đúng cấu trúc', () => {
    expect(parseApiConfig(envExample())).toEqual({
      nodeEnv: 'development',
      logLevel: 'info',
      port: 3000,
      http: { corsOrigins: [], bodyLimitBytes: 1_048_576, trustProxy: false },
      database: { url: 'postgres://tamgiao@localhost:5433/tamgiao' },
      storage: {
        endpoint: 'http://localhost:8333',
        region: 'us-east-1',
        accessKeyId: 'tamgiao',
        secretAccessKey: 'tamgiao-local-secret',
        forcePathStyle: true,
        buckets: { publicProfile: 'public-profile', privateKyc: 'private-kyc' },
      },
      crypto: {
        masterKeys: `1:${Buffer.from('tamgiao-local-dev-master-key-001').toString('base64')}`,
        masterKeyVersion: 1,
        blindIndexKey: Buffer.from('tamgiao-local-dev-blind-index-01'),
      },
      auth: { secret: Buffer.from('tamgiao-local-dev-auth-secret-01') },
      sms: { provider: 'console' },
    });
  });

  it('thiếu biến bắt buộc → ConfigError liệt kê đủ', () => {
    try {
      parseApiConfig({});
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).problems.map((p) => p.split(':')[0])).toEqual([
        'DATABASE_URL',
        'S3_ENDPOINT',
        'S3_ACCESS_KEY_ID',
        'S3_SECRET_ACCESS_KEY',
        'DATA_MASTER_KEYS',
        'BLIND_INDEX_KEY',
        'AUTH_SECRET',
      ]);
    }
  });

  it('khoá quá ngắn hoặc SMS console ở production → ConfigError, không in giá trị', () => {
    const base = envExample();
    for (const [override, variable] of [
      [{ AUTH_SECRET: Buffer.from('short').toString('base64') }, 'AUTH_SECRET'],
      [{ NODE_ENV: 'production' }, 'SMS_PROVIDER'],
    ] as const) {
      try {
        parseApiConfig({ ...base, ...override });
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigError);
        expect((error as ConfigError).problems.map((p) => p.split(':')[0])).toEqual([variable]);
        expect((error as ConfigError).message).not.toContain(base.AUTH_SECRET);
      }
    }
  });
});
