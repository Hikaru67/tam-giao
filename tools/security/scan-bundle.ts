import { readFile, readdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Quét thư mục build production của FE (admin `dist`, partner `dist`, output `expo export` của mobile)
 * nhằm chặn lộ route `/dev/`, panel thanh toán giả, URL máy dev, `console.log` hoặc secret mẫu trong
 * bundle phát hành (FE-S6-03 AC1, luật F4).
 *
 * Cách chạy trên CI:
 *   `pnpm --filter @tamgiao/tools scan:bundle --env-example ../.env.example ../apps/admin/dist ../apps/partner/dist <expo-export-dir>`
 *   (script chạy trong `tools/`; có phát hiện → exit 1; sai tham số / thư mục rỗng / thiếu file → exit 2).
 *
 * Lưu ý mobile: `expo export` phải truyền `--no-bytecode` khi chạy scanner, vì Hermes bytecode không thể
 * quét chuỗi ký tự trực tiếp.
 *
 * Quy trình thêm ngoại lệ vendor: chỉ thêm vào `VENDOR_ALLOWANCES` kèm `reason` cụ thể (giải thích đúng đoạn
 * mã thư viện bên thứ ba và vì sao an toàn ở production), bắt buộc có review trước khi merge.
 */

export interface BundleRule {
  readonly name: string;
  readonly regex: RegExp;
  readonly description: string;
}

export interface BundleAllowance {
  readonly rule: string;
  readonly regex: RegExp;
  readonly reason: string;
}

export interface BundleFinding {
  readonly file: string;
  readonly rule: string;
  readonly excerpt: string;
}

export interface ScanOptions {
  readonly rules?: readonly BundleRule[];
  readonly allowances?: readonly BundleAllowance[];
  readonly secrets?: readonly string[];
}

export const BUNDLE_RULES: readonly BundleRule[] = [
  {
    name: 'dev-route',
    regex: /\/dev\//,
    description: 'Route dev của BE (ví dụ /dev/payments/fake) không được xuất hiện trong bundle production.',
  },
  {
    name: 'fake-payment-ui',
    // Không bắt tên `devFakePaymentBodySchema`: đó là schema DTO dùng chung của @tamgiao/contracts (không phải UI/route),
    // vẫn có mặt khi app import `@tamgiao/contracts/billing`.
    regex: /dev-fake-pay|thanh toán giả/i,
    description:
      'Nút (testID dev-fake-pay-*) hoặc chuỗi giao diện của panel thanh toán giả chỉ dùng ở môi trường dev.',
  },
  {
    name: 'dev-url',
    regex: /(?:https?|wss?):\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|10\.0\.2\.2)(?::\d+)?/i,
    description: 'URL trỏ về máy dev hoặc emulator không được phép có mặt trong bundle production.',
  },
  {
    name: 'dev-host',
    regex: /(?<![\d.])(?:127\.0\.0\.1|10\.0\.2\.2)(?![\d])/,
    description: 'IP loopback / emulator không kèm scheme vẫn có thể khiến app gọi nhầm máy dev.',
  },
  {
    name: 'console-log',
    regex: /\bconsole\.(?:log|debug|info)\s*\(/,
    description: 'Log dev còn sót trong bundle có nguy cơ lộ PII (console.error/warn được phép cho React).',
  },
  {
    name: 'private-key',
    regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    description: 'Khoá riêng PEM không bao giờ được nhúng vào bundle client.',
  },
  {
    name: 'aws-access-key',
    regex: /\bAKIA[0-9A-Z]{16}\b/,
    description: 'AWS Access Key ID không được phép nằm trong mã client.',
  },
  {
    name: 'jwt',
    regex: /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
    description: 'JWT cứng trong bundle có thể là token thật bị đóng gói nhầm.',
  },
];

export const VENDOR_ALLOWANCES: readonly BundleAllowance[] = [
  {
    rule: 'dev-url',
    regex: /'http:\/\/localhost:8081\/'/,
    reason: 'react-native getDevServer: URL Metro mặc định, chỉ dùng khi dev',
  },
  {
    rule: 'dev-url',
    regex: /window\.origin:`http:\/\/localhost`/,
    reason: 'TanStack Router: base URL giả để parse đường dẫn tương đối',
  },
  {
    rule: 'dev-url',
    regex: /["']http:\/\/localhost:8969\/stream["']/,
    reason:
      '@sentry/react-native: URL sidecar mặc định của Spotlight (công cụ debug local), app không bật spotlightIntegration (FE-S6-04)',
  },
];

export const SCANNED_EXTENSIONS: readonly string[] = [
  '.js',
  '.mjs',
  '.cjs',
  '.html',
  '.css',
  '.json',
  '.webmanifest',
  '.txt',
  '.map',
];

const SECRET_RULES = new Set(['private-key', 'aws-access-key', 'jwt', 'env-example-secret']);

/** Giải mã escape JS (\u{X...}, \uXXXX, \xXX) để bắt chuỗi tiếng Việt bị terser ascii_only escape. */
export function decodeJsEscapes(text: string): string {
  return text.replace(
    /\\u\{([0-9a-fA-F]{1,6})\}|\\u([0-9a-fA-F]{4})|\\x([0-9a-fA-F]{2})/g,
    (match, uBrace?: string, uFour?: string, xTwo?: string): string => {
      const hex = uBrace ?? uFour ?? xTwo;
      if (!hex) return match;
      const codePoint = Number.parseInt(hex, 16);
      if (codePoint > 0x10ffff) return match;
      return String.fromCodePoint(codePoint);
    },
  );
}

/**
 * Trích các giá trị secret mẫu từ `.env.example` để kiểm tra không lọt vào bundle client.
 * Chỉ giữ biến có tên nhạy cảm và giá trị >= 12 ký tự nhằm tránh báo nhầm chuỗi ngắn phổ thông.
 */
export function parseEnvExampleSecrets(text: string): string[] {
  const secrets: string[] = [];
  const seen = new Set<string>();

  for (const rawLine of text.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) continue;
    if (!/(?:SECRET|PASSWORD|TOKEN|KEY|DATABASE_URL|REDIS_URL)/.test(key)) continue;

    let value = trimmed.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }

    if (value.length >= 12 && !seen.has(value)) {
      seen.add(value);
      secrets.push(value);
    }
  }

  return secrets;
}

