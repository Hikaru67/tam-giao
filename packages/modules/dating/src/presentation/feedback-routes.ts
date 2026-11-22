import {
  submitFeedbackBodySchema,
  type MyFeedbackDto,
  type MyFeedbackResponse,
} from '@tamgiao/contracts';
import { parseBody, sendResult, type AppEnv } from '@tamgiao/http';
import { Hono, type MiddlewareHandler } from 'hono';
import type { FeedbackView, GetMyFeedback, SubmitFeedback } from '../application/submit-feedback.js';

export interface FeedbackRoutesDeps {
  readonly submitFeedback: SubmitFeedback;
  readonly getMyFeedback: GetMyFeedback;
  readonly requireUser: MiddlewareHandler<AppEnv>;
}

/**
 * Đánh giá của chính người xem sau buổi gặp mặt → DTO (`Date` → ISO).
 * KHÔNG bao giờ đưa authorId / subjectId để bảo đảm tính riêng tư và tránh lộ thông tin.
 */
export function feedbackToDto(view: FeedbackView): MyFeedbackDto {
  return {
    id: view.id,
    datePlanId: view.datePlanId,
    matchId: view.matchId,
    rating: view.rating,
    profileMatch: view.profileMatch,
    feeling: view.feeling,
    decision: view.decision,
    stopReasons: [...view.stopReasons],
    stopNote: view.stopNote,
    submittedAt: view.submittedAt.toISOString(),
  };
}

/**
 * Route đánh giá kín sau buổi gặp mặt của người dùng app (BE-S7-03), mọi route `requireUser`:
 * - `POST /me/dates/:id/feedback` — gửi đánh giá sau gặp (201).
 * - `GET /me/dates/:id/feedback` — xem lại đánh giá của chính mình (`{feedback: null}` khi chưa gửi).
 *
 * Chỉ trả đánh giá của chính người xem; body chứa PII (ghi chú kín `stopNote`) — không log.
 */
export function createFeedbackRoutes(deps: FeedbackRoutesDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.post('/me/dates/:id/feedback', deps.requireUser, async (c) => {
    const body = await parseBody(c, submitFeedbackBodySchema);
    if (body.isErr()) return body.error;
    const userId = c.get('auth').userId;
    const result = await deps.submitFeedback.execute({
      userId,
      datePlanId: c.req.param('id'),
      answers: body.value,
    });
    return sendResult(c, result.map(feedbackToDto), 201);
  });

  routes.get('/me/dates/:id/feedback', deps.requireUser, async (c) => {
    const userId = c.get('auth').userId;
    const result = await deps.getMyFeedback.execute({
      userId,
      datePlanId: c.req.param('id'),
    });
    return sendResult(
      c,
      result.map((v): MyFeedbackResponse => ({
        feedback: v === null ? null : feedbackToDto(v),
      })),
    );
  });

  return routes;
}
