import { asDbTx } from '@tamgiao/db';
import type { Tx } from '@tamgiao/kernel';
import { sql } from 'drizzle-orm';
import type {
  CandidateProfileRepository,
  CandidateProfileSnapshot,
} from '../application/ports/candidate-profile-repository.js';
import { candidateProfiles } from './schema-candidates.js';

/** Hiện thực ghi read model `matching.candidate_profiles` bằng một câu upsert (idempotent, A9). */
export class DrizzleCandidateProfileRepository implements CandidateProfileRepository {
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
}