function toGlobalRegex(regex: RegExp): RegExp {
  const flags = regex.flags.includes('g') ? regex.flags : `${regex.flags}g`;
  return new RegExp(regex.source, flags);
}

function formatExcerpt(decoded: string, ruleName: string, matchStart: number, matchText: string): string {
  if (SECRET_RULES.has(ruleName)) {
    return `${matchText.slice(0, 4)}***`;
  }
  const start = Math.max(0, matchStart - 40);
  const end = Math.min(decoded.length, matchStart + matchText.length + 40);
  return decoded.slice(start, end).replace(/\s+/g, ' ').trim();
}

/** Quét nội dung một file bundle sau khi giải mã escape JS; áp dụng ngoại lệ đúng theo rule và khoảng khớp. */
export function scanContent(file: string, content: string, options?: ScanOptions): BundleFinding[] {
  const decoded = decodeJsEscapes(content);
  const rules = options?.rules ?? BUNDLE_RULES;
  const allowances = options?.allowances ?? VENDOR_ALLOWANCES;
  const secrets = options?.secrets ?? [];

  const allowanceRangesByRule = new Map<string, Array<readonly [number, number]>>();
  for (const allowance of allowances) {
    const ranges = allowanceRangesByRule.get(allowance.rule) ?? [];
    for (const match of decoded.matchAll(toGlobalRegex(allowance.regex))) {
      ranges.push([match.index, match.index + match[0].length]);
    }
    allowanceRangesByRule.set(allowance.rule, ranges);
  }

  const findings: BundleFinding[] = [];

  for (const rule of rules) {
    const ruleAllowRanges = allowanceRangesByRule.get(rule.name) ?? [];
    for (const match of decoded.matchAll(toGlobalRegex(rule.regex))) {
      const matchText = match[0];
      const matchStart = match.index;
      const matchEnd = matchStart + matchText.length;
      const isAllowed = ruleAllowRanges.some(
        ([allowStart, allowEnd]) => matchStart >= allowStart && matchEnd <= allowEnd,
      );
      if (!isAllowed) {
        findings.push({
          file,
          rule: rule.name,
          excerpt: formatExcerpt(decoded, rule.name, matchStart, matchText),
        });
      }
    }
  }

  const envSecretAllowRanges = allowanceRangesByRule.get('env-example-secret') ?? [];
  for (const secret of secrets) {
    if (!secret) continue;
    let searchFrom = 0;
    while (searchFrom <= decoded.length) {
      const matchStart = decoded.indexOf(secret, searchFrom);
      if (matchStart === -1) break;
      const matchEnd = matchStart + secret.length;
      const isAllowed = envSecretAllowRanges.some(
        ([allowStart, allowEnd]) => matchStart >= allowStart && matchEnd <= allowEnd,
      );
      if (!isAllowed) {
        findings.push({
          file,
          rule: 'env-example-secret',
          excerpt: `${secret.slice(0, 4)}***`,
        });
      }
      searchFrom = matchEnd;
    }
  }

  return findings;
}

