import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

/**
 * Quét log của lượt chạy test tìm PII lọt ra (AGENTS.md mục 5, BE-S7-07). CI ghi log `pnpm test` / `pnpm test:int`
 * rồi chạy `pnpm --filter @tamgiao/tools scan:pii <log...>`; có phát hiện → exit 1. Output luôn che giá trị.
 * Thêm ngoại lệ tạm thời qua `PII_SCAN_ALLOW` (regex, cách nhau bởi dấu phẩy).
 */

export interface PiiPattern {
  readonly name: string;
  readonly regex: RegExp;
}

export interface PiiFinding {
  readonly file: string;
  readonly line: number;
  readonly pattern: string;
  readonly excerpt: string;
}

/** Mẫu PII mặc định. */
export const PII_PATTERNS: readonly PiiPattern[] = [
  {
    name: 'vn-phone',
    regex: /(?<!\d)(?:(?:\+84|84|0)[35789]\d{8})(?!\d)/,
  },
  {
    name: 'cccd',
    regex: /(?<!\d)0\d{11}(?!\d)/,
  },
  {
    name: 'bearer-token',
    regex: /Bearer\s+[A-Za-z0-9._~+/=-]{16,}/,
  },
  {
    name: 'jwt',
    regex: /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
  },
  {
    name: 'email',
    regex: /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?![A-Za-z0-9.-])/,
  },
  {
    name: 'otp-in-log',
    regex: /(?:otp|code|mã)["':= ]+\d{6}(?!\d)/i,
  },
];

/** Các mẫu được phép xuất hiện trong log test (ví dụ số điện thoại smoke test, email mẫu). */
export const DEFAULT_ALLOW_PATTERNS: readonly RegExp[] = [
  /@(?:example\.com|example\.vn|test)(?!\w)/i,
  /(?<!\d)0900000000(?!\d)/,
];

/** Che giá trị PII: chỉ giữ 2 ký tự đầu + '***'. */
function maskPii(value: string): string {
  return `${value.slice(0, 2)}***`;
}

/** Quét nội dung text; trả các vị trí khớp. `excerpt` đã CHE giá trị (chỉ giữ 2 ký tự đầu + '***'), không in PII ra. */
export function scanText(
  file: string,
  text: string,
  patterns: readonly PiiPattern[] = PII_PATTERNS,
  allow: readonly RegExp[] = DEFAULT_ALLOW_PATTERNS,
): PiiFinding[] {
  const findings: PiiFinding[] = [];
  const lines = text.split(/\r?\n/);

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex] ?? '';
    const lineNumber = lineIndex + 1;

    for (const pattern of patterns) {
      const flags = pattern.regex.flags.includes('g') ? pattern.regex.flags : `${pattern.regex.flags}g`;
      const globalRegex = new RegExp(pattern.regex.source, flags);

      for (const match of line.matchAll(globalRegex)) {
        const matchedText = match[0];
        const isAllowed = allow.some((re) => {
          const testRegex = re.global ? new RegExp(re.source, re.flags.replace('g', '')) : re;
          return testRegex.test(matchedText);
        });

        if (!isAllowed) {
          findings.push({
            file,
            line: lineNumber,
            pattern: pattern.name,
            excerpt: maskPii(matchedText),
          });
        }
      }
    }
  }

  return findings;
}

/** CLI: `node --import tsx tools/security/scan-pii.ts <file...>`; exit 1 nếu có phát hiện, 0 nếu sạch, 2 nếu thiếu tham số / không đọc được file. */
export async function main(argv: readonly string[]): Promise<number> {
  if (argv.length === 0) {
    process.stderr.write('Usage: scan-pii <file...>\n');
    return 2;
  }

  const envAllow = process.env['PII_SCAN_ALLOW'];
  const customAllow: RegExp[] = [];
  if (envAllow) {
    for (const raw of envAllow.split(',')) {
      const trimmed = raw.trim();
      if (trimmed) {
        customAllow.push(new RegExp(trimmed));
      }
    }
  }
  const allow = [...DEFAULT_ALLOW_PATTERNS, ...customAllow];

  const allFindings: PiiFinding[] = [];

  for (const file of argv) {
    let content: string;
    try {
      content = await readFile(file, 'utf8');
    } catch (error) {
      process.stderr.write(
        `Error reading ${file}: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      return 2;
    }

    const findings = scanText(file, content, PII_PATTERNS, allow);
    allFindings.push(...findings);
  }

  for (const finding of allFindings) {
    process.stdout.write(`${finding.file}:${finding.line} [${finding.pattern}] ${finding.excerpt}\n`);
  }

  if (allFindings.length > 0) {
    process.stdout.write(
      `PII scan failed: found ${allFindings.length} issue(s) across ${argv.length} file(s).\n`,
    );
    return 1;
  }

  process.stdout.write(`PII scan passed: ${argv.length} file(s) clean, no PII found.\n`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = await main(process.argv.slice(2));
}
