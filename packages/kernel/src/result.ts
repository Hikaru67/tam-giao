/**
 * Kết quả của một thao tác nghiệp vụ: thành công (`Ok`) hoặc thất bại có kiểu (`Err`).
 * Lỗi nghiệp vụ trả về bằng `Result`, không `throw` (AGENTS.md A4).
 */
export type Result<T, E> = Ok<T, E> | Err<T, E>;

interface ResultMethods<T, E> {
  isOk(): this is Ok<T, E>;
  isErr(): this is Err<T, E>;
  map<U>(fn: (value: T) => U): Result<U, E>;
  mapErr<F>(fn: (error: E) => F): Result<T, F>;
  andThen<U, F>(fn: (value: T) => Result<U, F>): Result<U, E | F>;
  match<R>(onOk: (value: T) => R, onErr: (error: E) => R): R;
  unwrapOr(fallback: T): T;
}

export class Ok<T, E> implements ResultMethods<T, E> {
  readonly ok = true as const;
  constructor(readonly value: T) {}

  isOk(): this is Ok<T, E> {
    return true;
  }
  isErr(): this is Err<T, E> {
    return false;
  }
  map<U>(fn: (value: T) => U): Result<U, E> {
    return new Ok(fn(this.value));
  }
  mapErr<F>(_fn: (error: E) => F): Result<T, F> {
    return new Ok(this.value);
  }
  andThen<U, F>(fn: (value: T) => Result<U, F>): Result<U, E | F> {
    return fn(this.value);
  }
  match<R>(onOk: (value: T) => R, _onErr: (error: E) => R): R {
    return onOk(this.value);
  }
  unwrapOr(_fallback: T): T {
    return this.value;
  }
}

export class Err<T, E> implements ResultMethods<T, E> {
  readonly ok = false as const;
  constructor(readonly error: E) {}

  isOk(): this is Ok<T, E> {
    return false;
  }
  isErr(): this is Err<T, E> {
    return true;
  }
  map<U>(_fn: (value: T) => U): Result<U, E> {
    return new Err(this.error);
  }
  mapErr<F>(fn: (error: E) => F): Result<T, F> {
    return new Err(fn(this.error));
  }
  andThen<U, F>(_fn: (value: T) => Result<U, F>): Result<U, E | F> {
    return new Err(this.error);
  }
  match<R>(_onOk: (value: T) => R, onErr: (error: E) => R): R {
    return onErr(this.error);
  }
  unwrapOr(fallback: T): T {
    return fallback;
  }
}

export function ok<E = never>(): Result<void, E>;
export function ok<T, E = never>(value: T): Result<T, E>;
export function ok<T, E = never>(value?: T): Result<T | undefined, E> {
  return new Ok(value);
}

export function err<E, T = never>(error: E): Result<T, E> {
  return new Err(error);
}
