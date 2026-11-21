import { asDbTx } from '@tamgiao/db';
import type { Tx } from '@tamgiao/kernel';
import { and, inArray, isNotNull, sql } from 'drizzle-orm';
import type { CandidateProfileReader } from '../application/ports/candidate-profile-reader.js';
import type {
  CandidateProfileRepository,
  CandidateProfileSnapshot,
} from '../application/ports/candidate-profile-repository.js';
import type { CandidateProfile } from '../domain/candidate-profile.js';
import { toCandidateProfileFromRow } from './drizzle-candidate-finder.js';
import { candidateProfiles } from './schema-candidates.js';

/**
 * Hiện thực read model `matching.candidate_profiles`: ghi bằng một câu upsert (idempotent, A9) và đọc hồ sơ đã đồng bộ
 * cho `ProposeMatch` (BE-S5-04).
 */
export class DrizzleCandidateProfileRepository implements CandidateProfileRepository, CandidateProfileReader {
  async upsertProfile(tx: Tx, snapshot: CandidateProfileSnapshot, now: Date): Promise<void> {
    const p = snapshot.profile;
    const c = p.criteria;
    const updatable = {
      gender: p.gender,
      birthDate: p.birthDate,
      cityKey: p.cityKey,
      education: p.education,
      childrenPlan: c.childrenPlan,
      religion: c.religion,
      prefAgeMin: c.ageMin,
      prefAgeMax: c.ageMax,
      prefCityKey: c.cityKey,
      prefMinEducation: c.minEducation,
      scoring: {
        lifestyle: c.lifestyle,
        financialIndependence: c.financialIndependence,
        coreTraits: [...c.coreTraits],
      },
      profileVersion: snapshot.profileVersion,
      preferencesVersion: snapshot.preferencesVersion,
      profileSyncedAt: now,
      updatedAt: now,
    };
    const t = candidateProfiles;
    await asDbTx(tx)
      .insert(t)
      .values({ userId: p.userId, ...updatable })
      .onConflictDoUpdate({
        target: t.userId,
        set: updatable,
        // Chỉ nhận bản không cũ hơn bản đang lưu (dòng chỉ có cờ verified → version null → luôn nhận).
        setWhere: sql`${t.profileVersion} is null
          or (${t.profileVersion} <= ${snapshot.profileVersion}
              and ${t.preferencesVersion} <= ${snapshot.preferencesVersion})`,
      });
  }

  async setVerified(tx: Tx, userId: string, verified: boolean, now: Date): Promise<void> {
    await asDbTx(tx)
      .insert(candidateProfiles)
      .values({ userId, verified, updatedAt: now })
      .onConflictDoUpdate({ target: candidateProfiles.userId, set: { verified, updatedAt: now } });
  }

  async findSynced(tx: Tx, userIds: readonly string[]): Promise<ReadonlyMap<string, CandidateProfile>> {
    const ids = [...new Set(userIds.map((id) => id.toLowerCase()))];
    if (ids.length === 0) return new Map();
    const rows = await asDbTx(tx)
      .select()
      .from(candidateProfiles)
      .where(and(inArray(candidateProfiles.userId, ids), isNotNull(candidateProfiles.profileSyncedAt)));
    return new Map(rows.map((row) => [row.userId, toCandidateProfileFromRow(row)]));
  }
}
