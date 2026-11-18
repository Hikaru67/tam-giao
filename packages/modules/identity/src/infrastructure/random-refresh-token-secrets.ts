import { createHash, randomBytes } from 'node:crypto';
import type { RefreshTokenSecrets } from '../application/ports/token-services.js';

/** Token 256-bit ngẫu nhiên; vì entropy cao nên lưu SHA-256 (không cần băm chậm hay pepper). */
export class RandomRefreshTokenSecrets implements RefreshTokenSecrets {
  generate(): string {
    return randomBytes(32).toString('base64url');
  }

  hash(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }
}
