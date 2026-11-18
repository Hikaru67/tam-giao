import { pgSchema } from 'drizzle-orm/pg-core';

/** Schema Postgres của module billing (AGENTS.md mục 4). Bảng được thêm theo task BE-S4-xx. */
export const billing = pgSchema('billing');
