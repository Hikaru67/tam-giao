import * as contracts from '@tamgiao/contracts';
import { errorRegistry } from '@tamgiao/contracts';
import { describe, expect, it } from 'vitest';
import { PROFILE_ERRORS } from '../domain/errors.js';
import * as domain from '../domain/profile.js';

describe('profile catalogs', () => {
  it('domain enums match the published contracts', () => {
    expect(domain.GENDERS).toEqual(contracts.GENDERS);
    expect(domain.EDUCATION_LEVELS).toEqual(contracts.EDUCATION_LEVELS);
    expect(domain.INCOME_RANGES).toEqual(contracts.INCOME_RANGES);
    expect(domain.HOUSING_TYPES).toEqual(contracts.HOUSING_TYPES);
  });

  it.each(PROFILE_ERRORS)('%s is registered in contracts', (code) => {
    expect(errorRegistry.get(code)).toBeDefined();
  });
});
