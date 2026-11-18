/**
 * Tạo tài khoản admin (dùng để seed admin đầu tiên) — BE-S2-03.
 *
 *   pnpm --filter @tamgiao/tools seed:admin --email ops@tamgiao.vn --role ADMIN
 *
 * Mật khẩu nhập ẩn qua terminal (hoặc pipe vào stdin), không nhận qua tham số/biến môi trường để khỏi lọt vào
 * shell history. In ra URI `otpauth://` **một lần** để thêm vào app Authenticator — không lưu lại ở đâu khác.
 */
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline';
import { envPostgresUrl, loadEnvOrExit } from '@tamgiao/config';
import {
  DrizzleUnitOfWork,
  HmacBlindIndexer,
  LocalKeyEncryptor,
  createDatabase,
  parseMasterKeyRing,
} from '@tamgiao/db';
import { SystemClock } from '@tamgiao/kernel';
import { ConsoleSmsSender, createIdentityModule } from '@tamgiao/module-identity';
import { z } from 'zod';

const base64Key = z
  .string()
  .transform((v) => Buffer.from(v, 'base64'))
  .refine((k) => k.length >= 32);

const env = loadEnvOrExit(
  'seed-admin',
  z.object({
    DATABASE_URL: envPostgresUrl,
    DATA_MASTER_KEYS: z.string(),
    DATA_MASTER_KEY_VERSION: z.coerce.number().int().min(1).default(1),
    BLIND_INDEX_KEY: base64Key,
    AUTH_SECRET: base64Key,
  }),
  process.env,
);

const { values } = parseArgs({
  options: { email: { type: 'string' }, role: { type: 'string', default: 'ADMIN' } },
});
if (!values.email) {
  console.error('Thiếu --email');
  process.exit(1);
}

async function readPassword(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
  if (process.stdin.isTTY) {
    // Không in lại ký tự người dùng gõ.
    const output = rl as unknown as { _writeToOutput: (s: string) => void };
    output._writeToOutput = (s: string) => {
      if (s.startsWith(prompt)) process.stdout.write(prompt);
    };
  }
  const answer = await new Promise<string>((resolve) => rl.question(prompt, resolve));
  rl.close();
  if (process.stdin.isTTY) process.stdout.write('\n');
  return answer;
}

const password = await readPassword('Mật khẩu admin: ');
const database = createDatabase(env.DATABASE_URL, { maxConnections: 1 });
try {
  const identity = createIdentityModule({
    uow: new DrizzleUnitOfWork(database.pool),
    clock: new SystemClock(),
    encryptor: new LocalKeyEncryptor(parseMasterKeyRing(env.DATA_MASTER_KEYS, env.DATA_MASTER_KEY_VERSION)),
    blindIndexer: new HmacBlindIndexer(env.BLIND_INDEX_KEY),
    smsSender: new ConsoleSmsSender(),
    authSecret: env.AUTH_SECRET,
  });
  const result = await identity.commands.createAdminUser.execute({
    email: values.email,
    password,
    role: values.role ?? 'ADMIN',
  });
  if (result.isErr()) {
    console.error(`Không tạo được admin: ${result.error.code}`, result.error.details ?? '');
    process.exitCode = 1;
  } else {
    console.log(`Đã tạo admin ${result.value.adminId} (${values.role ?? 'ADMIN'}).`);
    console.log('Thêm vào app Authenticator bằng URI sau (chỉ hiển thị một lần):');
    console.log(result.value.otpauthUri);
  }
} finally {
  await database.close();
}
