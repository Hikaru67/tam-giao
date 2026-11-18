import type { DomainError, Result } from '@tamgiao/kernel';

/**
 * API công khai của module identity cho module khác và composition root (AGENTS.md A3).
 * Chỉ chứa kiểu + thao tác chỉ-đọc; không lộ domain/infrastructure.
 */
export interface AuthenticatedUser {
  readonly userId: string;
  readonly sessionId: string;
}

export interface IdentityFacade {
  /** Kiểm tra access token của người dùng app (chữ ký, hạn, phiên còn hiệu lực). */
  authenticateUser(accessToken: string): Promise<Result<AuthenticatedUser, DomainError>>;
}
