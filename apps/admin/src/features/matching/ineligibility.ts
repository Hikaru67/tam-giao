import { isApiError } from '@tamgiao/api-client';
import { MATCHING_COPY } from './copy';

export type IneligibleCode = keyof typeof MATCHING_COPY.ineligibleReasons;

const INELIGIBLE_CODES = new Set<string>(Object.keys(MATCHING_COPY.ineligibleReasons));

export function ineligibilityFromError(
  error: unknown,
  pair: { userAId: string; userBId: string },
): { code: IneligibleCode; userIds: readonly string[] } | null {
  if (!isApiError(error) || !INELIGIBLE_CODES.has(error.code)) {
    return null;
  }

  const code = error.code as IneligibleCode;
  const pairIds = new Set([pair.userAId, pair.userBId]);

  let matchedUserIds: string[] = [];
  if (
    error.meta &&
    typeof error.meta === 'object' &&
    'userIds' in error.meta &&
    Array.isArray(error.meta.userIds)
  ) {
    matchedUserIds = error.meta.userIds.filter(
      (id): id is string => typeof id === 'string' && pairIds.has(id),
    );
  }

  const userIds = matchedUserIds.length > 0 ? matchedUserIds : [pair.userBId];
  return { code, userIds };
}
