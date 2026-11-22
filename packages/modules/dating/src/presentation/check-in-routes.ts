import {
  checkInBodySchema,
  type MyCheckInResponse,
  type SafetyCheckInDto,
} from '@tamgiao/contracts';
import { parseBody, sendResult, type AppEnv } from '@tamgiao/http';
import { Hono, type MiddlewareHandler } from 'hono';
import type {
  CheckInLocationInput,
  CheckInToDate,
  CheckOutOfDate,
  GetMyCheckIn,
} from '../application/safety-check-in.js';
import type { SafetyCheckInView } from '../application/safety-check-in-views.js';

export interface CheckInRoutesDeps {
  readonly checkInToDate: CheckInToDate;
  readonly checkOutOfDate: CheckOutOfDate;
  readonly getMyCheckIn: GetMyCheckIn;
  readonly requireUser: MiddlewareHandler<AppEnv>;
}

/** Check-in an toàn → DTO nhìn từ người dùng (`Date` → ISO). Không trả lại vị trí. */
export function safetyCheckInToDto(view: SafetyCheckInView): SafetyCheckInDto {
  return {
    id: view.id,
    datePlanId: view.datePlanId,
    source: view.source,
    checkedInAt: view.checkedInAt.toISOString(),
    overdueAt: view.overdueAt.toISOString(),
    checkedOutAt: view.checkedOutAt?.toISOString() ?? null,
    overdueAlertedAt: view.overdueAlertedAt?.toISOString() ?? null,
    locationShared: view.locationShared,
  };
}

/**
 * Route check-in an toàn của người dùng app (BE-S7-02), mọi route requireUser:
 * - `POST /me/dates/:id/check-in` — bật check-in an toàn (201); body JSON bắt buộc (`{}` khi không gửi vị trí).
 * - `POST /me/dates/:id/check-out` — check-out buổi hẹn (200).
 * - `GET /me/dates/:id/check-in` — xem trạng thái check-in an toàn của bản thân ({ checkIn: dto | null }).
 */
export function createCheckInRoutes(deps: CheckInRoutesDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.post('/me/dates/:id/check-in', deps.requireUser, async (c) => {
    const parsed = await parseBody(c, checkInBodySchema);
    if (parsed.isErr()) return parsed.error;
    const body = parsed.value;

    const loc = body.location;
    const location: CheckInLocationInput | undefined =
      loc !== undefined
        ? {
            latitude: loc.latitude,
            longitude: loc.longitude,
            ...(loc.accuracyMeters !== undefined ? { accuracyMeters: loc.accuracyMeters } : {}),
          }
        : undefined;

    const userId = c.get('auth').userId;
    const result = await deps.checkInToDate.execute({
      userId,
      datePlanId: c.req.param('id'),
      ...(location !== undefined ? { location } : {}),
    });
    return sendResult(c, result.map(safetyCheckInToDto), 201);
  });

  routes.post('/me/dates/:id/check-out', deps.requireUser, async (c) => {
    const userId = c.get('auth').userId;
    const result = await deps.checkOutOfDate.execute({
      userId,
      datePlanId: c.req.param('id'),
    });
    return sendResult(c, result.map(safetyCheckInToDto), 200);
  });

  routes.get('/me/dates/:id/check-in', deps.requireUser, async (c) => {
    const userId = c.get('auth').userId;
    const result = await deps.getMyCheckIn.execute({
      userId,
      datePlanId: c.req.param('id'),
    });
    return sendResult(
      c,
      result.map((view): MyCheckInResponse => ({
        checkIn: view === null ? null : safetyCheckInToDto(view),
      })),
    );
  });

  return routes;
}
