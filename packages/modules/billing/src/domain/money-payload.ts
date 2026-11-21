import type { Money } from '@tamgiao/kernel';

/**
 * Số tiền VND đưa vào payload event / DTO: số nguyên an toàn (JSON không tuần tự hoá được `bigint`).
 * Vượt `Number.MAX_SAFE_INTEGER` là lỗi lập trình → throw.
 */
export const toVndNumber = (money: Money): number => {
  const value = Number(money.amount);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Số tiền vượt giới hạn số nguyên an toàn: ${money.toString()}`);
  }
  return value;
};
