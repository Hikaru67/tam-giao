import type { Hono } from 'hono';
import type { AppEnv } from './http/context.js';

/**
 * Hợp đồng giữa composition root và từng module nghiệp vụ.
 * Mỗi module export `createXModule(deps): ApiModule` từ `packages/modules/<x>/src/index.ts`;
 * route của module tự mang prefix của mình (vd `/me/match`, `/admin/matches`).
 */
export interface ApiModule {
  readonly name: string;
  readonly routes: Hono<AppEnv>;
}

/** Đăng ký module tại đây khi có (thứ tự không quan trọng). Hiện chưa có module nghiệp vụ nào (Sprint 2+). */
export const buildModules = (): readonly ApiModule[] => [];
