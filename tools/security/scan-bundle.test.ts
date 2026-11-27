import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeJsEscapes, main, parseEnvExampleSecrets, scanContent } from './scan-bundle.js';

/**
 * Giá trị nhạy cảm giả dựng lúc runtime (ghép chuỗi) để tránh secret scanner bắt nhầm mã nguồn test.
 */
const b64url = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url');
const FAKE_PEM_HEADER = ['-----BEGIN ', 'RSA ', 'PRIVATE KEY-----'].join('');
const FAKE_AWS_KEY = ['AKIA', 'IOSFODNN7', 'EXAMPLE'].join('');
const FAKE_JWT = [b64url({ alg: 'HS256', typ: 'JWT' }), b64url({ sub: 'bundle-test' }), 'y'.repeat(24)].join(
  '.',
);
const FAKE_SECRET_A = ['tamgiao', 'runtime', 'secret', 'alpha'].join('-');
const FAKE_SECRET_B = ['tamgiao', 'runtime', 'webhook', 'beta'].join('-');
const FAKE_DB_URL = ['postgres://', 'tamgiao@db.internal:5432/', 'tamgiao_prod'].join('');

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'scan-bundle-'));
  tempDirs.push(dir);
  return dir;
}

describe('scanContent', () => {
  it('bundle sạch (có console.error/warn, API production và 2 ngoại lệ vendor) trả []', () => {
    const cleanJs = [
      'console.error(err);',
      'console.warn(warning);',
      'fetch(`https://api.tamgiao.example/v1`);',
      "const o='http://localhost:8081/';",
      'const u=`null`?window.origin:`http://localhost`;',
    ].join('\n');

    expect(scanContent('assets/index.js', cleanJs)).toEqual([]);
  });

  it.each([
    {
      label: 'route /dev/',
      content: 'const url="/dev/payments/fake/1";',
      expectedRule: 'dev-route',
    },
    {
      label: 'testID panel thanh toán giả',
      content: 'jsx("button",{testID:"dev-fake-pay-succeeded"})',
      expectedRule: 'fake-payment-ui',
    },
    {
      label: 'chuỗi tiếng Việt bị escape \\uXXXX của panel thanh toán giả',
      content: "const label='Thanh to\\u00e1n gi\\u1ea3: th\\u00e0nh c\\u00f4ng';",
      expectedRule: 'fake-payment-ui',
    },
    {
      label: 'URL máy dev http://localhost',
      content: 'const cfg={baseUrl:"http://localhost:3000"};',
      expectedRule: 'dev-url',
    },
    {
      label: 'URL emulator ws://10.0.2.2',
      content: 'const ws="ws://10.0.2.2:3000/ws";',
      expectedRule: 'dev-url',
    },
    {
      label: 'IP dev không kèm scheme',
      content: 'const cfg={host:"127.0.0.1"};',
      expectedRule: 'dev-host',
    },
    {
      label: 'console.log còn sót',
      content: 'function debug(){console.log("x");}',
      expectedRule: 'console-log',
    },
    {
      label: 'PEM private key',
      content: `const k="${FAKE_PEM_HEADER}\\n...";`,
      expectedRule: 'private-key',
    },
    {
      label: 'AWS access key',
      content: `const id="${FAKE_AWS_KEY}";`,
      expectedRule: 'aws-access-key',
    },
    {
      label: 'JWT cứng trong bundle',
      content: `const tok="${FAKE_JWT}";`,
      expectedRule: 'jwt',
    },
  ])('phát hiện $label → rule $expectedRule', ({ content, expectedRule }) => {
    const findings = scanContent('assets/app.js', content);
    const rules = findings.map((f) => f.rule);
    expect(rules).toContain(expectedRule);
  });

  it('ngoại lệ vendor chỉ áp dụng đúng khoảng khớp, không bỏ qua URL bẩn kề bên', () => {
    const content = [
      "const devServer='http://localhost:8081/';",
      'const leaked="http://localhost:8081/api";',
    ].join('\n');

    const findings = scanContent('assets/app.js', content);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.rule).toBe('dev-url');
    expect(findings[0]?.excerpt).toContain('http://localhost:8081/api');
  });
});

