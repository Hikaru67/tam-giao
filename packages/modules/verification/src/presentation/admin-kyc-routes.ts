import {
  kycMarkStepBodySchema,
  kycQueueQuerySchema,
  kycRejectBodySchema,
  kycRequestMoreInfoBodySchema,
  type KycAdminDecisionResponse,
  type KycAdminDetailResponse,
  type KycQueueResponse,
} from '@tamgiao/contracts';
import {
  parseBody,
  parseQuery,
  problemResponse,
  sendResult,
  type AppEnv,
  type RequireAdmin,
} from '@tamgiao/http';
import { domainError, parseId } from '@tamgiao/kernel';
import { Hono, type Context } from 'hono';
import type { ApproveKyc } from '../application/admin/approve-kyc.js';
import type { AssignReviewer } from '../application/admin/assign-reviewer.js';
import type { GetKycReviewDetail, KycReviewDetailView } from '../application/admin/get-kyc-review-detail.js';
import type { GetKycReviewQueue, KycQueuePage } from '../application/admin/get-kyc-review-queue.js';
import type { MarkStepPassed } from '../application/admin/mark-step-passed.js';
import type { RejectKyc } from '../application/admin/reject-kyc.js';
import type { RequestMoreInfo } from '../application/admin/request-more-info.js';
import type { KycStepView, ReviewActionView, ReviewActor } from '../application/admin/run-review-action.js';
import type { KycQueueCursor } from '../application/ports/kyc-review-queue.js';

