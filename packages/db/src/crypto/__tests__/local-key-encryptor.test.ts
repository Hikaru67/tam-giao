import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  HmacBlindIndexer,
  LocalKeyEncryptor,
  normalizeForIndex,
  parseMasterKeyRing,
} from '../local-key-encryptor.js';

const b64 = () => randomBytes(32).toString('base64');
const CTX = 'verification.cccd_number:user-1';

describe('LocalKeyEncryptor', () => {
  const k1 = b64();
  const ringV1 = parseMasterKeyRing(`1:${k1}`, 1);

  it('encrypt → decrypt trả lại giá trị gốc, kể cả tiếng Việt có dấu (AC1)', async () => {
    const enc = new LocalKeyEncryptor(ringV1);
    for (const plain of ['001095012345', 'Thu nhập 45 - 70 triệu', '']) {
      expect(await enc.decrypt(await enc.encrypt(plain, CTX), CTX)).toBe(plain);
    }
  });

  it('sửa 1 byte ciphertext (ở mọi vùng) → decrypt lỗi (AC1)', async () => {
    const enc = new LocalKeyEncryptor(ringV1);
    const ct = Buffer.from(await enc.encrypt('001095012345', CTX));
    for (const pos of [10, 40, ct.length - 20, ct.length - 1]) {
      const tampered = Buffer.from(ct);
      tampered[pos] = (tampered[pos] ?? 0) ^ 0x01;
      await expect(enc.decrypt(tampered, CTX)).rejects.toThrow();
    }
  });

  it('cùng plaintext mã hoá 2 lần cho ciphertext khác nhau (AC2)', async () => {
    const enc = new LocalKeyEncryptor(ringV1);
    const a = Buffer.from(await enc.encrypt('001095012345', CTX));
    const b = Buffer.from(await enc.encrypt('001095012345', CTX));
    expect(a.equals(b)).toBe(false);
  });

  it('context khác → không giải mã được (chống chép ciphertext sang bản ghi khác)', async () => {
    const enc = new LocalKeyEncryptor(ringV1);
    const ct = await enc.encrypt('001095012345', CTX);
    await expect(enc.decrypt(ct, 'verification.cccd_number:user-2')).rejects.toThrow();
  });

  it('xoay khoá: dữ liệu cũ (v1) vẫn giải mã được sau khi chuyển sang v2 (AC3)', async () => {
    const oldCt = await new LocalKeyEncryptor(ringV1).encrypt('001095012345', CTX);
    const ringV2 = parseMasterKeyRing(`1:${k1},2:${b64()}`, 2);
    const enc = new LocalKeyEncryptor(ringV2);
    expect(await enc.decrypt(oldCt, CTX)).toBe('001095012345');
    const newCt = Buffer.from(await enc.encrypt('001095012345', CTX));
    expect(newCt.readUInt16BE(1)).toBe(2);
  });

  it('thiếu khoá cho version trong ciphertext → lỗi', async () => {
    const ct = await new LocalKeyEncryptor(parseMasterKeyRing(`3:${b64()}`, 3)).encrypt('x', CTX);
    await expect(new LocalKeyEncryptor(ringV1).decrypt(ct, CTX)).rejects.toThrow(/version 3/);
  });

  it('ciphertext quá ngắn hoặc sai format version → lỗi', async () => {
    const enc = new LocalKeyEncryptor(ringV1);
    await expect(enc.decrypt(new Uint8Array(10), CTX)).rejects.toThrow(/định dạng/);
    const ct = Buffer.from(await enc.encrypt('x', CTX));
    ct[0] = 9;
    await expect(enc.decrypt(ct, CTX)).rejects.toThrow(/định dạng/);
  });

  it('ring thiếu khoá hiện tại khi mã hoá → lỗi', async () => {
    const enc = new LocalKeyEncryptor({ currentVersion: 5, keys: new Map() });
    await expect(enc.encrypt('x', CTX)).rejects.toThrow(/version 5/);
  });
});

describe('parseMasterKeyRing', () => {
  it.each([
    ['khoá sai độ dài', `1:${Buffer.alloc(16).toString('base64')}`, 1, /32 bytes/],
    ['version không hợp lệ', `0:${b64()}`, 0, /1\.\.65535/],
    ['thiếu dấu hai chấm', b64(), 1, /1\.\.65535/],
    ['trùng version', `1:${b64()},1:${b64()}`, 1, /trùng/],
    ['không có version hiện tại', `1:${b64()}`, 2, /version hiện tại 2/],
  ])('từ chối: %s', (_name, raw, current, error) => {
    expect(() => parseMasterKeyRing(raw, current)).toThrow(error);
  });

  it('bỏ qua khoảng trắng và phần tử rỗng', () => {
    const ring = parseMasterKeyRing(` 1:${b64()} , ,2:${b64()} `, 2);
    expect([...ring.keys.keys()]).toEqual([1, 2]);
  });
});

describe('HmacBlindIndexer', () => {
  const indexer = new HmacBlindIndexer(randomBytes(32));

  it('cùng giá trị → cùng index, đã chuẩn hoá khoảng trắng (AC2)', () => {
    expect(indexer.index('001095012345', 'cccd')).toBe(indexer.index(' 001 095 012 345 ', 'cccd'));
    expect(indexer.index('001095012345', 'cccd')).not.toBe(indexer.index('001095012346', 'cccd'));
  });

  it('khác purpose → index khác (không so khớp chéo SĐT với CCCD)', () => {
    expect(indexer.index('0912345678', 'phone')).not.toBe(indexer.index('0912345678', 'cccd'));
  });

  it('khác root key → index khác', () => {
    expect(new HmacBlindIndexer(randomBytes(32)).index('x', 'cccd')).not.toBe(indexer.index('x', 'cccd'));
  });

  it('từ chối root key sai độ dài', () => {
    expect(() => new HmacBlindIndexer(randomBytes(16))).toThrow(/32 bytes/);
  });

  it('normalizeForIndex: NFKC, bỏ khoảng trắng, chữ thường', () => {
    expect(normalizeForIndex(' A.Nguyen@Mail.VN ')).toBe('a.nguyen@mail.vn');
    expect(normalizeForIndex('０９１２ 345')).toBe('0912345');
  });
});
