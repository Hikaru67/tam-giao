import {
  adminInterviewSlotsQuerySchema,
  bookInterviewBodySchema,
  interviewSlotsQuerySchema,
  openInterviewSlotBodySchema,
  recordInterviewResultBodySchema,
  type AdminInterviewSlot,
  type AdminInterviewSlotListResponse,
  type AvailableInterviewSlotListResponse,
  type MyInterviewResponse,
} from '@tamgiao/contracts';
import { parseBody, parseQuery, sendResult, type AppEnv, type RequireAdmin } from '@tamgiao/http';
import { ok } from '@tamgiao/kernel';
import { Hono, type MiddlewareHandler } from 'hono';
import type { BookInterview } from '../application/interview/book-interview.js';
import type { CancelInterview } from '../application/interview/cancel-interview.js';
import type {
  GetMyInterview,
  ListAvailableInterviewSlots,
  ListInterviewSlots,
} from '../application/interview/interview-queries.js';
import type { InterviewSlotView, MyInterviewView } from '../application/interview/interview-views.js';
import type { OpenInterviewSlot } from '../application/interview/open-interview-slot.js';
import type { RecordInterviewResult } from '../application/interview/record-interview-result.js';
import type { RescheduleInterview } from '../application/interview/reschedule-interview.js';

export interface InterviewRoutesDeps {
  readonly openSlot: OpenInterviewSlot;
  readonly listSlots: ListInterviewSlots;
  readonly listAvailable: ListAvailableInterviewSlots;
  readonly getMine: GetMyInterview;
  readonly book: BookInterview;
  readonly reschedule: RescheduleInterview;
  readonly cancel: CancelInterview;
  readonly recordResult: RecordInterviewResult;
  readonly requireUser: MiddlewareHandler<AppEnv>;
  readonly requireAdmin: RequireAdmin;
}

/** Permission xem/thao tác hàng chờ thẩm định — dùng cho mở slot, nhật ký và ghi kết quả phỏng vấn. */
const INTERVIEW_PERMISSION = 'kyc:review';

const iso = (d: Date | null): string | null => d?.toISOString() ?? null;

const toMine = (v: MyInterviewView | null): MyInterviewResponse => ({
  booking: v && {
    slotId: v.slotId,
    startsAt: v.startsAt.toISOString(),
    endsAt: v.endsAt.toISOString(),
    meetingUrl: v.meetingUrl,
    changeDeadline: v.changeDeadline.toISOString(),
    canChange: v.canChange,
  },
});

const toAdmin = (s: InterviewSlotView): AdminInterviewSlot => ({
  id: s.id,
  interviewerId: s.interviewerId,
  startsAt: s.startsAt.toISOString(),
  endsAt: s.endsAt.toISOString(),
  meetingUrl: s.meetingUrl,
  status: s.status,
  bookedBy: s.bookedBy,
  bookedAt: iso(s.bookedAt),
  outcome: s.outcome,
  notes: s.notes,
  recordedBy: s.recordedBy,
  recordedAt: iso(s.recordedAt),
  createdAt: s.createdAt.toISOString(),
});

/**
 * Phỏng vấn sơ bộ 15 phút (BE-S3-05): người dùng xem slot trống / đặt / đổi / huỷ (màn 6); chuyên viên mở slot,
 * xem nhật ký, ghi nhận xét + kết quả. Nhận xét không bao giờ được log.
 */
export function createInterviewRoutes(deps: InterviewRoutesDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  const admin = deps.requireAdmin(INTERVIEW_PERMISSION);

  // ── Người dùng app ──────────────────────────────────────────────────────────────────────────────
  routes.get('/me/kyc/interview/slots', deps.requireUser, async (c) => {
    const query = parseQuery(c, interviewSlotsQuerySchema);
    if (query.isErr()) return query.error;
    const { from, limit } = query.value;
    const items = await deps.listAvailable.execute({
      limit,
      ...(from === undefined ? {} : { from: new Date(from) }),
    });
    const body: AvailableInterviewSlotListResponse = {
      items: items.map((s) => ({
        id: s.id,
        startsAt: s.startsAt.toISOString(),
        endsAt: s.endsAt.toISOString(),
      })),
    };
    return sendResult(c, ok(body));
  });

  routes.get('/me/kyc/interview', deps.requireUser, async (c) => {
    return sendResult(c, ok(toMine(await deps.getMine.execute(c.get('auth').userId))));
  });

  routes.post('/me/kyc/interview', deps.requireUser, async (c) => {
    const body = await parseBody(c, bookInterviewBodySchema);
    if (body.isErr()) return body.error;
    const result = await deps.book.execute({ userId: c.get('auth').userId, slotId: body.value.slotId });
    return sendResult(c, result.map(toMine), 201);
  });

  routes.put('/me/kyc/interview', deps.requireUser, async (c) => {
    const body = await parseBody(c, bookInterviewBodySchema);
    if (body.isErr()) return body.error;
    const result = await deps.reschedule.execute({ userId: c.get('auth').userId, slotId: body.value.slotId });
    return sendResult(c, result.map(toMine));
  });

  routes.delete('/me/kyc/interview', deps.requireUser, async (c) => {
    const result = await deps.cancel.execute({ userId: c.get('auth').userId });
    return sendResult(
      c,
      result.map(() => toMine(null)),
    );
  });

  // ── Chuyên viên ─────────────────────────────────────────────────────────────────────────────────
  routes.post('/admin/kyc/interview/slots', admin, async (c) => {
    const body = await parseBody(c, openInterviewSlotBodySchema);
    if (body.isErr()) return body.error;
    const result = await deps.openSlot.execute({
      interviewerId: c.get('admin').adminId,
      startsAt: new Date(body.value.startsAt),
      meetingUrl: body.value.meetingUrl ?? null,
    });
    return sendResult(c, result.map(toAdmin), 201);
  });

  routes.get('/admin/kyc/interview/slots', admin, async (c) => {
    const query = parseQuery(c, adminInterviewSlotsQuerySchema);
    if (query.isErr()) return query.error;
    const { status, from, to, limit } = query.value;
    const items = await deps.listSlots.execute({
      limit,
      ...(status === undefined ? {} : { status }),
      ...(from === undefined ? {} : { from: new Date(from) }),
      ...(to === undefined ? {} : { to: new Date(to) }),
    });
    const body: AdminInterviewSlotListResponse = { items: items.map(toAdmin) };
    return sendResult(c, ok(body));
  });

  routes.put('/admin/kyc/interview/:id/notes', admin, async (c) => {
    const body = await parseBody(c, recordInterviewResultBodySchema);
    if (body.isErr()) return body.error;
    const result = await deps.recordResult.execute({
      slotId: c.req.param('id'),
      reviewerId: c.get('admin').adminId,
      outcome: body.value.outcome,
      notes: body.value.notes,
    });
    return sendResult(c, result.map(toAdmin));
  });

  return routes;
}
