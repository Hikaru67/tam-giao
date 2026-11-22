import { http, HttpResponse } from 'msw';
import { TEST_API_URL } from '@tamgiao/api-client/mocks';
import { PRESIGNED_URL_TTL_SECONDS } from '@tamgiao/contracts/constants';
import {
  KYC_STEP_NAMES,
  type KYC_STEP_STATUS_VALUES,
  type KycAdminDecisionResponse,
  type KycAdminDetailResponse,
  type KycQueueItem,
  type KycQueueResponse,
} from '@tamgiao/contracts/verification';

export const SUBMISSION_ID_1 = '0193a4f2-8000-7a1b-8c2d-000000000001';
export const SUBMISSION_ID_2 = '0193a4f2-8000-7a1b-8c2d-000000000002';
export const SUBMISSION_ID_3 = '0193a4f2-8000-7a1b-8c2d-000000000003';
export const USER_ID_1 = '0193a4f2-9000-7a1b-8c2d-000000000001';
export const USER_ID_2 = '0193a4f2-9000-7a1b-8c2d-000000000002';
export const USER_ID_3 = '0193a4f2-9000-7a1b-8c2d-000000000003';
export const OTHER_ADMIN_ID = '0193a4f2-7c3e-7b1a-9f2d-000000000099';

type KycStepStatus = (typeof KYC_STEP_STATUS_VALUES)[number];

const DEFAULT_PENDING_STATUS: KycStepStatus = 'PENDING';
const DEFAULT_PASSED_STATUS: KycStepStatus = 'PASSED';

export function kycQueueItem(overrides?: Partial<KycQueueItem>): KycQueueItem {
  return {
    id: SUBMISSION_ID_1,
    userId: USER_ID_1,
    status: 'SUBMITTED',
    fullName: 'Nguyễn Thị Lan',
    occupation: 'Kế toán',
    submittedAt: '2026-11-20T02:00:00.000Z',
    updatedAt: '2026-11-20T02:00:00.000Z',
    reviewerId: null,
    flags: [],
    steps: KYC_STEP_NAMES.map((step) => ({
      step,
      status: DEFAULT_PENDING_STATUS,
      decidedAt: null,
    })),
    ...overrides,
  };
}

export function kycDetail(overrides?: Partial<KycAdminDetailResponse>): KycAdminDetailResponse {
  const expiresAt = new Date(Date.now() + PRESIGNED_URL_TTL_SECONDS * 1000).toISOString();
  return {
    id: SUBMISSION_ID_1,
    userId: USER_ID_1,
    status: 'UNDER_REVIEW',
    version: 3,
    applicant: {
      fullName: 'Nguyễn Thị Lan',
      birthDate: '1995-04-12',
      occupation: 'Kế toán',
    },
    cccdNumber: '079095001234',
    documents: {
      cccdFront: {
        url: 'https://storage.test/kyc/cccdFront?sig=v1',
        expiresAt,
      },
      cccdBack: {
        url: 'https://storage.test/kyc/cccdBack?sig=v1',
        expiresAt,
      },
      selfie: {
        url: 'https://storage.test/kyc/selfie?sig=v1',
        expiresAt,
      },
      maritalStatusCertificate: {
        url: 'https://storage.test/kyc/maritalStatusCertificate?sig=v1',
        expiresAt,
      },
    },
    ekycAssessment: {
      ocr: { status: 'OK', score: 0.97, reason: null },
      liveness: { status: 'OK', score: 0.95, reason: null },
      faceMatch: { status: 'OK', score: 0.93, reason: null },
      profileMismatches: [],
      assessedAt: '2026-11-20T02:00:00.000Z',
    },
    flags: [],
    steps: KYC_STEP_NAMES.map((step) => ({
      step,
      status: DEFAULT_PENDING_STATUS,
      decidedAt: null,
    })),
    reviewerId: null,
    moreInfoRequest: null,
    rejection: null,
    decidedBy: null,
    submittedAt: '2026-11-20T02:00:00.000Z',
    decidedAt: null,
    updatedAt: '2026-11-20T02:00:00.000Z',
    ...overrides,
  };
}

export function allStepsPassed(): KycAdminDetailResponse['steps'] {
  return KYC_STEP_NAMES.map((step) => ({
    step,
    status: DEFAULT_PASSED_STATUS,
    decidedAt: '2026-11-20T02:05:00.000Z',
  }));
}

export function decisionFrom(
  detail: KycAdminDetailResponse,
  overrides?: Partial<KycAdminDecisionResponse>,
): KycAdminDecisionResponse {
  return {
    id: detail.id,
    status: detail.status,
    version: detail.version,
    steps: detail.steps,
    reviewerId: detail.reviewerId,
    decidedBy: detail.decidedBy,
    decidedAt: detail.decidedAt,
    updatedAt: detail.updatedAt,
    ...overrides,
  };
}

export function kycQueueHandler(pages: Record<string, KycQueueResponse>, onRequest?: (url: URL) => void) {
  return http.get(`${TEST_API_URL}/admin/kyc/submissions`, ({ request }) => {
    const url = new URL(request.url);
    onRequest?.(url);
    const cursor = url.searchParams.get('cursor');
    const pageKey = cursor ?? 'first';
    const page = pages[pageKey] ?? { items: [], nextCursor: null };
    return HttpResponse.json(page);
  });
}

export function emptyKycQueueHandler() {
  return http.get(`${TEST_API_URL}/admin/kyc/submissions`, () => {
    return HttpResponse.json({ items: [], nextCursor: null });
  });
}
