import { describe, expect, it } from 'vitest';
import { EkycProviderError } from '../application/ports/ekyc-provider.js';
import {
  FAKE_EKYC_ID_CARD,
  FakeEkycProvider,
  type FakeEkycProviderOptions,
} from '../infrastructure/ekyc/fake-ekyc-provider.js';
import { ResilientEkycProvider } from '../infrastructure/ekyc/resilient-ekyc-provider.js';
import { runEkycProviderContract, type EkycContractFixtures } from './ekyc-provider.contract.js';

const fixtures: EkycContractFixtures = {
  idFront: { key: 'kyc/u1/id-front.jpg' },
  idBack: { key: 'kyc/u1/id-back.jpg' },
  selfie: { key: 'kyc/u1/selfie.jpg' },
  blurryIdFront: { key: 'kyc/u1/id-front-blurry.jpg' },
  otherPersonSelfie: { key: 'kyc/u2/selfie.jpg' },
};

const contractOptions: FakeEkycProviderOptions = {
  scenarioByKey: {
    [fixtures.blurryIdFront.key]: 'BLURRY',
    [fixtures.otherPersonSelfie.key]: 'MISMATCH',
  },
};

runEkycProviderContract('FakeEkycProvider', () => ({
  provider: new FakeEkycProvider(contractOptions),
  fixtures,
}));

runEkycProviderContract('ResilientEkycProvider(FakeEkycProvider)', () => ({
  provider: new ResilientEkycProvider(new FakeEkycProvider(contractOptions), {
    timeoutMs: 5_000,
    maxAttempts: 3,
  }),
  fixtures,
}));

describe('FakeEkycProvider scenarios', () => {
  const { idFront, idBack, selfie } = fixtures;

  it('SUCCESS returns configured data and scores', async () => {
    const idCard = { cccdNumber: '079201000123', fullName: 'TRAN THI B', dateOfBirth: '2001-02-03' };
    const provider = new FakeEkycProvider({ idCard, livenessScore: 0.9, faceMatchScore: 0.8 });

    const ocr = await provider.ocrIdCard(idFront, idBack);
    const liveness = await provider.checkLiveness(selfie);
    const match = await provider.matchFace(idFront, selfie);

    expect(ocr.ok && ocr.value).toEqual(idCard);
    expect(liveness.ok && liveness.value).toEqual({ score: 0.9 });
    expect(match.ok && match.value).toEqual({ score: 0.8 });
  });

  it('defaults to SUCCESS with the built-in fake identity', async () => {
    const result = await new FakeEkycProvider().ocrIdCard(idFront, idBack);
    expect(result.ok && result.value).toEqual(FAKE_EKYC_ID_CARD);
  });

  it('BLURRY rejects every operation with IMAGE_BLURRY', async () => {
    const provider = new FakeEkycProvider({ scenario: 'BLURRY' });
    const results = [
      await provider.ocrIdCard(idFront, idBack),
      await provider.checkLiveness(selfie),
      await provider.matchFace(idFront, selfie),
    ];
    for (const r of results) {
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toEqual({ kind: 'IMAGE_BLURRY' });
    }
  });

  it('MISMATCH passes OCR and liveness but rejects matchFace with FACE_MISMATCH and a score', async () => {
    const provider = new FakeEkycProvider({ scenario: 'MISMATCH', mismatchScore: 0.2 });
    expect((await provider.ocrIdCard(idFront, idBack)).ok).toBe(true);
    expect((await provider.checkLiveness(selfie)).ok).toBe(true);
    const match = await provider.matchFace(idFront, selfie);
    expect(!match.ok && match.error).toEqual({ kind: 'FACE_MISMATCH', score: 0.2 });
  });

  it.each(['TIMEOUT', 'UNAVAILABLE'] as const)(
    '%s throws a classified EkycProviderError',
    async (scenario) => {
      const provider = new FakeEkycProvider({ scenario });
      await expect(provider.ocrIdCard(idFront, idBack)).rejects.toMatchObject({
        name: 'EkycProviderError',
        kind: scenario,
        operation: 'ocrIdCard',
        retryable: true,
      });
      await expect(provider.checkLiveness(selfie)).rejects.toBeInstanceOf(EkycProviderError);
      await expect(provider.matchFace(idFront, selfie)).rejects.toBeInstanceOf(EkycProviderError);
    },
  );

  it('scenarioByKey overrides the default scenario only for matching images', async () => {
    const provider = new FakeEkycProvider({ scenarioByKey: { [selfie.key]: 'TIMEOUT' } });
    expect((await provider.ocrIdCard(idFront, idBack)).ok).toBe(true);
    await expect(provider.checkLiveness(selfie)).rejects.toMatchObject({ kind: 'TIMEOUT' });
  });

  it('setScenario switches behaviour and calls are recorded with image keys', async () => {
    const provider = new FakeEkycProvider();
    await provider.checkLiveness(selfie);
    provider.setScenario('UNAVAILABLE');
    await expect(provider.matchFace(idFront, selfie)).rejects.toMatchObject({ kind: 'UNAVAILABLE' });

    expect(provider.calls).toEqual([
      { operation: 'checkLiveness', keys: [selfie.key] },
      { operation: 'matchFace', keys: [idFront.key, selfie.key] },
    ]);
  });

  it('infrastructure error message never contains PII', async () => {
    const provider = new FakeEkycProvider({ scenario: 'TIMEOUT' });
    const error = await provider.ocrIdCard(idFront, idBack).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EkycProviderError);
    const message = (error as EkycProviderError).message;
    expect(message).toBe('eKYC ocrIdCard failed: TIMEOUT');
    expect(message).not.toContain(FAKE_EKYC_ID_CARD.cccdNumber);
    expect(message).not.toContain(FAKE_EKYC_ID_CARD.fullName);
  });
});