export interface AdminKycRoutesDeps {
  readonly getQueue: GetKycReviewQueue;
  readonly getDetail: GetKycReviewDetail;
  readonly assignReviewer: AssignReviewer;
  readonly markStepPassed: MarkStepPassed;
  readonly approveKyc: ApproveKyc;
  readonly rejectKyc: RejectKyc;
  readonly requestMoreInfo: RequestMoreInfo;
  /** Guard admin do module identity cung cấp qua composition root. */
  readonly requireAdmin: RequireAdmin;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Cursor mờ cho client: base64url của `<submittedAt ISO>|<id>`. */
const encodeCursor = (c: KycQueueCursor): string =>
  Buffer.from(`${c.submittedAt.toISOString()}|${c.id}`, 'utf8').toString('base64url');

function decodeCursor(raw: string): KycQueueCursor | null {
  const [iso, id, ...rest] = Buffer.from(raw, 'base64url').toString('utf8').split('|');
  if (iso === undefined || id === undefined || rest.length > 0 || !UUID_PATTERN.test(id)) return null;
  const submittedAt = new Date(iso);
  return Number.isNaN(submittedAt.getTime()) ? null : { submittedAt, id };
}

type EkycCheck = NonNullable<KycReviewDetailView['ekycAssessment']>['ocr'];

const toSteps = (steps: readonly KycStepView[]) =>
  steps.map((s) => ({ step: s.step, status: s.status, decidedAt: s.decidedAt?.toISOString() ?? null }));

const toCheck = (c: EkycCheck) => ({
  status: c.status,
  score: c.status === 'ERROR' ? null : c.score,
  reason: c.status === 'OK' ? null : c.reason,
});

const toQueueResponse = (page: KycQueuePage): KycQueueResponse => ({
  items: page.items.map((i) => ({
    id: i.id,
    userId: i.userId,
    // Hàng chờ không bao giờ chứa `DRAFT` (lọc ở query).
    status: i.status === 'DRAFT' ? 'SUBMITTED' : i.status,
    fullName: i.fullName,
    occupation: i.occupation,
    submittedAt: i.submittedAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
    reviewerId: i.reviewerId,
    flags: [...i.flags],
    steps: toSteps(i.steps),
  })),
  nextCursor: page.nextCursor === null ? null : encodeCursor(page.nextCursor),
});

const toDocument = (d: { readonly url: string; readonly expiresAt: Date } | null) =>
  d && { url: d.url, expiresAt: d.expiresAt.toISOString() };

const toDetailResponse = (v: KycReviewDetailView): KycAdminDetailResponse => ({
  id: v.id,
  userId: v.userId,
  status: v.status,
  version: v.version,
  applicant: { ...v.applicant },
  cccdNumber: v.cccdNumber,
  documents: {
    cccdFront: toDocument(v.documents.cccdFront),
    cccdBack: toDocument(v.documents.cccdBack),
    selfie: toDocument(v.documents.selfie),
    maritalStatusCertificate: toDocument(v.documents.maritalStatusCertificate),
  },
  ekycAssessment: v.ekycAssessment && {
    ocr: toCheck(v.ekycAssessment.ocr),
    liveness: toCheck(v.ekycAssessment.liveness),
    faceMatch: toCheck(v.ekycAssessment.faceMatch),
    profileMismatches: v.ekycAssessment.profileMismatches && [...v.ekycAssessment.profileMismatches],
    assessedAt: v.ekycAssessment.assessedAt.toISOString(),
  },
  flags: [...v.flags],
  steps: toSteps(v.steps),
  reviewerId: v.reviewerId,
  moreInfoRequest: v.moreInfoRequest && {
    items: [...v.moreInfoRequest.items],
    note: v.moreInfoRequest.note,
    requestedAt: v.moreInfoRequest.requestedAt.toISOString(),
  },
  rejection: v.rejection && { ...v.rejection },
  decidedBy: v.decidedBy,
  submittedAt: v.submittedAt?.toISOString() ?? null,
  decidedAt: v.decidedAt?.toISOString() ?? null,
  updatedAt: v.updatedAt.toISOString(),
});

const toDecisionResponse = (v: ReviewActionView): KycAdminDecisionResponse => ({
  id: v.id,
  status: v.status,
  version: v.version,
  steps: toSteps(v.steps),
  reviewerId: v.reviewerId,
  decidedBy: v.decidedBy,
  decidedAt: v.decidedAt?.toISOString() ?? null,
  updatedAt: v.updatedAt.toISOString(),
});

const actorOf = (c: Context<AppEnv>): ReviewActor => {
  const ip = c.get('clientIp');
  return { adminId: c.get('admin').adminId, ip: ip === 'unknown' ? null : ip };
};

const submissionIdOf = (c: Context<AppEnv>) => parseId<'KycSubmission'>(c.req.param('id') ?? '');

/**
 * Route admin "Thẩm định eKYC" (BE-S3-04). Xem (`kyc:review`): hàng chờ, chi tiết (ghi audit), nhận hồ sơ.
 * Quyết định (`kyc:decide`): đánh dấu bước, duyệt, từ chối, yêu cầu bổ sung.
 */
export function createAdminKycRoutes(deps: AdminKycRoutesDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  const canReview = deps.requireAdmin('kyc:review');
  const canDecide = deps.requireAdmin('kyc:decide');

  routes.get('/admin/kyc/submissions', canReview, async (c) => {
    const query = parseQuery(c, kycQueueQuerySchema);
    if (query.isErr()) return query.error;
    const { status, flagged, q, cursor: rawCursor, limit } = query.value;

    const cursor = rawCursor === undefined ? null : decodeCursor(rawCursor);
    if (rawCursor !== undefined && cursor === null) {
      return problemResponse(c, domainError('VALIDATION_FAILED'), {
        errors: [{ path: 'cursor', message: 'cursor không hợp lệ' }],
      });
    }
    const page = await deps.getQueue.execute({
      cursor,
      ...(status === undefined ? {} : { statuses: status }),
      ...(flagged === undefined ? {} : { flagged }),
      ...(q === undefined ? {} : { text: q }),
      ...(limit === undefined ? {} : { limit }),
    });
    return sendResult(c, page.map(toQueueResponse));
  });

  routes.get('/admin/kyc/submissions/:id', canReview, async (c) => {
    const id = submissionIdOf(c);
    if (id.isErr()) return sendResult(c, id);
    const detail = await deps.getDetail.execute({ submissionId: id.value, actor: actorOf(c) });
    return sendResult(c, detail.map(toDetailResponse));
  });

  routes.post('/admin/kyc/submissions/:id/assign', canReview, async (c) => {
    const id = submissionIdOf(c);
    if (id.isErr()) return sendResult(c, id);
    const result = await deps.assignReviewer.execute({ submissionId: id.value, actor: actorOf(c) });
    return sendResult(c, result.map(toDecisionResponse));
  });

  routes.post('/admin/kyc/submissions/:id/steps', canDecide, async (c) => {
    const id = submissionIdOf(c);
    if (id.isErr()) return sendResult(c, id);
    const body = await parseBody(c, kycMarkStepBodySchema);
    if (body.isErr()) return body.error;
    const result = await deps.markStepPassed.execute({
      submissionId: id.value,
      actor: actorOf(c),
      step: body.value.step,
      outcome: body.value.outcome,
    });
    return sendResult(c, result.map(toDecisionResponse));
  });

  routes.post('/admin/kyc/submissions/:id/approve', canDecide, async (c) => {
    const id = submissionIdOf(c);
    if (id.isErr()) return sendResult(c, id);
    const result = await deps.approveKyc.execute({ submissionId: id.value, actor: actorOf(c) });
    return sendResult(c, result.map(toDecisionResponse));
  });

  routes.post('/admin/kyc/submissions/:id/reject', canDecide, async (c) => {
    const id = submissionIdOf(c);
    if (id.isErr()) return sendResult(c, id);
    const body = await parseBody(c, kycRejectBodySchema);
    if (body.isErr()) return body.error;
    const result = await deps.rejectKyc.execute({
      submissionId: id.value,
      actor: actorOf(c),
      reason: { code: body.value.code, note: body.value.note ?? null },
    });
    return sendResult(c, result.map(toDecisionResponse));
  });

  routes.post('/admin/kyc/submissions/:id/request-more-info', canDecide, async (c) => {
    const id = submissionIdOf(c);
    if (id.isErr()) return sendResult(c, id);
    const body = await parseBody(c, kycRequestMoreInfoBodySchema);
    if (body.isErr()) return body.error;
    const result = await deps.requestMoreInfo.execute({
      submissionId: id.value,
      actor: actorOf(c),
      items: body.value.items,
      note: body.value.note ?? null,
    });
    return sendResult(c, result.map(toDecisionResponse));
  });

  return routes;
}
