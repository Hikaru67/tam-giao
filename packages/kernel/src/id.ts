import { v7 as uuidv7, validate as uuidValidate, version as uuidVersion } from 'uuid';
import { fail, type DomainError } from './domain-error.js';
import { ok, type Result } from './result.js';

declare const IdBrand: unique symbol;

/** Id có gắn nhãn kiểu để không lẫn `UserId` với `MatchId`. Giá trị là UUID v7 (sắp xếp được theo thời gian). */
export type Id<B extends string> = string & { readonly [IdBrand]: B };

export function newId<B extends string>(): Id<B> {
  return uuidv7() as Id<B>;
}

export function parseId<B extends string>(raw: string): Result<Id<B>, DomainError<'INVALID_ID'>> {
  if (!uuidValidate(raw) || uuidVersion(raw) !== 7) {
    return fail('INVALID_ID');
  }
  return ok(raw.toLowerCase() as Id<B>);
}
