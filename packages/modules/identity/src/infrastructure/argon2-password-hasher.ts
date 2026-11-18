import { hash, verify } from '@node-rs/argon2';
import type { PasswordHasher } from '../application/ports/password-hasher.js';

/** Algorithm.Argon2id của @node-rs/argon2 (const enum — không import được khi `isolatedModules`). */
const ARGON2ID = 2;

/** Tham số tối thiểu khuyến nghị của OWASP cho argon2id: m = 19 MiB, t = 2, p = 1. */
const OPTIONS = { algorithm: ARGON2ID, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export class Argon2PasswordHasher implements PasswordHasher {
  /** Hash giả để so khớp khi không có tài khoản — tạo một lần, lười. */
  private dummyHash: Promise<string> | undefined;

  constructor(private readonly options: Partial<typeof OPTIONS> = {}) {}

  hash(password: string): Promise<string> {
    return hash(password, { ...OPTIONS, ...this.options });
  }

  async verify(storedHash: string | null, password: string): Promise<boolean> {
    if (storedHash === null) {
      this.dummyHash ??= this.hash('dummy-password-for-timing');
      await verify(await this.dummyHash, password);
      return false;
    }
    try {
      return await verify(storedHash, password);
    } catch {
      // Chuỗi hash hỏng → coi như sai mật khẩu, không làm sập request.
      return false;
    }
  }
}
