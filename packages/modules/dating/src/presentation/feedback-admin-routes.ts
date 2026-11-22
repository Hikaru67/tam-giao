import {
  appearanceFlagQueueQuerySchema,
  type AdminFeedbackDetailResponse,
  type AppearanceFlagQueueResponse,
} from '@tamgiao/contracts';
import { parseQuery, sendResult, type AppEnv, type RequireAdmin } from '@tamgiao/http';
import { Hono, type Context } from 'hono';
import type {
  DatingAdminActor,
  GetFeedbackDetail,
  ListAppearanceFlags,
} from '../application/feedback-admin.js';
import { feedbackToDto } from './feedback-routes.js';

export interface FeedbackAdminRoutesDeps {
  readonly listAppearanceFlags: ListAppearanceFlags;
  readonly getFeedbackDetail: GetFeedbackDetail;
  readonly requireAdmin: RequireAdmin;
}

/**
 * Chuyên viên thẩm định eKYC đối soát ngoại hình với hồ sơ eKYC; không thêm permission mới.
 */
const FEEDBACK_REVIEW_PERMISSION = 'kyc:review';

const actorOf = (c: Context<AppEnv>): DatingAdminActor => {
  const clientIp = c.get('clientIp');
  return {
    adminId: c.get('admin').adminId,
    ip: clientIp === 'unknown' ? null : clientIp,
  };
};

/**
 * Route admin duyệt cờ đối soát ngoại hình và xem chi tiết đánh giá kín sau buổi gặp (BE-S7-03):
 * - `GET /admin/dating/appearance-flags` — hàng chờ cờ "Có khác biệt so với eKYC" (mới nhất trước).
 * - `GET /admin/dating/feedbacks/:id` — xem toàn bộ chi tiết đánh giá (kể cả ghi chú kín, ghi audit).
 * Response chứa PII (ghi chú kín của người gửi) — không log.
 */
export function createFeedbackAdminRoutes(deps: FeedbackAdminRoutesDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  const admin = deps.requireAdmin(FEEDBACK_REVIEW_PERMISSION);

  routes.get('/admin/dating/appearance-flags', admin, async (c) => {
    const query = parseQuery(c, appearanceFlagQueueQuerySchema);
    if (query.isErr()) return query.error;
    const { limit, offset } = query.value;
    const result = await deps.listAppearanceFlags.execute({
      ...(limit === undefined ? {} : { limit }),
      ...(offset === undefined ? {} : { offset }),
    });
    return sendResult(
      c,
      result.map((page): AppearanceFlagQueueResponse => ({
        total: page.total,
        items: page.items.map((i) => ({
          feedbackId: i.feedbackId,
          matchId: i.matchId,
          datePlanId: i.datePlanId,
          authorId: i.authorId,
          subjectId: i.subjectId,
          submittedAt: i.submittedAt.toISOString(),
        })),
      })),
    );
  });

  routes.get('/admin/dating/feedbacks/:id', admin, async (c) => {
    const actor = actorOf(c);
    const result = await deps.getFeedbackDetail.execute({
      feedbackId: c.req.param('id'),
      actor,
    });
    return sendResult(
      c,
      result.map((view): AdminFeedbackDetailResponse => ({
        ...feedbackToDto(view),
        authorId: view.authorId,
        subjectId: view.subjectId,
      })),
    );
  });

  return routes;
}
