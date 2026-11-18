import { MAX_PROFILE_PHOTOS, MIN_AGE } from '@tamgiao/contracts/constants';
import { newId } from '@tamgiao/kernel';
import { describe, expect, it } from 'vitest';
import { EMPTY_PROFILE_DATA, Profile, ageAt, type ProfileData } from '../domain/profile.js';

// 2026-11-18 05:00 VN (UTC+7).
const NOW = new Date('2026-11-17T22:00:00.000Z');
const complete: ProfileData = {
  ...EMPTY_PROFILE_DATA,
  fullName: 'Nguyễn Văn A',
  birthDate: '1995-03-10',
  gender: 'male',
  currentCity: 'Hà Nội',
  education: 'bachelor',
  occupation: 'Kỹ sư',
  photos: ['profile_photo/u/1.jpg'],
};
const fresh = () => Profile.start(newId<'User'>(), NOW);

describe('ageAt', () => {
  it('counts completed years by Vietnam calendar date', () => {
    // Sinh 2006-11-18: tại VN đã sang ngày 18/11 (UTC vẫn là 17/11) → tròn 20 tuổi.
    expect(ageAt('2006-11-18', NOW)).toBe(20);
    expect(ageAt('2006-11-19', NOW)).toBe(19);
    expect(ageAt('2000-02-29', new Date('2026-02-28T00:00:00.000Z'))).toBe(25);
  });

  it('rejects impossible dates', () => {
    expect(ageAt('2001-02-29', NOW)).toBeNull();
    expect(ageAt('2001-13-01', NOW)).toBeNull();
    expect(ageAt('01-01-2001', NOW)).toBeNull();
  });
});

describe('Profile.update', () => {
  it(`age < MIN_AGE (${MIN_AGE}) → AGE_NOT_ELIGIBLE (AC1), even for a draft`, () => {
    const r = fresh().update({ ...EMPTY_PROFILE_DATA, birthDate: '2006-11-19' }, { submit: false }, NOW);
    expect(r.isErr() && r.error).toEqual({ code: 'AGE_NOT_ELIGIBLE', details: { minAge: MIN_AGE } });
  });

  it('exactly MIN_AGE today is accepted', () => {
    expect(
      fresh()
        .update({ ...complete, birthDate: '2006-11-18' }, { submit: true }, NOW)
        .isOk(),
    ).toBe(true);
  });

  it('invalid birth date → VALIDATION_FAILED', () => {
    const r = fresh().update({ ...EMPTY_PROFILE_DATA, birthDate: '2001-02-30' }, { submit: false }, NOW);
    expect(r.isErr() && r.error.code).toBe('VALIDATION_FAILED');
  });

  it(`more than ${MAX_PROFILE_PHOTOS} photos → TOO_MANY_PHOTOS (AC3)`, () => {
    const photos = Array.from({ length: MAX_PROFILE_PHOTOS + 1 }, (_, i) => `k${i}`);
    const r = fresh().update({ ...EMPTY_PROFILE_DATA, photos }, { submit: false }, NOW);
    expect(r.isErr() && r.error).toEqual({ code: 'TOO_MANY_PHOTOS', details: { max: MAX_PROFILE_PHOTOS } });
    const ok = fresh().update(
      { ...complete, photos: photos.slice(0, MAX_PROFILE_PHOTOS) },
      { submit: true },
      NOW,
    );
    expect(ok.isOk()).toBe(true);
  });

  it('duplicate photo keys → VALIDATION_FAILED', () => {
    const r = fresh().update({ ...complete, photos: ['a', 'a'] }, { submit: false }, NOW);
    expect(r.isErr() && r.error.code).toBe('VALIDATION_FAILED');
  });

  it('draft save accepts an incomplete form and records no event', () => {
    const p = fresh();
    expect(p.update({ ...EMPTY_PROFILE_DATA, fullName: 'A' }, { submit: false }, NOW).isOk()).toBe(true);
    expect(p.status).toBe('DRAFT');
    expect(p.pullEvents()).toEqual([]);
    expect(p.toState().data.fullName).toBe('A');
  });

  it('submit with missing fields → PROFILE_INCOMPLETE listing them', () => {
    const r = fresh().update({ ...complete, gender: null, photos: [] }, { submit: true }, NOW);
    expect(r.isErr() && r.error).toEqual({
      code: 'PROFILE_INCOMPLETE',
      details: { missing: ['gender', 'photos'] },
    });
  });

  it('first complete submit → COMPLETED + ProfileCompleted once; later saves keep it completed', () => {
    const p = fresh();
    expect(p.update(complete, { submit: true }, NOW).isOk()).toBe(true);
    expect(p.toState()).toMatchObject({ status: 'COMPLETED', completedAt: NOW, version: 1 });
    const [event, ...rest] = p.pullEvents();
    expect(rest).toEqual([]);
    expect(event).toMatchObject({
      type: 'ProfileCompleted',
      aggregateType: 'Profile',
      payload: { userId: p.id },
    });

    expect(p.update({ ...complete, occupation: 'Bác sĩ' }, { submit: true }, NOW).isOk()).toBe(true);
    expect(p.update({ ...complete, bio: 'x' }, { submit: false }, NOW).isOk()).toBe(true);
    expect(p.pullEvents()).toEqual([]);
    expect(p.status).toBe('COMPLETED');
  });

  it('a completed profile cannot drop required fields, even via draft save', () => {
    const p = fresh();
    p.update(complete, { submit: true }, NOW);
    const r = p.update({ ...complete, fullName: null }, { submit: false }, NOW);
    expect(r.isErr() && r.error.code).toBe('PROFILE_INCOMPLETE');
  });

  it('deduplicates interests', () => {
    const p = fresh();
    p.update(
      { ...EMPTY_PROFILE_DATA, interests: ['đọc sách', 'đọc sách', 'chạy bộ'] },
      { submit: false },
      NOW,
    );
    expect(p.toState().data.interests).toEqual(['đọc sách', 'chạy bộ']);
  });
});
