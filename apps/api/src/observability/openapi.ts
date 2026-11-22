import { z } from 'zod';

/**
 * Sinh tài liệu OpenAPI 3.1 (BE-S7-08) từ hai nguồn có sẵn, không khai báo tay:
 * 1. **Danh mục endpoint** lấy từ router Hono đã dựng (`app.routes`) → luôn khớp route thật đang chạy.
 * 2. **Schema DTO** = mọi Zod schema export từ `@tamgiao/contracts` (tên `xxxSchema`) → `components.schemas`
 *    qua `z.toJSONSchema` của Zod 4.
 * Chưa gắn request/response cụ thể cho từng route (router không mang metadata) — FE tra DTO theo tên trong
 * `components.schemas` (vd `verifyOtpBodySchema` → `VerifyOtpBody`).
 */
export interface RouteInfo {
  readonly method: string;
  readonly path: string;
}

export interface OpenApiOptions {
  readonly routes: readonly RouteInfo[];
  /** Namespace export của contracts (`import * as contracts`). */
  readonly schemaModule: Readonly<Record<string, unknown>>;
  readonly title: string;
  readonly version: string;
  readonly serverUrl?: string | undefined;
}

type JsonObject = Record<string, unknown>;

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

/** Route hạ tầng không đưa vào tài liệu. */
const HIDDEN_PATHS = new Set(['/metrics', '/openapi.json', '/docs']);

/** `verifyOtpBodySchema` → `VerifyOtpBody`. */
export function componentName(exportName: string): string {
  const base = exportName.replace(/Schema$/, '');
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/** `/admin/kyc/:id/notes` → `/admin/kyc/{id}/notes`; bỏ regex của Hono (`:id{[0-9]+}`). */
export function toOpenApiPath(path: string): { path: string; params: string[] } {
  const params: string[] = [];
  const converted = path
    .split('/')
    .map((segment) => {
      const match = /^:([A-Za-z0-9_]+)(\{.*\})?\??$/.exec(segment);
      if (!match?.[1]) return segment;
      params.push(match[1]);
      return `{${match[1]}}`;
    })
    .join('/');
  return { path: converted, params };
}

function tagOf(path: string): string {
  const segments = path.split('/').filter(Boolean);
  const first = segments[0] ?? 'root';
  return (first === 'admin' || first === 'me') && segments[1] ? `${first}/${segments[1]}` : first;
}

/** Quy ước của dự án: `/me/*` cần access token người dùng, `/admin/*` cần token phiên admin (trừ đăng nhập). */
function securityOf(path: string): JsonObject[] | undefined {
  if (path.startsWith('/me')) return [{ userBearer: [] }];
  if (path.startsWith('/admin') && path !== '/admin/auth/login') return [{ adminBearer: [] }];
  return undefined;
}

export function collectSchemas(schemaModule: Readonly<Record<string, unknown>>): Record<string, JsonObject> {
  const schemas: Record<string, JsonObject> = {};
  for (const [name, value] of Object.entries(schemaModule).sort(([a], [b]) => a.localeCompare(b))) {
    if (!name.endsWith('Schema') || !(value instanceof z.ZodType)) continue;
    try {
      const json = z.toJSONSchema(value, { unrepresentable: 'any', io: 'output' }) as JsonObject;
      delete json.$schema;
      schemas[componentName(name)] = json;
    } catch {
      // Schema không biểu diễn được bằng JSON Schema (vd transform phức tạp) → bỏ qua, không chặn cả tài liệu.
    }
  }
  return schemas;
}

export function buildOpenApiDocument(options: OpenApiOptions): JsonObject {
  const paths: Record<string, Record<string, JsonObject>> = {};
  const seen = new Set<string>();
  for (const route of options.routes) {
    const method = route.method.toUpperCase();
    if (!HTTP_METHODS.has(method) || route.path.includes('*') || HIDDEN_PATHS.has(route.path)) continue;
    const key = `${method} ${route.path}`;
    if (seen.has(key)) continue; // middleware + handler cùng path → nhiều dòng
    seen.add(key);

    const { path, params } = toOpenApiPath(route.path);
    const security = securityOf(route.path);
    const operation: JsonObject = {
      tags: [tagOf(route.path)],
      operationId: `${method.toLowerCase()}${path.replace(/[{}]/g, '').replace(/[^A-Za-z0-9]+(.)?/g, (_m, c: string | undefined) => (c ? c.toUpperCase() : ''))}`,
      ...(params.length > 0
        ? {
            parameters: params.map((name) => ({
              name,
              in: 'path',
              required: true,
              schema: { type: 'string' },
            })),
          }
        : {}),
      ...(security ? { security } : {}),
      responses: {
        '2XX': { description: 'Thành công — xem DTO tương ứng trong components.schemas' },
        default: {
          description: 'Lỗi (Problem JSON, RFC 7807)',
          content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } },
        },
      },
    };
    (paths[path] ??= {})[method.toLowerCase()] = operation;
  }

  return {
    openapi: '3.1.0',
    info: { title: options.title, version: options.version },
    ...(options.serverUrl ? { servers: [{ url: options.serverUrl }] } : {}),
    paths: Object.fromEntries(Object.entries(paths).sort(([a], [b]) => a.localeCompare(b))),
    components: {
      securitySchemes: {
        userBearer: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Access token người dùng app',
        },
        adminBearer: { type: 'http', scheme: 'bearer', description: 'Token phiên admin (opaque)' },
      },
      schemas: collectSchemas(options.schemaModule),
    },
  };
}

/** Trang xem tài liệu (Scalar API Reference, tải từ CDN, phiên bản ghim). */
export function openApiHtml(specUrl: string): string {
  return `<!doctype html>
<html lang="vi">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Tâm Giao API</title>
  </head>
  <body>
    <script id="api-reference" data-url="${specUrl}"></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.25.0"></script>
  </body>
</html>`;
}
