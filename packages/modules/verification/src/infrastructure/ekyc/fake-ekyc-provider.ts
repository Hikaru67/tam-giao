import { createHash } from 'node:crypto';
import { err, ok, type Result } from '@tamgiao/kernel';
import {
  EkycProviderError,
  type EkycImageRef,
  type EkycOperation,
  type EkycProvider,
  type EkycRejection,
  type FaceMatchResult,
  type IdCardOcrResult,
  type LivenessResult,
} from '../../application/ports/ekyc-provider.js';

/**
 * Kịch bản của `FakeEkycProvider`:
 * - `SUCCESS`: mọi thao tác thành công với dữ liệu cấu hình.
 * - `BLURRY`: mọi thao tác từ chối `IMAGE_BLURRY`.
 * - `MISMATCH`: OCR + liveness thành công, `matchFace` từ chối `FACE_MISMATCH`.
 * - `TIMEOUT` / `UNAVAILABLE`: mọi thao tác throw `EkycProviderError` cùng loại.
 */
export const FAKE_EKYC_SCENARIOS = ['SUCCESS', 'BLURRY', 'MISMATCH', 'TIMEOUT', 'UNAVAILABLE'] as const;
export type FakeEkycScenario = (typeof FAKE_EKYC_SCENARIOS)[number];

export interface FakeEkycCall {
  readonly operation: EkycOperation;
  readonly keys: readonly string[];
}

export interface FakeEkycProviderOptions {
  /** Kịch bản mặc định, mặc định `SUCCESS`. */
  readonly scenario?: FakeEkycScenario;
  /**
   * Kịch bản theo object key của ảnh: nếu một ảnh trong lời gọi có key nằm trong map thì dùng kịch bản đó
   * (ưu tiên ảnh đầu tiên khớp) thay cho kịch bản mặc định. Dùng cho contract test theo fixture ảnh.
   */
  readonly scenarioByKey?: Readonly<Record<string, FakeEkycScenario>>;
  readonly idCard?: IdCardOcrResult;
  /**
   * `true` → số CCCD OCR sinh xác định từ key ảnh mặt trước (theo đoạn `<ownerId>` nếu key dạng
   * `<purpose>/<ownerId>/<uploadId>.<ext>`, ngược lại theo cả key) thay vì luôn là `idCard.cccdNumber`.
   * Dùng ở môi trường dev để mỗi người dùng có một số CCCD hợp lệ khác nhau (không dính `CCCD_ALREADY_REGISTERED`).
   */
  readonly deriveCccdFromKey?: boolean;
  readonly livenessScore?: number;
  readonly faceMatchScore?: number;
  /** Điểm khớp trả kèm khi `FACE_MISMATCH`. */
  readonly mismatchScore?: number;
}

/** Dữ liệu giả (không phải người thật). */
export const FAKE_EKYC_ID_CARD: IdCardOcrResult = {
  cccdNumber: '001099000001',
  fullName: 'NGUYEN VAN A',
  dateOfBirth: '1995-06-15',
};

/**
 * Nhà cung cấp eKYC giả cho dev/test khi D2 chưa chốt. Không gọi mạng, trả kết quả tức thì theo kịch bản.
 * Ghi lại các lời gọi (`calls`) để test kiểm tra số lần gọi / retry.
 */
export class FakeEkycProvider implements EkycProvider {
  private scenario: FakeEkycScenario;
  private readonly scenarioByKey: Readonly<Record<string, FakeEkycScenario>>;
  private readonly idCard: IdCardOcrResult;
  private readonly deriveCccdFromKey: boolean;
  private readonly livenessScore: number;
  private readonly faceMatchScore: number;
  private readonly mismatchScore: number;
  private readonly recorded: FakeEkycCall[] = [];

  constructor(options: FakeEkycProviderOptions = {}) {
    this.scenario = options.scenario ?? 'SUCCESS';
    this.scenarioByKey = options.scenarioByKey ?? {};
    this.idCard = options.idCard ?? FAKE_EKYC_ID_CARD;
    this.deriveCccdFromKey = options.deriveCccdFromKey ?? false;
    this.livenessScore = options.livenessScore ?? 0.98;
    this.faceMatchScore = options.faceMatchScore ?? 0.95;
    this.mismatchScore = options.mismatchScore ?? 0.12;
  }

  get calls(): readonly FakeEkycCall[] {
    return this.recorded;
  }

  setScenario(scenario: FakeEkycScenario): void {
    this.scenario = scenario;
  }

  async ocrIdCard(front: EkycImageRef, back: EkycImageRef): Promise<Result<IdCardOcrResult, EkycRejection>> {
    const scenario = this.begin('ocrIdCard', [front, back]);
    if (scenario === 'BLURRY') return err({ kind: 'IMAGE_BLURRY' });
    return ok({
      ...this.idCard,
      ...(this.deriveCccdFromKey ? { cccdNumber: fakeCccdNumberForKey(front.key) } : {}),
    });
  }

  async checkLiveness(selfie: EkycImageRef): Promise<Result<LivenessResult, EkycRejection>> {
    const scenario = this.begin('checkLiveness', [selfie]);
    if (scenario === 'BLURRY') return err({ kind: 'IMAGE_BLURRY' });
    return ok({ score: this.livenessScore });
  }

  async matchFace(
    idPortrait: EkycImageRef,
    selfie: EkycImageRef,
  ): Promise<Result<FaceMatchResult, EkycRejection>> {
    const scenario = this.begin('matchFace', [idPortrait, selfie]);
    if (scenario === 'BLURRY') return err({ kind: 'IMAGE_BLURRY' });
    if (scenario === 'MISMATCH') return err({ kind: 'FACE_MISMATCH', score: this.mismatchScore });
    return ok({ score: this.faceMatchScore });
  }

  /** Ghi lời gọi, chọn kịch bản; kịch bản lỗi hạ tầng thì throw luôn. */
  private begin(operation: EkycOperation, images: readonly EkycImageRef[]): FakeEkycScenario {
    this.recorded.push({ operation, keys: images.map((i) => i.key) });
    const scenario =
      images.map((i) => this.scenarioByKey[i.key]).find((s) => s !== undefined) ?? this.scenario;
    if (scenario === 'TIMEOUT' || scenario === 'UNAVAILABLE') {
      throw new EkycProviderError(scenario, operation);
    }
    return scenario;
  }
}

/**
 * Số CCCD giả hợp lệ (mã tỉnh 001–096 + 9 chữ số) sinh xác định từ key ảnh: cùng chủ sở hữu → cùng số.
 */
export function fakeCccdNumberForKey(key: string): string {
  const segments = key.split('/');
  const seed = segments.length >= 3 && segments[1] ? segments[1] : key;
  const digest = createHash('sha256').update(seed, 'utf8').digest();
  const province = (digest.readUInt16BE(0) % 96) + 1;
  const serial = digest.readUInt32BE(2) % 1_000_000_000;
  return `${String(province).padStart(3, '0')}${String(serial).padStart(9, '0')}`;
}
