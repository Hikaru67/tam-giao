// Fixture cố ý vi phạm A1: domain import framework.
import { pgTable } from 'drizzle-orm/pg-core';
import { Hono } from 'hono';

export const bad = [pgTable, Hono];
