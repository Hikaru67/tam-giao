import { useId, useState } from 'react';
import { isApiError, messageFor } from '@tamgiao/api-client';
import { useApiClient } from '@tamgiao/api-client/react';
import type { KycAdminStatus } from '@tamgiao/contracts/verification';
import { useQuery } from '@tanstack/react-query';
import { useRouteContext } from '@tanstack/react-router';
import { Badge, Button, Card, ErrorState, type BadgeTone } from '@tamgiao/ui-web';
import { hasPermission } from '../auth/permissions';
import { KYC_COPY } from './copy';
import { formatBirthDate, formatDateTime } from './format';
import { isKycConflictError, kycDetailQueryOptions, useKycDecision, type KycDecisionInput } from './kyc-api';
import { KycDecisionBar } from './kyc-decision-bar';
import { KycDocumentImage } from './kyc-document-image';

const STATUS_BADGE_TONE = {
  SUBMITTED: 'primary',
  UNDER_REVIEW: 'neutral',
  NEEDS_MORE_INFO: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  DRAFT: 'neutral',
} as const satisfies Record<KycAdminStatus | 'DRAFT', BadgeTone>;

export interface KycDetailPanelProps {
  readonly submissionId: string;
}

export function KycDetailPanel({ submissionId }: KycDetailPanelProps) {
  const client = useApiClient();
  const query = useQuery(kycDetailQueryOptions(client, submissionId));
  const decision = useKycDecision(submissionId);
  const me = useRouteContext({ from: '/_authed', select: (c) => c.me });
  const canDecide = hasPermission(me, 'kyc:decide');

  const [feedback, setFeedback] = useState<{ tone: 'success' | 'danger'; message: string } | null>(null);

  const applicantHeadingId = useId();
  const documentsHeadingId = useId();
  const ekycHeadingId = useId();
  const flagsHeadingId = useId();
  const stepsHeadingId = useId();
  const moreInfoHeadingId = useId();
  const rejectionHeadingId = useId();

  const runDecision = (input: KycDecisionInput, onDone?: () => void) => {
    setFeedback(null);
    decision.mutate(input, {
      onSuccess: () => {
        setFeedback({ tone: 'success', message: KYC_COPY.decisions.success[input.kind] });
        onDone?.();
      },
      onError: (error) => {
        if (isKycConflictError(error)) {
          setFeedback({ tone: 'danger', message: KYC_COPY.decisions.conflict });
        } else {
          const m = messageFor(isApiError(error) ? error : { code: 'UNKNOWN' });
          setFeedback({
            tone: 'danger',
            message: m.action ? `${m.title} ${m.action}` : m.title,
          });
        }
        onDone?.();
      },
    });
  };

  if (query.data === undefined && query.isLoading) {
    return (
      <Card className="p-space-lg flex justify-center">
        <div aria-busy="true" className="text-body-sm text-secondary" />
      </Card>
    );
  }

  if (query.data === undefined && query.isError) {
    return (
      <Card>
        <ErrorState
          title={messageFor(isApiError(query.error) ? query.error : { code: 'UNKNOWN' }).title}
          action={KYC_COPY.detail.retry}
          onRetry={() => void query.refetch()}
        />
      </Card>
    );
  }

  if (query.data === undefined) {
    return null;
  }

  const d = query.data;
  const ekyc = d.ekycAssessment;
  const isDecided = d.status === 'APPROVED' || d.status === 'REJECTED';
  const isOpen = d.status === 'SUBMITTED' || d.status === 'UNDER_REVIEW' || d.status === 'NEEDS_MORE_INFO';
  const isTakenByOther = d.reviewerId !== null && d.reviewerId !== me.adminId && !isDecided;

  return (
    <Card className="select-none flex flex-col gap-space-lg">
      <div className="flex flex-wrap items-center justify-between gap-space-sm">
        <h2 className="text-headline-sm font-bold text-on-surface">
          {d.applicant.fullName ?? KYC_COPY.queue.noName}
        </h2>
        <Badge tone={STATUS_BADGE_TONE[d.status]}>{KYC_COPY.status[d.status]}</Badge>
      </div>

      {isTakenByOther ? (
        <p
          role="note"
          className="p-space-sm rounded-lg bg-tertiary-fixed text-on-tertiary-fixed text-body-sm font-medium"
        >
          {KYC_COPY.detail.takenByOther}
        </p>
      ) : null}

      <section aria-labelledby={applicantHeadingId} className="flex flex-col gap-space-sm">
        <h3 id={applicantHeadingId} className="text-title-md font-semibold text-on-surface">
          {KYC_COPY.detail.applicantSection}
        </h3>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-space-sm">
          <div>
            <dt className="text-body-sm text-secondary">{KYC_COPY.detail.fullName}</dt>
            <dd className="text-body-md font-medium text-on-surface">
              {d.applicant.fullName ?? KYC_COPY.detail.notProvided}
            </dd>
          </div>
          <div>
            <dt className="text-body-sm text-secondary">{KYC_COPY.detail.birthDate}</dt>
            <dd className="text-body-md font-medium text-on-surface">
              {d.applicant.birthDate ? formatBirthDate(d.applicant.birthDate) : KYC_COPY.detail.notProvided}
            </dd>
          </div>
          <div>
            <dt className="text-body-sm text-secondary">{KYC_COPY.detail.occupation}</dt>
            <dd className="text-body-md font-medium text-on-surface">
              {d.applicant.occupation ?? KYC_COPY.detail.notProvided}
            </dd>
          </div>
          <div>
            <dt className="text-body-sm text-secondary">{KYC_COPY.detail.cccdNumber}</dt>
            <dd className="text-body-md font-medium text-on-surface">
              {d.cccdNumber ?? KYC_COPY.detail.cccdUnreadable}
            </dd>
          </div>
          <div>
            <dt className="text-body-sm text-secondary">{KYC_COPY.detail.submittedAt}</dt>
            <dd className="text-body-md font-medium text-on-surface">
              {d.submittedAt ? formatDateTime(d.submittedAt) : KYC_COPY.detail.notProvided}
            </dd>
          </div>
          <div>
            <dt className="text-body-sm text-secondary">{KYC_COPY.detail.reviewer}</dt>
            <dd className="text-body-md font-medium text-on-surface">
              {d.reviewerId === me.adminId
                ? KYC_COPY.detail.reviewerMe
                : d.reviewerId !== null
                  ? KYC_COPY.detail.reviewerOther
                  : KYC_COPY.detail.reviewerNone}
            </dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby={documentsHeadingId} className="flex flex-col gap-space-sm">
        <h3 id={documentsHeadingId} className="text-title-md font-semibold text-on-surface">
          {KYC_COPY.detail.documentsSection}
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-space-md">
          {(['cccdFront', 'cccdBack', 'selfie', 'maritalStatusCertificate'] as const).map((k) => (
            <KycDocumentImage
              key={k}
              label={KYC_COPY.detail.documents[k]}
              document={d.documents[k]}
              fetchedAt={query.dataUpdatedAt}
              onRequestNewUrl={() => void query.refetch()}
            />
          ))}
        </div>
      </section>

      <section aria-labelledby={ekycHeadingId} className="flex flex-col gap-space-sm">
        <h3 id={ekycHeadingId} className="text-title-md font-semibold text-on-surface">
          {KYC_COPY.detail.ekycSection}
        </h3>
        {ekyc === null ? (
          <p className="text-body-md text-secondary">{KYC_COPY.detail.ekycMissing}</p>
        ) : (
          <div className="flex flex-col gap-space-xs">
            {(['ocr', 'liveness', 'faceMatch'] as const).map((checkKey) => {
              const check = ekyc[checkKey];
              const tone: BadgeTone =
                check.status === 'OK' ? 'success' : check.status === 'REJECTED' ? 'danger' : 'warning';
              return (
                <div
                  key={checkKey}
                  className="flex items-center justify-between gap-space-xs py-space-xs border-b border-surface-container-high last:border-b-0"
                >
                  <span className="text-body-md text-on-surface">{KYC_COPY.detail.ekycChecks[checkKey]}</span>
                  <div className="flex items-center gap-space-xs">
                    {check.score !== null ? (
                      <span className="text-body-sm text-secondary">
                        {KYC_COPY.detail.ekycScore} {Math.round(check.score * 100)}%
                      </span>
                    ) : null}
                    <Badge tone={tone}>{KYC_COPY.detail.ekycCheckStatus[check.status]}</Badge>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {d.flags.length > 0 ? (
        <section aria-labelledby={flagsHeadingId} className="flex flex-col gap-space-xs">
          <h3 id={flagsHeadingId} className="text-title-md font-semibold text-on-surface">
            {KYC_COPY.detail.flagsSection}
          </h3>
          <div className="flex flex-wrap gap-space-xs">
            {d.flags.map((flag) => (
              <Badge key={flag} tone="danger">
                {KYC_COPY.flags[flag]}
              </Badge>
            ))}
          </div>
        </section>
      ) : null}

      <section aria-labelledby={stepsHeadingId} className="flex flex-col gap-space-sm">
        <h3 id={stepsHeadingId} className="text-title-md font-semibold text-on-surface">
          {KYC_COPY.detail.stepsSection}
        </h3>
        <ul className="flex flex-col gap-space-sm">
          {d.steps.map((s) => {
            const tone: BadgeTone =
              s.status === 'PASSED' ? 'success' : s.status === 'FAILED' ? 'danger' : 'neutral';
            return (
              <li
                key={s.step}
                className="flex flex-wrap items-center justify-between gap-space-xs p-space-sm rounded-lg bg-surface-container-low border border-surface-container-high"
              >
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-space-xs">
                    <span className="text-title-md font-semibold text-on-surface">
                      {KYC_COPY.steps[s.step]}
                    </span>
                    <Badge tone={tone}>{KYC_COPY.stepStatus[s.status]}</Badge>
                  </div>
                  {s.decidedAt ? (
                    <span className="text-body-sm text-secondary">{formatDateTime(s.decidedAt)}</span>
                  ) : null}
                </div>

                {canDecide && isOpen ? (
                  <div className="flex items-center gap-space-xs">
                    <Button
                      size="md"
                      variant="secondary"
                      aria-label={`${KYC_COPY.detail.stepPass}: ${KYC_COPY.steps[s.step]}`}
                      disabled={decision.isPending}
                      onClick={() =>
                        runDecision({
                          kind: 'markStep',
                          body: { step: s.step, outcome: 'PASSED' },
                        })
                      }
                    >
                      {KYC_COPY.detail.stepPass}
                    </Button>
                    <Button
                      size="md"
                      variant="ghost"
                      aria-label={`${KYC_COPY.detail.stepFail}: ${KYC_COPY.steps[s.step]}`}
                      disabled={decision.isPending}
                      onClick={() =>
                        runDecision({
                          kind: 'markStep',
                          body: { step: s.step, outcome: 'FAILED' },
                        })
                      }
                    >
                      {KYC_COPY.detail.stepFail}
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      {d.moreInfoRequest !== null ? (
        <section aria-labelledby={moreInfoHeadingId} className="flex flex-col gap-space-xs">
          <h3 id={moreInfoHeadingId} className="text-title-md font-semibold text-on-surface">
            {KYC_COPY.detail.moreInfoSection}
          </h3>
          <ul className="flex flex-wrap gap-space-xs">
            {d.moreInfoRequest.items.map((item) => (
              <li key={item}>
                <Badge tone="warning">{KYC_COPY.moreInfoItems[item]}</Badge>
              </li>
            ))}
          </ul>
          {d.moreInfoRequest.note ? (
            <p className="text-body-sm text-secondary">
              {KYC_COPY.detail.note}: {d.moreInfoRequest.note}
            </p>
          ) : null}
        </section>
      ) : null}

      {d.rejection !== null ? (
        <section aria-labelledby={rejectionHeadingId} className="flex flex-col gap-space-xs">
          <h3 id={rejectionHeadingId} className="text-title-md font-semibold text-on-surface">
            {KYC_COPY.detail.rejectionSection}
          </h3>
          <p className="text-body-md text-error font-medium">{KYC_COPY.rejectionReasons[d.rejection.code]}</p>
          {d.rejection.note ? (
            <p className="text-body-sm text-secondary">
              {KYC_COPY.detail.note}: {d.rejection.note}
            </p>
          ) : null}
        </section>
      ) : null}

      <div className="flex flex-col gap-space-md">
        {feedback ? (
          feedback.tone === 'success' ? (
            <p
              role="status"
              className="p-space-sm rounded-lg bg-secondary-container text-on-secondary-container text-body-md font-medium"
            >
              {feedback.message}
            </p>
          ) : (
            <p
              role="alert"
              className="p-space-sm rounded-lg bg-error-container text-on-error-container text-body-md font-medium"
            >
              {feedback.message}
            </p>
          )
        ) : null}

        <KycDecisionBar
          detail={d}
          meAdminId={me.adminId}
          canDecide={canDecide}
          pending={decision.isPending}
          onDecision={runDecision}
        />
      </div>
    </Card>
  );
}
