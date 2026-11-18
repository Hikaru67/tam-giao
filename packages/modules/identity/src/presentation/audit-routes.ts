import { auditLogQuerySchema, type AuditLogListResponse } from '@tamgiao/contracts';
import { parseQuery, problemResponse, sendResult, type AppEnv, type RequireAdmin } from '@tamgiao/http';
import { domainError } from '@tamgiao/kernel';
import { Hono } from 'hono';
import type { AuditLogCursor } from '../application/ports/audit-log-repository.js';
import type { SearchAuditLogs } from '../application/queries/search-audit-logs.js';

export interface AuditRoutesDeps {
  readonly searchAuditLogs: SearchAuditLogs;
  readonly requireAdmin: RequireAdmin;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Cursor mờ cho client: base64url của `<occurredAt ISO>|<id>`. */
const encodeCursor = (c: AuditLogCursor): string =>
  Buffer.from(`${c.occurredAt.toISOString()}|${c.id}`, 'utf8').toString('base64url');

function decodeCursor(raw: string): AuditLogCursor | null {
  const [iso, id, ...rest] = Buffer.from(raw, 'base64url').toString('utf8').split('|');
  if (iso === undefined || id === undefined || rest.length > 0 || !UUID_PATTERN.test(id)) return null;
  const occurredAt = new Date(iso);
  return Number.isNaN(occurredAt.getTime()) ? null : { occurredAt, id };
}

export function createAuditRoutes(deps: AuditRoutesDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.get('/admin/audit-logs', deps.requireAdmin('audit:read'), async (c) => {
    const query = parseQuery(c, auditLogQuerySchema);
    if (query.isErr()) return query.error;
    const { cursor: rawCursor, limit, from, to, ...filter } = query.value;

    const cursor = rawCursor === undefined ? null : decodeCursor(rawCursor);
    if (rawCursor !== undefined && cursor === null) {
      return problemResponse(c, domainError('VALIDATION_FAILED'), {
        errors: [{ path: 'cursor', message: 'cursor không hợp lệ' }],
      });
    }

    const result = await deps.searchAuditLogs.execute({
      filter: {
        ...filter,
        ...(from === undefined ? {} : { from: new Date(from) }),
        ...(to === undefined ? {} : { to: new Date(to) }),
      },
      cursor,
      ...(limit === undefined ? {} : { limit }),
    });
    return sendResult(
      c,
      result.map((page): AuditLogListResponse => ({
        items: page.items.map((e) => ({
          id: e.id,
          occurredAt: e.occurredAt.toISOString(),
          actor: { type: e.actor.type, id: e.actor.id },
          action: e.action,
          targetType: e.targetType,
          targetId: e.targetId,
          ip: e.ip,
          meta: { ...e.meta },
        })),
        nextCursor: page.nextCursor === null ? null : encodeCursor(page.nextCursor),
      })),
    );
  });

  return routes;
}
