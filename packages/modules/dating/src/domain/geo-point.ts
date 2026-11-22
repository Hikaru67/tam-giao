import { fail, ok, type DomainError, type Result } from '@tamgiao/kernel';

/**
 * Value Object vị trí thô gửi kèm check-in an toàn (BE-S7-02). Là dữ liệu cá nhân (vị trí) → infrastructure mã hoá qua
 * `Encryptor` trước khi lưu, không log, không đưa vào event; tự xoá sau `CHECK_IN_LOCATION_RETENTION_HOURS` giờ.
 */
export class GeoPoint {
  private constructor(
    readonly latitude: number,
    readonly longitude: number,
    /** Bán kính sai số (mét) do thiết bị báo; `null` khi không có. */
    readonly accuracyMeters: number | null,
  ) {}

  static create(input: {
    readonly latitude: number;
    readonly longitude: number;
    readonly accuracyMeters?: number | null;
  }): Result<GeoPoint, DomainError<'VALIDATION_FAILED'>> {
    const { latitude, longitude } = input;
    const accuracy = input.accuracyMeters ?? null;
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      return fail('VALIDATION_FAILED', { field: 'location.latitude' });
    }
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      return fail('VALIDATION_FAILED', { field: 'location.longitude' });
    }
    if (accuracy !== null && (!Number.isFinite(accuracy) || accuracy < 0)) {
      return fail('VALIDATION_FAILED', { field: 'location.accuracyMeters' });
    }
    return ok(new GeoPoint(latitude, longitude, accuracy));
  }

  /** Dạng tuần tự hoá để mã hoá (infrastructure). */
  serialize(): string {
    return JSON.stringify({ lat: this.latitude, lng: this.longitude, acc: this.accuracyMeters });
  }

  /** Ngược của `serialize`; dữ liệu sai dạng là lỗi dữ liệu → throw. */
  static deserialize(raw: string): GeoPoint {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) {
      const { lat, lng, acc } = parsed as { lat?: unknown; lng?: unknown; acc?: unknown };
      if (typeof lat === 'number' && typeof lng === 'number' && (acc === null || typeof acc === 'number')) {
        const point = GeoPoint.create({ latitude: lat, longitude: lng, accuracyMeters: acc });
        if (point.isOk()) return point.value;
      }
    }
    throw new Error('GeoPoint: dữ liệu vị trí không hợp lệ');
  }
}
