import { FakeClock, newId } from '@tamgiao/kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import { SaveProfile } from '../application/save-profile.js';
import { EMPTY_PROFILE_DATA, type ProfileData } from '../domain/profile.js';
import { FakeUnitOfWork, FakeUploadRegistry, InMemoryProfileRepository } from './fakes.js';

const userA = newId<'User'>();
const userB = newId<'User'>();
const complete: ProfileData = {
  ...EMPTY_PROFILE_DATA,
  fullName: 'Trần Thị B',
  birthDate: '1996-05-01',
  gender: 'female',
  currentCity: 'Đà Nẵng',
  education: 'master',
  occupation: 'Giáo viên',
  incomeRange: '20m_40m',
  photos: ['a1.jpg', 'a2.jpg'],
};

let repo: InMemoryProfileRepository;
let uploads: FakeUploadRegistry;
let save: SaveProfile;

beforeEach(() => {
  repo = new InMemoryProfileRepository();
  uploads = new FakeUploadRegistry();
  uploads.grant(userA, 'a1.jpg');
  uploads.grant(userA, 'a2.jpg');
  uploads.grant(userB, 'b1.jpg');
  save = new SaveProfile({
    uow: new FakeUnitOfWork(repo),
    clock: new FakeClock(new Date('2026-11-18T00:00:00.000Z')),
    profiles: repo,
    uploads,
  });
});

describe('SaveProfile', () => {
  it('creates a draft on first save, then completes and emits ProfileCompleted', async () => {
    const draft = await save.execute({
      userId: userA,
      data: { ...EMPTY_PROFILE_DATA, fullName: 'B' },
      submit: false,
    });
    expect(draft.isOk() && draft.value).toEqual({ status: 'DRAFT' });
    const done = await save.execute({ userId: userA, data: complete, submit: true });
    expect(done.isOk() && done.value).toEqual({ status: 'COMPLETED' });
    expect(repo.events).toMatchObject([{ type: 'ProfileCompleted', payload: { userId: userA } }]);
  });

  it("using another user's photo key → UPLOAD_NOT_OWNED, nothing saved", async () => {
    const r = await save.execute({
      userId: userA,
      data: { ...complete, photos: ['a1.jpg', 'b1.jpg'] },
      submit: true,
    });
    expect(r.isErr() && r.error.code).toBe('UPLOAD_NOT_OWNED');
    expect(repo.rows.size).toBe(0);
    expect(repo.events).toEqual([]);
  });

  it('domain errors short-circuit before verifying photo keys', async () => {
    const photos = ['1', '2', '3', '4', '5', '6'];
    const r = await save.execute({ userId: userA, data: { ...complete, photos }, submit: false });
    expect(r.isErr() && r.error.code).toBe('TOO_MANY_PHOTOS');
    expect(uploads.verified).toEqual([]);
  });
});
