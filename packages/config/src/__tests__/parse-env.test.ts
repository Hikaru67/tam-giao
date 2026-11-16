import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  ConfigError,
  envBoolean,
  envLogLevel,
  envPort,
  envPostgresUrl,
  loadEnvOrExit,
  parseEnv,
} from '../index.js';

const schema = z.object({
  DATABASE_URL: envPostgresUrl,
  SECRET_KEY: z.string().min(32),
  API_PORT: envPort.default(3000),
  LOG_LEVEL: envLogLevel.default('info'),
  FLAG: envBoolean.default(false),
});

const valid = {
  DATABASE_URL: 'postgres://u:p@localhost:5433/db',
  SECRET_KEY: 'x'.repeat(32),
};

const problemsOf = (env: Record<string, string | undefined>): readonly string[] => {
  try {
    parseEnv('test', schema, env);
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
    throw error;
  }
  throw new Error('expected ConfigError');
};

describe('parseEnv', () => {
  it('env hợp lệ → áp dụng default và ép kiểu', () => {
    expect(parseEnv('test', schema, { ...valid, API_PORT: '8080', FLAG: 'true' })).toEqual({
      ...valid,
      API_PORT: 8080,
      LOG_LEVEL: 'info',
      FLAG: true,
    });
  });

  it('thiếu biến → liệt kê đủ tên biến thiếu (AC2)', () => {
    expect(problemsOf({})).toEqual([
      'DATABASE_URL: bắt buộc nhưng chưa khai báo',
      'SECRET_KEY: bắt buộc nhưng chưa khai báo',
    ]);
  });

  it('chuỗi rỗng được coi như chưa khai báo', () => {
    expect(problemsOf({ ...valid, DATABASE_URL: '   ' })).toEqual([
      'DATABASE_URL: bắt buộc nhưng chưa khai báo',
    ]);
  });

  it('sai kiểu / sai định dạng / ngoài danh sách', () => {
    const problems = problemsOf({
      ...valid,
      DATABASE_URL: 'mysql://localhost/db',
      API_PORT: '70000',
      LOG_LEVEL: 'verbose',
      FLAG: 'yes',
    });
    expect(problems).toHaveLength(4);
    expect(problems.join('\n')).toMatch(/DATABASE_URL: sai định dạng/);
    expect(problems.join('\n')).toMatch(/API_PORT: ngoài khoảng cho phép/);
    expect(problems.join('\n')).toMatch(/LOG_LEVEL: giá trị không thuộc danh sách/);
    expect(problems.join('\n')).toMatch(/FLAG: giá trị không thuộc danh sách/);
  });

  it('không in giá trị secret trong thông báo lỗi (AC2)', () => {
    const leaked = 'super-secret-but-too-short';
    const dbPassword = 'db-password-123';
    try {
      parseEnv('test', schema, {
        DATABASE_URL: `mysql://admin:${dbPassword}@localhost/db`,
        SECRET_KEY: leaked,
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const message = (error as ConfigError).message;
      expect(message).toMatch(/SECRET_KEY/);
      expect(message).not.toContain(leaked);
      expect(message).not.toContain(dbPassword);
    }
  });

  it('kiểu sai ở mức root được mô tả là invalid_type', () => {
    const problems = (() => {
      try {
        parseEnv('test', z.object({ PORT: z.number() }), { PORT: 'abc' });
      } catch (error) {
        return (error as ConfigError).problems;
      }
      return [];
    })();
    expect(problems).toEqual(['PORT: sai kiểu dữ liệu (cần number)']);
  });

  it('lỗi khác (custom) được mô tả kèm mã lỗi', () => {
    const custom = z.object({ A: z.string() }).refine(() => false, { message: 'x', path: ['A'] });
    try {
      parseEnv('test', custom, { A: 'v' });
      expect.unreachable();
    } catch (error) {
      expect((error as ConfigError).problems).toEqual(['A: không hợp lệ (custom)']);
    }
  });
});

describe('loadEnvOrExit', () => {
  afterEach(() => vi.restoreAllMocks());

  it('cấu hình sai → ghi stderr và thoát mã 1 (AC2)', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exit = vi.fn((code: number): never => {
      throw new Error(`exit:${code}`);
    });
    expect(() => loadEnvOrExit('api', schema, {}, exit)).toThrow('exit:1');
    expect(exit).toHaveBeenCalledWith(1);
    expect(String(stderr.mock.calls[0]?.[0])).toMatch(
      /\[api\] Cấu hình môi trường không hợp lệ[\s\S]*DATABASE_URL/,
    );
  });

  it('cấu hình đúng → trả config, không thoát', () => {
    const exit = vi.fn((): never => {
      throw new Error('should not exit');
    });
    expect(loadEnvOrExit('api', schema, valid, exit).API_PORT).toBe(3000);
    expect(exit).not.toHaveBeenCalled();
  });

  it('lỗi không phải ConfigError được ném lại', () => {
    const broken = z.object({}).transform(() => {
      throw new TypeError('boom');
    });
    expect(() => loadEnvOrExit('api', broken, {})).toThrow(TypeError);
  });
});
