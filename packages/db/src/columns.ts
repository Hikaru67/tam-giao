import { customType, timestamp } from 'drizzle-orm/pg-core';

/** `timestamptz` ánh xạ sang `Date` (UTC) — mọi cột thời gian dùng kiểu này (AGENTS.md mục 3). */
export const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** Cột `bytea` cho dữ liệu đã mã hoá (hậu tố `_enc`, AGENTS.md mục 4). */
export const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => 'bytea',
  toDriver: (value) => Buffer.from(value),
  fromDriver: (value) => new Uint8Array(value),
});
