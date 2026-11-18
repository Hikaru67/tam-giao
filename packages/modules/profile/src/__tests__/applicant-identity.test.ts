import { newId, type Tx } from '@tamgiao/kernel';
import { describe, expect, it } from 'vitest';
import { GetApplicantIdentity } from '../application/get-applicant-identity.js';
import { EMPTY_PROFILE_DATA, Profile } from '../domain/profile.js';
import { FakeUnitOfWork, InMemoryProfileRepository } from './fakes.js';

const now = new Date('2026-11-18T01:00:00.000Z');

async function setup(data: Partial<typeof EMPTY_PROFILE_DATA> | null) {
  const profiles = new InMemoryProfileRepository();
  const userId = newId<'User'>();
  if (data !== null) {
    const p = Profile.start(userId, now);
    const r = p.update({ ...EMPTY_PROFILE_DATA, ...data }, { submit: false }, now);
    if (r.isErr()) throw new Error(r.error.code);
    await profiles.save({} as Tx, p);
  }
  return { userId, query: new GetApplicantIdentity({ uow: new FakeUnitOfWork(profiles), profiles }) };
}

describe('ProfileFacade.getApplicantIdentity', () => {
  it('returns full name and birth date from the profile', async () => {
    const { userId, query } = await setup({ fullName: 'Lê Minh C', birthDate: '1994-08-20' });
    expect(await query.execute(userId)).toEqual({ fullName: 'Lê Minh C', birthDate: '1994-08-20' });
  });

  it('returns null without a profile or when name / birth date is missing', async () => {
    const none = await setup(null);
    expect(await none.query.execute(none.userId)).toBeNull();
    const partial = await setup({ fullName: 'Lê Minh C' });
    expect(await partial.query.execute(partial.userId)).toBeNull();
  });
});
