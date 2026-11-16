import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';
import type { BlindIndexer, Encryptor } from '@tamgiao/kernel';

/**
 * Envelope encryption AES-256-GCM với master key lấy từ cấu hình (local/dev; production thay bằng adapter KMS — D5).
 *
 * Định dạng ciphertext (bytes):
 *   [1: FORMAT_VERSION][2: keyVersion BE][12: iv bọc khoá][32: data key đã bọc][16: tag bọc khoá]
 *   [12: iv dữ liệu][n: dữ liệu đã mã hoá][16: tag dữ liệu]
 * Mỗi bản ghi có data key ngẫu nhiên riêng; `context` được đưa vào AAD của cả hai lớp.
 */

const FORMAT_VERSION = 1;
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = 1 + 2 + IV_BYTES + KEY_BYTES + TAG_BYTES;

export interface MasterKeyRing {
  /** Version dùng để mã hoá dữ liệu mới. */
  readonly currentVersion: number;
  /** Mọi version còn hiệu lực để giải mã dữ liệu cũ (xoay khoá: thêm version mới, giữ version cũ). */
  readonly keys: ReadonlyMap<number, Buffer>;
}

/** Parse `"1:<base64 32 bytes>,2:<base64 32 bytes>"` (biến môi trường) thành key ring. */
export function parseMasterKeyRing(raw: string, currentVersion: number): MasterKeyRing {
  const keys = new Map<number, Buffer>();
  for (const part of raw
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)) {
    const sep = part.indexOf(':');
    const version = Number(part.slice(0, sep));
    const key = Buffer.from(part.slice(sep + 1), 'base64');
    if (sep <= 0 || !Number.isInteger(version) || version < 1 || version > 0xffff) {
      throw new Error('Master key ring: version phải là số nguyên 1..65535');
    }
    if (key.length !== KEY_BYTES) {
      throw new Error(`Master key ring: khoá version ${version} phải dài ${KEY_BYTES} bytes`);
    }
    if (keys.has(version)) throw new Error(`Master key ring: trùng version ${version}`);
    keys.set(version, key);
  }
  if (!keys.has(currentVersion)) {
    throw new Error(`Master key ring: không có khoá cho version hiện tại ${currentVersion}`);
  }
  return { currentVersion, keys };
}

function aad(kind: 'key' | 'data', keyVersion: number, context: string): Buffer {
  return Buffer.from(`tamgiao:v${FORMAT_VERSION}:${kind}:${keyVersion}:${context}`, 'utf8');
}

function seal(
  key: Buffer,
  plaintext: Buffer,
  additionalData: Buffer,
): { iv: Buffer; body: Buffer; tag: Buffer } {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(additionalData);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { iv, body, tag: cipher.getAuthTag() };
}

function open(key: Buffer, iv: Buffer, body: Buffer, tag: Buffer, additionalData: Buffer): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(additionalData);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

export class LocalKeyEncryptor implements Encryptor {
  constructor(private readonly ring: MasterKeyRing) {}

  async encrypt(plaintext: string, context: string): Promise<Uint8Array> {
    const keyVersion = this.ring.currentVersion;
    const masterKey = this.ring.keys.get(keyVersion);
    if (!masterKey) throw new Error(`Không có master key version ${keyVersion}`);

    const dataKey = randomBytes(KEY_BYTES);
    const wrapped = seal(masterKey, dataKey, aad('key', keyVersion, context));
    const data = seal(dataKey, Buffer.from(plaintext, 'utf8'), aad('data', keyVersion, context));

    const header = Buffer.alloc(3);
    header.writeUInt8(FORMAT_VERSION, 0);
    header.writeUInt16BE(keyVersion, 1);
    return Buffer.concat([header, wrapped.iv, wrapped.body, wrapped.tag, data.iv, data.body, data.tag]);
  }

  async decrypt(ciphertext: Uint8Array, context: string): Promise<string> {
    const buf = Buffer.from(ciphertext);
    if (buf.length < HEADER_BYTES + IV_BYTES + TAG_BYTES || buf.readUInt8(0) !== FORMAT_VERSION) {
      throw new Error('Ciphertext sai định dạng');
    }
    const keyVersion = buf.readUInt16BE(1);
    const masterKey = this.ring.keys.get(keyVersion);
    if (!masterKey) throw new Error(`Không có master key version ${keyVersion}`);

    let offset = 3;
    const take = (n: number) => buf.subarray(offset, (offset += n));
    const keyIv = take(IV_BYTES);
    const wrappedKey = take(KEY_BYTES);
    const keyTag = take(TAG_BYTES);
    const dataIv = take(IV_BYTES);
    const dataBody = buf.subarray(offset, buf.length - TAG_BYTES);
    const dataTag = buf.subarray(buf.length - TAG_BYTES);

    const dataKey = open(masterKey, keyIv, wrappedKey, keyTag, aad('key', keyVersion, context));
    return open(dataKey, dataIv, dataBody, dataTag, aad('data', keyVersion, context)).toString('utf8');
  }
}

/**
 * Chuẩn hoá trước khi tính index: NFKC, bỏ mọi khoảng trắng, chữ thường.
 * Phù hợp cho định danh (CCCD, SĐT, email) — không dùng cho văn bản tự do.
 */
export function normalizeForIndex(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, '').toLowerCase();
}

export class HmacBlindIndexer implements BlindIndexer {
  private readonly derived = new Map<string, Buffer>();

  constructor(private readonly rootKey: Buffer) {
    if (rootKey.length !== KEY_BYTES) throw new Error(`Blind index key phải dài ${KEY_BYTES} bytes`);
  }

  index(value: string, purpose: string): string {
    return createHmac('sha256', this.keyFor(purpose))
      .update(normalizeForIndex(value), 'utf8')
      .digest('base64url');
  }

  /** Khoá riêng cho từng mục đích (HKDF) → index của SĐT và của CCCD không so khớp chéo được. */
  private keyFor(purpose: string): Buffer {
    let key = this.derived.get(purpose);
    if (!key) {
      key = Buffer.from(
        hkdfSync('sha256', this.rootKey, Buffer.alloc(0), `tamgiao:bidx:${purpose}`, KEY_BYTES),
      );
      this.derived.set(purpose, key);
    }
    return key;
  }
}
