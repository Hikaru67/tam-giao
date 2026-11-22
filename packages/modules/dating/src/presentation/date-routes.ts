import { proposeDateBodySchema, type CurrentDatePlanResponse, type DatePlanDto } from '@tamgiao/contracts';
import { parseBody, sendResult, type AppEnv } from '@tamgiao/http';
import { Hono, type MiddlewareHandler } from 'hono';
import type { DatePlanView } from '../application/date-plan-views.js';
import type { GetCurrentDatePlan } from '../application/get-current-date-plan.js';
import type { ProposeDate } from '../application/propose-date.js';
import type { CancelDate, ConfirmDate, DeclineDate } from '../application/respond-to-date.js';

export interface DateRoutesDeps {
  readonly proposeDate: ProposeDate;
  readonly confirmDate: ConfirmDate;
  readonly declineDate: DeclineDate;
  readonly cancelDate: CancelDate;
  readonly getCurrentDatePlan: GetCurrentDatePlan;
  readonly requireUser: MiddlewareHandler<AppEnv>;
}

/** Lịch hẹn → DTO nhìn từ người xem (`Date` → ISO). */
export function datePlanToDto(view: DatePlanView, viewerId: string): DatePlanDto {
  return {
    id: view.id,
    matchId: view.matchId,
    inviterId: view.inviterId,
    inviteeId: view.inviteeId,
    myRole: viewerId.toLowerCase() === view.inviterId ? 'INVITER' : 'INVITEE',
    partnerId: view.partnerId,
    startsAt: view.startsAt.toISOString(),
    endsAt: view.endsAt.toISOString(),
    staffBookingRequested: view.staffBookingRequested,
    status: view.status,
    expiresAt: view.expiresAt.toISOString(),
    proposedAt: view.proposedAt.toISOString(),
    respondedAt: view.respondedAt?.toISOString() ?? null,
    cancelledAt: view.cancelledAt?.toISOString() ?? null,
    cancelledBy: view.cancelledBy,
    cancelDeadline: view.cancelDeadline.toISOString(),
  };
}

/**
 * Route đặt lịch gặp mặt của người dùng app (BE-S7-01), mọi route `requireUser`:
 * - `GET /me/dates/current` — lịch mới nhất của match đang mở (`{datePlan: null}` khi không có).
 * - `POST /me/dates` — đề xuất lịch (201).
 * - `POST /me/dates/:id/confirm` | `decline` — người được mời phản hồi.
 * - `POST /me/dates/:id/cancel` — huỷ lịch đã xác nhận (≥ `DATE_CANCEL_CUTOFF_HOURS` giờ trước giờ bắt đầu).
 */
export function createDateRoutes(deps: DateRoutesDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.get('/me/dates/current', deps.requireUser, async (c) => {
    const userId = c.get('auth').userId;
    const result = await deps.getCurrentDatePlan.execute({ userId });
    return sendResult(
      c,
      result.map((view): CurrentDatePlanResponse => ({
        datePlan: view === null ? null : datePlanToDto(view, userId),
      })),
    );
  });

  routes.post('/me/dates', deps.requireUser, async (c) => {
    const body = await parseBody(c, proposeDateBodySchema);
    if (body.isErr()) return body.error;
    const userId = c.get('auth').userId;
    const result = await deps.proposeDate.execute({
      userId,
      partnerId: body.value.partnerId,
      startsAt: new Date(body.value.startsAt),
      endsAt: new Date(body.value.endsAt),
      staffBookingRequested: body.value.staffBookingRequested,
    });
    return sendResult(
      c,
      result.map((view) => datePlanToDto(view, userId)),
      201,
    );
  });

  const actions = { confirm: deps.confirmDate, decline: deps.declineDate, cancel: deps.cancelDate } as const;
  for (const [name, useCase] of Object.entries(actions)) {
    routes.post(`/me/dates/:id/${name}`, deps.requireUser, async (c) => {
      const userId = c.get('auth').userId;
      const result = await useCase.execute({ userId, datePlanId: c.req.param('id') });
      return sendResult(
        c,
        result.map((view) => datePlanToDto(view, userId)),
      );
    });
  }

  return routes;
}
