import { z } from 'zod';

/**
 * Parse biến môi trường bằng Zod, báo lỗi fail-fast.
 * Thông báo lỗi chỉ liệt kê **tên biến** và lý do — không bao giờ in giá trị (có thể là secret, AGENTS.md mục 5).
 */

export type Env = Readonly<Record<string, string | undefined>>;

export class ConfigError extends Error {
  constructor(
    readonly app: string,
    readonly problems: readonly string[],
  ) {
    super(`[${app}] Cấu hình môi trường không hợp lệ:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

/** Chuỗi rỗng trong .env được coi như chưa khai báo. */
function dropEmpty(env: Env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && value.trim() !== '') out[key] = value;
  }
  return out;
}

function describeIssue(issue: z.core.$ZodIssue, provided: Record<string, string>): string {
  const key = issue.path.map(String).join('.') || '(root)';
  if (issue.path.length > 0 && provided[String(issue.path[0])] === undefined) {
    return `${key}: bắt buộc nhưng chưa khai báo`;
  }
  switch (issue.code) {
    case 'invalid_value':
      return `${key}: giá trị không thuộc danh sách cho phép (${issue.values.map(String).join(', ')})`;
    case 'invalid_format':
      return `${key}: sai định dạng (${issue.format})`;
    case 'too_small':
    case 'too_big':
      return `${key}: ngoài khoảng cho phép`;
    case 'invalid_type':
      return `${key}: sai kiểu dữ liệu (cần ${issue.expected})`;
    default:
      return `${key}: không hợp lệ (${issue.code})`;
  }
}

export function parseEnv<S extends z.ZodType>(app: string, schema: S, env: Env): z.output<S> {
  const provided = dropEmpty(env);
  const result = schema.safeParse(provided);
  if (!result.success) {
    throw new ConfigError(
      app,
      result.error.issues.map((issue) => describeIssue(issue, provided)),
    );
  }
  return result.data;
}

/** Dùng ở entrypoint: cấu hình sai → in lỗi ra stderr và thoát mã 1. */
export function loadEnvOrExit<S extends z.ZodType>(
  app: string,
  schema: S,
  env: Env = process.env,
  exit: (code: number) => never = (code) => process.exit(code),
): z.output<S> {
  try {
    return parseEnv(app, schema, env);
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n`);
      return exit(1);
    }
    throw error;
  }
}

/** Các kiểu biến môi trường hay dùng. */
export const envBoolean = z.enum(['true', 'false']).transform((v) => v === 'true');
export const envPort = z.coerce.number().int().min(1).max(65_535);
export const envNodeEnv = z.enum(['development', 'test', 'production']);
export const envLogLevel = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']);
export const envPostgresUrl = z.url({ protocol: /^postgres(ql)?$/ });
export const envHttpUrl = z.url({ protocol: /^https?$/ });
