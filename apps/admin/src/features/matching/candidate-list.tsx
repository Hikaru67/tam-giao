import type { AdminCandidateDto } from '@tamgiao/contracts/matching';
import { Avatar, Badge } from '@tamgiao/ui-web';
import { MATCHING_COPY } from './copy';

export interface CandidateListProps {
  readonly candidates: readonly AdminCandidateDto[];
  readonly selectedCandidateId: string | null;
  readonly onSelectCandidate: (candidate: AdminCandidateDto) => void;
  readonly ineligible: ReadonlyMap<string, string>;
  readonly userABlocked?: boolean;
}

export function CandidateList({
  candidates,
  selectedCandidateId,
  onSelectCandidate,
  ineligible,
  userABlocked = false,
}: CandidateListProps) {
  if (candidates.length === 0) {
    return (
      <div className="p-space-lg text-center rounded-xl border border-surface-container-high bg-surface-container-lowest">
        <h4 className="text-title-md font-bold text-on-surface">{MATCHING_COPY.propose.candidatesEmpty}</h4>
        <p className="text-body-sm text-secondary mt-space-xs">{MATCHING_COPY.propose.candidatesEmptyDesc}</p>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col gap-space-sm"
      role="radiogroup"
      aria-label={MATCHING_COPY.propose.candidatesSection}
    >
      {candidates.map((candidate) => {
        const profile = candidate.profile;
        const candidateIneligibleReason = ineligible.get(candidate.userId);
        const isMissingProfile = profile === null;
        const isDisabled = userABlocked || Boolean(candidateIneligibleReason) || isMissingProfile;
        const isSelected = selectedCandidateId === candidate.userId;

        const reasonText = candidateIneligibleReason
          ? candidateIneligibleReason
          : isMissingProfile
            ? MATCHING_COPY.propose.candidateProfileMissing
            : null;

        const reasonId = `ineligible-reason-${candidate.userId}`;

        return (
          <label
            key={candidate.userId}
            className={`flex flex-col sm:flex-row sm:items-center justify-between p-space-md rounded-xl border transition-all cursor-pointer select-none gap-space-sm ${
              isSelected
                ? 'border-primary bg-primary-container/10 ring-1 ring-primary'
                : 'border-surface-container-high bg-surface-container-lowest hover:border-outline'
            } ${isDisabled ? 'opacity-60 cursor-not-allowed bg-surface-container-low/50' : ''}`}
          >
            <div className="flex items-center gap-space-md">
              <input
                type="radio"
                name="candidate-selection"
                value={candidate.userId}
                checked={isSelected}
                disabled={isDisabled}
                onChange={() => {
                  if (!isDisabled) {
                    onSelectCandidate(candidate);
                  }
                }}
                {...(reasonText ? { 'aria-describedby': reasonId } : {})}
                className="w-4 h-4 text-primary border-outline-variant focus:ring-primary shrink-0"
              />

              <Avatar
                src={profile?.avatar?.url ?? null}
                alt={profile ? profile.fullName : MATCHING_COPY.unknownName}
                {...(profile ? { initials: profile.fullName } : {})}
                size="md"
              />

              <div className="flex flex-col">
                <span className="text-title-md font-semibold text-on-surface">
                  {profile ? profile.fullName : MATCHING_COPY.unknownName}
                </span>
                {profile ? (
                  <span className="text-body-sm text-secondary">
                    {MATCHING_COPY.propose.candidateSummary([
                      MATCHING_COPY.propose.ageValue(profile.age),
                      MATCHING_COPY.gender[profile.gender],
                      profile.currentCity,
                      profile.occupation,
                      MATCHING_COPY.education[profile.education],
                    ])}
                  </span>
                ) : (
                  <span className="text-body-sm text-secondary">{candidate.userId.slice(0, 8)}</span>
                )}
              </div>
            </div>

            {reasonText ? (
              <div id={reasonId} className="sm:self-center shrink-0">
                <Badge tone="warning">{reasonText}</Badge>
              </div>
            ) : null}
          </label>
        );
      })}
    </div>
  );
}
