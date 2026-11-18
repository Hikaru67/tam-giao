import { describe, expect, it } from 'vitest';
import {
  EKYC_REJECTION_KINDS,
  type EkycImageRef,
  type EkycProvider,
} from '../application/ports/ekyc-provider.js';

/**
 * Bộ ảnh mẫu cho contract test. Với adapter thật: các key trỏ tới ảnh fixture đã tải sẵn lên bucket test
 * (người mẫu đồng ý, không dùng dữ liệu thật của khách hàng).
 */
export interface EkycContractFixtures {
  /** CCCD rõ nét của "người A". */
  readonly idFront: EkycImageRef;
  readonly idBack: EkycImageRef;
  /** Selfie người thật của "người A". */
  readonly selfie: EkycImageRef;
  /** Mặt trước CCCD bị mờ. */
  readonly blurryIdFront: EkycImageRef;
  /** Selfie người thật của "người B" (khác người trên thẻ). */
  readonly otherPersonSelfie: EkycImageRef;
}

export interface EkycContractSubject {
  readonly provider: EkycProvider;
  readonly fixtures: EkycContractFixtures;
}

const CCCD_RE = /^\d{12}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isCalendarDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function expectScore(score: number | undefined): void {
  expect(typeof score).toBe('number');
  expect(score).toBeGreaterThanOrEqual(0);
  expect(score).toBeLessThanOrEqual(1);
}

/**
 * Hợp đồng chung của mọi `EkycProvider` (BE-S3-02 AC1). Adapter thật (khi chốt D2) gọi lại hàm này trong
 * file `ekyc-<provider>.test.ts`/`.int.test.ts` của nó với fixture riêng.
 */
export function runEkycProviderContract(name: string, createSubject: () => EkycContractSubject): void {
  describe(`EkycProvider contract: ${name}`, () => {
    it('ocrIdCard returns normalized id card data for clear images', async () => {
      const { provider, fixtures } = createSubject();
      const result = await provider.ocrIdCard(fixtures.idFront, fixtures.idBack);
      if (!result.ok) throw new Error(`expected Ok, got rejection ${result.error.kind}`);
      expect(result.value.cccdNumber).toMatch(CCCD_RE);
      expect(result.value.fullName.trim()).toBe(result.value.fullName);
      expect(result.value.fullName).not.toMatch(/\s{2,}/);
      expect(result.value.fullName.length).toBeGreaterThan(0);
      expect(isCalendarDate(result.value.dateOfBirth)).toBe(true);
    });

    it('checkLiveness returns a score in [0, 1] for a live selfie', async () => {
      const { provider, fixtures } = createSubject();
      const result = await provider.checkLiveness(fixtures.selfie);
      if (!result.ok) throw new Error(`expected Ok, got rejection ${result.error.kind}`);
      expectScore(result.value.score);
    });

    it('matchFace returns a score in [0, 1] for the same person', async () => {
      const { provider, fixtures } = createSubject();
      const result = await provider.matchFace(fixtures.idFront, fixtures.selfie);
      if (!result.ok) throw new Error(`expected Ok, got rejection ${result.error.kind}`);
      expectScore(result.value.score);
    });

    it('rejects a blurry id card with a classified rejection instead of throwing', async () => {
      const { provider, fixtures } = createSubject();
      const result = await provider.ocrIdCard(fixtures.blurryIdFront, fixtures.idBack);
      if (result.ok) throw new Error('expected rejection for blurry image');
      expect(EKYC_REJECTION_KINDS).toContain(result.error.kind);
      expect(['IMAGE_BLURRY', 'DOCUMENT_UNREADABLE']).toContain(result.error.kind);
    });

    it('rejects a different person with FACE_MISMATCH instead of throwing', async () => {
      const { provider, fixtures } = createSubject();
      const result = await provider.matchFace(fixtures.idFront, fixtures.otherPersonSelfie);
      if (result.ok) throw new Error('expected FACE_MISMATCH rejection');
      expect(result.error.kind).toBe('FACE_MISMATCH');
      if (result.error.score !== undefined) expectScore(result.error.score);
    });

    it('returns stable results when called again with the same images', async () => {
      const { provider, fixtures } = createSubject();
      const first = await provider.ocrIdCard(fixtures.idFront, fixtures.idBack);
      const second = await provider.ocrIdCard(fixtures.idFront, fixtures.idBack);
      expect(second.ok).toBe(first.ok);
      if (first.ok && second.ok) expect(second.value.cccdNumber).toBe(first.value.cccdNumber);
    });
  });
}
