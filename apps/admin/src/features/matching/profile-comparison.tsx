import type { AdminCandidateDto } from '@tamgiao/contracts/matching';
import { Badge, Card } from '@tamgiao/ui-web';
import { MATCHING_COPY } from './copy';

export interface PersonAInfo {
  readonly userId: string;
  readonly fullName: string | null;
  readonly occupation: string | null;
}

export interface ProfileComparisonProps {
  readonly personA: PersonAInfo;
  readonly personB: AdminCandidateDto;
}

export function ProfileComparison({ personA, personB }: ProfileComparisonProps) {
  const profileB = personB.profile;

  // Mã điểm chung FE chưa có nhãn thì bỏ qua (BE có thể thêm mã mới).
  const labels: Readonly<Record<string, string>> = MATCHING_COPY.commonPoints;
  const validCommonPoints = personB.commonPoints.flatMap((code) => {
    const label = labels[code];
    return label === undefined ? [] : [{ code, label }];
  });

  return (
    <Card className="flex flex-col gap-space-lg">
      <h3 className="text-title-md font-bold text-on-surface">{MATCHING_COPY.propose.comparisonSection}</h3>

      <div className="overflow-x-auto rounded-xl border border-surface-container-high">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-surface-container-high bg-surface-container-low text-label-md font-semibold text-secondary">
              <th className="p-space-md ">{MATCHING_COPY.propose.criterion}</th>
              <th className="p-space-md text-primary font-bold">{MATCHING_COPY.propose.personA}</th>
              <th className="p-space-md text-primary font-bold">{MATCHING_COPY.propose.personB}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-container-high text-body-md text-on-surface">
            <tr>
              <td className="p-space-md font-medium text-secondary">{MATCHING_COPY.propose.fullName}</td>
              <td className="p-space-md font-semibold">
                {personA.fullName ? personA.fullName : MATCHING_COPY.unknownValue}
              </td>
              <td className="p-space-md font-semibold">
                {profileB ? profileB.fullName : MATCHING_COPY.unknownValue}
              </td>
            </tr>
            <tr>
              <td className="p-space-md font-medium text-secondary">{MATCHING_COPY.propose.userId}</td>
              <td className="p-space-md text-secondary font-mono text-body-sm">{personA.userId}</td>
              <td className="p-space-md text-secondary font-mono text-body-sm">{personB.userId}</td>
            </tr>
            <tr>
              <td className="p-space-md font-medium text-secondary">{MATCHING_COPY.propose.age}</td>
              <td className="p-space-md text-secondary">{MATCHING_COPY.unknownValue}</td>
              <td className="p-space-md">
                {profileB ? MATCHING_COPY.propose.ageValue(profileB.age) : MATCHING_COPY.unknownValue}
              </td>
            </tr>
            <tr>
              <td className="p-space-md font-medium text-secondary">{MATCHING_COPY.propose.gender}</td>
              <td className="p-space-md text-secondary">{MATCHING_COPY.unknownValue}</td>
              <td className="p-space-md">
                {profileB ? MATCHING_COPY.gender[profileB.gender] : MATCHING_COPY.unknownValue}
              </td>
            </tr>
            <tr>
              <td className="p-space-md font-medium text-secondary">{MATCHING_COPY.propose.city}</td>
              <td className="p-space-md text-secondary">{MATCHING_COPY.unknownValue}</td>
              <td className="p-space-md">{profileB ? profileB.currentCity : MATCHING_COPY.unknownValue}</td>
            </tr>
            <tr>
              <td className="p-space-md font-medium text-secondary">{MATCHING_COPY.propose.occupation}</td>
              <td className="p-space-md">
                {personA.occupation ? personA.occupation : MATCHING_COPY.unknownValue}
              </td>
              <td className="p-space-md">{profileB ? profileB.occupation : MATCHING_COPY.unknownValue}</td>
            </tr>
            <tr>
              <td className="p-space-md font-medium text-secondary">{MATCHING_COPY.propose.education}</td>
              <td className="p-space-md text-secondary">{MATCHING_COPY.unknownValue}</td>
              <td className="p-space-md">
                {profileB ? MATCHING_COPY.education[profileB.education] : MATCHING_COPY.unknownValue}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-space-sm">
        <h4 className="text-title-md font-semibold text-on-surface">
          {MATCHING_COPY.propose.commonPointsTitle}
        </h4>
        {validCommonPoints.length > 0 ? (
          <div className="flex flex-wrap gap-space-xs">
            {validCommonPoints.map(({ code, label }) => (
              <Badge key={code} tone="primary">
                {label}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-body-sm text-secondary">{MATCHING_COPY.propose.noCommonPoints}</p>
        )}
      </div>
    </Card>
  );
}