describe('env-example-secret', () => {
  it('parseEnvExampleSecrets lọc đúng comment, key không khớp, giá trị ngắn và bỏ nháy bao ngoài', () => {
    const envText = [
      '# Comment bình thường',
      '',
      'NODE_ENV=development',
      'API_PORT=3000',
      'S3_ACCESS_KEY_ID=tamgiao',
      `AUTH_SECRET="${FAKE_SECRET_A}"`,
      `PAYMENT_WEBHOOK_SECRET='${FAKE_SECRET_B}'`,
      `DATABASE_URL=${FAKE_DB_URL}`,
      `DUP_TOKEN=${FAKE_SECRET_A}`,
      '# COMMENTED_SECRET=should-not-be-included-in-output',
    ].join('\n');

    expect(parseEnvExampleSecrets(envText)).toEqual([FAKE_SECRET_A, FAKE_SECRET_B, FAKE_DB_URL]);
  });

  it('scanContent phát hiện secret mẫu và che trong excerpt', () => {
    const findings = scanContent('assets/app.js', `const s="${FAKE_SECRET_A}";`, {
      secrets: [FAKE_SECRET_A],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.rule).toBe('env-example-secret');
    expect(findings[0]?.excerpt).toBe(`${FAKE_SECRET_A.slice(0, 4)}***`);
    expect(findings[0]?.excerpt).not.toContain(FAKE_SECRET_A);
  });
});

describe('decodeJsEscapes', () => {
  it('giải mã \\uXXXX, \\u{X...} và \\xXX, giữ nguyên phần còn lại', () => {
    expect(decodeJsEscapes('Thanh to\\u00e1n gi\\u1ea3')).toBe('Thanh toán giả');
    expect(decodeJsEscapes('icon \\u{1F600} + \\xe1')).toBe('icon 😀 + á');
    expect(decodeJsEscapes('plain text /v1')).toBe('plain text /v1');
  });
});

describe('main CLI', () => {
  let stdoutText = '';
  let stderrText = '';

  beforeEach(() => {
    stdoutText = '';
    stderrText = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutText += String(chunk);
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderrText += String(chunk);
      return true;
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        await rm(dir, { recursive: true, force: true });
      }
    }
  });

  it('trả 0 khi thư mục build sạch và bỏ qua file ảnh .png', async () => {
    const dist = await createTempDir();
    await mkdir(join(dist, 'assets'), { recursive: true });
    await writeFile(join(dist, 'index.html'), '<!doctype html><html><head></head></html>');
    await writeFile(join(dist, 'assets', 'app.js'), 'export const api="https://api.tamgiao.example";');
    await writeFile(join(dist, 'assets', 'logo.png'), '/dev/payments/fake');

    const code = await main([dist]);
    expect(code).toBe(0);
    expect(stdoutText).toContain('Bundle scan passed: 2 file(s) clean.');
  });

  it('trả 1 khi phát hiện rule bẩn và in [<rule>] ra stdout', async () => {
    const dist = await createTempDir();
    await mkdir(join(dist, 'assets'), { recursive: true });
    await writeFile(join(dist, 'assets', 'app.js'), 'fetch("/dev/payments/fake");');

    const code = await main([dist]);
    expect(code).toBe(1);
    expect(stdoutText).toContain('[dev-route]');
    expect(stdoutText).toContain('Bundle scan failed: 1 issue(s) in 1 file(s).');
  });

  it('trả 2 khi thiếu tham số, thư mục không tồn tại hoặc không có file quét được', async () => {
    expect(await main([])).toBe(2);
    expect(stderrText).toContain('Usage: scan-bundle');

    const missing = join(tmpdir(), 'scan-bundle-non-existent-dir-xyz');
    expect(await main([missing])).toBe(2);

    const onlyImages = await createTempDir();
    await writeFile(join(onlyImages, 'icon.png'), 'not-scanned');
    stderrText = '';
    expect(await main([onlyImages])).toBe(2);
    expect(stderrText).toContain('No scannable files in');
  });

  it('trả 1 khi dùng --env-example phát hiện secret mẫu nhưng không in secret đầy đủ', async () => {
    const dir = await createTempDir();
    const envFile = join(dir, '.env.example');
    const dist = join(dir, 'dist');
    await mkdir(dist, { recursive: true });
    await writeFile(envFile, `AUTH_SECRET=${FAKE_SECRET_A}\n`);
    await writeFile(join(dist, 'app.js'), `const k="${FAKE_SECRET_A}";`);

    const code = await main(['--env-example', envFile, dist]);
    expect(code).toBe(1);
    expect(stdoutText).toContain('[env-example-secret]');
    expect(stdoutText).not.toContain(FAKE_SECRET_A);
  });

  it('trả 1 khi quét nhiều thư mục (1 sạch + 1 bẩn)', async () => {
    const cleanDir = await createTempDir();
    const dirtyDir = await createTempDir();
    await writeFile(join(cleanDir, 'app.js'), 'export const ok = true;');
    await writeFile(join(dirtyDir, 'app.js'), 'console.log("debug");');

    const code = await main([cleanDir, dirtyDir]);
    expect(code).toBe(1);
    expect(stdoutText).toContain('[console-log]');
  });
});
