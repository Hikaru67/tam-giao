import { isApiError, messageFor } from '@tamgiao/api-client';
import { useApiClient } from '@tamgiao/api-client/react';
import { useQuery } from '@tanstack/react-query';
import { FEEDBACK_RATING_MAX, type FEEDBACK_PROFILE_MATCH_NAMES } from '@tamgiao/contracts/dating';
import { Badge, Card, ErrorState, type BadgeTone } from '@tamgiao/ui-web';
import { formatDateTime } from '../kyc/format';
import { APPEARANCE_FLAGS_COPY } from './copy';
import { feedbackDetailQueryOptions } from './operations-api';

const PROFILE_MATCH_TONE = {
  FULL_MATCH: 'success',
  MOSTLY_MATCH: 'warning',
  DIFFERENT: 'danger',
} as const satisfies Record<(typeof FEEDBACK_PROFILE_MATCH_NAMES)[number], BadgeTone>;

export interface FeedbackDetailPanelProps {
  feedbackId: string;
}

export function FeedbackDetailPanel({ feedbackId }: FeedbackDetailPanelProps) {
  const client = useApiClient();

  const { data, isLoading, error, refetch } = useQuery(feedbackDetailQueryOptions(client, feedbackId));

  if (isLoading) {
    return (
      <Card className="flex justify-center items-center py-space-xl">
        <span
          className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent"
          aria-hidden="true"
        />
      </Card>
    );
  }

  if (data === undefined) {
    return (
      <Card>
        <ErrorState
          title={messageFor(isApiError(error) ? error : { code: 'UNKNOWN' }).title}
          onRetry={() => void refetch()}
        />
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-space-lg">
      {/* Cảnh báo bảo mật bắt buộc */}
      <div className="p-space-md rounded-lg bg-tertiary-fixed/30 border border-tertiary-fixed flex items-center gap-space-sm">
        <Badge tone="warning">{APPEARANCE_FLAGS_COPY.confidentialWarning}</Badge>
      </div>

      {/* Thông tin đối soát */}
      <div className="flex flex-col gap-space-sm">
        <h3 className="text-title-md font-bold text-on-surface border-b border-surface-container-high pb-space-xs">
          {APPEARANCE_FLAGS_COPY.sectionGeneral}
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-space-md text-body-sm">
          <div>
            <span className="text-secondary block">{APPEARANCE_FLAGS_COPY.flagId}</span>
            <span className="font-mono font-medium text-on-surface">{data.id}</span>
          </div>
          <div>
            <span className="text-secondary block">{APPEARANCE_FLAGS_COPY.subjectId}</span>
            <span className="font-mono font-medium text-on-surface">{data.subjectId}</span>
          </div>
          <div>
            <span className="text-secondary block">{APPEARANCE_FLAGS_COPY.authorId}</span>
            <span className="font-mono text-on-surface">{data.authorId}</span>
          </div>
          <div>
            <span className="text-secondary block">{APPEARANCE_FLAGS_COPY.matchId}</span>
            <span className="font-mono text-on-surface">{data.matchId}</span>
          </div>
          <div>
            <span className="text-secondary block">{APPEARANCE_FLAGS_COPY.datePlanId}</span>
            <span className="font-mono text-on-surface">{data.datePlanId}</span>
          </div>
          <div>
            <span className="text-secondary block">{APPEARANCE_FLAGS_COPY.submittedAt}</span>
            <span className="text-on-surface">{formatDateTime(data.submittedAt)}</span>
          </div>
        </div>
      </div>

      {/* Đánh giá sau buổi gặp */}
      <div className="flex flex-col gap-space-sm">
        <h3 className="text-title-md font-bold text-on-surface border-b border-surface-container-high pb-space-xs">
          {APPEARANCE_FLAGS_COPY.sectionEvaluation}
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-space-md text-body-sm">
          <div>
            <span className="text-secondary block mb-1">{APPEARANCE_FLAGS_COPY.profileMatchLabel}</span>
            <Badge tone={PROFILE_MATCH_TONE[data.profileMatch]}>
              {APPEARANCE_FLAGS_COPY.profileMatches[data.profileMatch]}
            </Badge>
          </div>

          <div>
            <span className="text-secondary block mb-1">{APPEARANCE_FLAGS_COPY.ratingLabel}</span>
            <span className="font-semibold text-on-surface text-body-md">
              {data.rating}/{FEEDBACK_RATING_MAX}
            </span>
          </div>

          <div>
            <span className="text-secondary block mb-1">{APPEARANCE_FLAGS_COPY.feelingLabel}</span>
            <span className="font-medium text-on-surface">
              {APPEARANCE_FLAGS_COPY.feelings[data.feeling]}
            </span>
          </div>

          <div>
            <span className="text-secondary block mb-1">{APPEARANCE_FLAGS_COPY.decisionLabel}</span>
            <Badge tone={data.decision === 'A_COMMIT' ? 'success' : 'neutral'}>
              {APPEARANCE_FLAGS_COPY.decisions[data.decision]}
            </Badge>
          </div>
        </div>
      </div>

      {/* Lý do dừng tìm hiểu nếu có */}
      {data.decision === 'B_STOP' ? (
        <div className="flex flex-col gap-space-sm">
          <h3 className="text-title-md font-bold text-on-surface border-b border-surface-container-high pb-space-xs">
            {APPEARANCE_FLAGS_COPY.sectionDecision}
          </h3>

          {data.stopReasons.length > 0 ? (
            <div>
              <span className="text-secondary block mb-space-xs text-body-sm">
                {APPEARANCE_FLAGS_COPY.stopReasonsLabel}
              </span>
              <div className="flex flex-wrap gap-space-xs">
                {data.stopReasons.map((reason) => (
                  <Badge key={reason} tone="neutral">
                    {APPEARANCE_FLAGS_COPY.stopReasons[reason]}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}

          {data.stopNote ? (
            <div className="mt-space-xs">
              <span className="text-secondary block mb-1 text-body-sm">
                {APPEARANCE_FLAGS_COPY.stopNoteLabel}
              </span>
              <p className="p-space-md rounded-md bg-surface-container-low border border-surface-container-high text-body-md text-on-surface whitespace-pre-wrap">
                {data.stopNote}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