/** Duyệt đệ quy thư mục build và trả danh sách file có phần mở rộng nằm trong `SCANNED_EXTENSIONS`, đã sort. */
export async function listScannableFiles(dir: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(currentDir: string): Promise<void> {
    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && SCANNED_EXTENSIONS.includes(extname(entry.name).toLowerCase())) {
        results.push(fullPath);
      }
    }
  }

  await walk(dir);
  results.sort();
  return results;
}

const USAGE = 'Usage: scan-bundle [--env-example <file>] <dir...>\n';

/** CLI quét các thư mục build: 0 nếu sạch, 1 nếu có phát hiện, 2 nếu thiếu tham số / lỗi đọc / thư mục rỗng. */
export async function main(argv: readonly string[]): Promise<number> {
  let envExamplePath: string | undefined;
  const dirs: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === '--env-example') {
      const next = argv[i + 1];
      if (!next) {
        process.stderr.write(USAGE);
        return 2;
      }
      envExamplePath = next;
      i++;
    } else if (arg.startsWith('--env-example=')) {
      const value = arg.slice('--env-example='.length);
      if (!value) {
        process.stderr.write(USAGE);
        return 2;
      }
      envExamplePath = value;
    } else {
      dirs.push(arg);
    }
  }

  if (dirs.length === 0) {
    process.stderr.write(USAGE);
    return 2;
  }

  let secrets: string[] = [];
  if (envExamplePath !== undefined) {
    try {
      const envText = await readFile(envExamplePath, 'utf8');
      secrets = parseEnvExampleSecrets(envText);
    } catch (error) {
      process.stderr.write(
        `Error reading ${envExamplePath}: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      return 2;
    }
  }

  const allFiles: string[] = [];
  for (const dir of dirs) {
    let files: string[];
    try {
      files = await listScannableFiles(dir);
    } catch (error) {
      process.stderr.write(
        `Error scanning ${dir}: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      return 2;
    }

    if (files.length === 0) {
      process.stderr.write(`No scannable files in ${dir}\n`);
      return 2;
    }

    allFiles.push(...files);
  }

  const allFindings: BundleFinding[] = [];
  const dirtyFiles = new Set<string>();

  for (const file of allFiles) {
    let content: string;
    try {
      content = await readFile(file, 'utf8');
    } catch (error) {
      process.stderr.write(
        `Error reading ${file}: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      return 2;
    }

    const findings = scanContent(file, content, { secrets });
    if (findings.length > 0) {
      dirtyFiles.add(file);
      allFindings.push(...findings);
    }
  }

  for (const finding of allFindings) {
    process.stdout.write(`${finding.file} [${finding.rule}] ${finding.excerpt}\n`);
  }

  if (allFindings.length > 0) {
    process.stdout.write(
      `Bundle scan failed: ${allFindings.length} issue(s) in ${dirtyFiles.size} file(s).\n`,
    );
    return 1;
  }

  process.stdout.write(`Bundle scan passed: ${allFiles.length} file(s) clean.\n`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = await main(process.argv.slice(2));
}
