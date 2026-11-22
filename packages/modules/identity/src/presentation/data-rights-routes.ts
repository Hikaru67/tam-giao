import { dataExportDownloadQuerySchema, deleteAccountBodySchema } from '@tamgiao/contracts';
import { parseBody, parseQuery, problemResponse, sendResult, type AppEnv } from '@tamgiao/http';
import { Hono, type MiddlewareHandler } from 'hono';
import type { DataExportView } from '../application/data-export-view.js';
import type { DownloadDataExport } from '../application/queries/download-data-export.js';
import type {
  AccountDeletionView,
  GetAccountDeletionStatus,
} from '../application/queries/get-account-deletion-status.js';
import type { GetDataExport } from '../application/queries/get-data-export.js';
import type { DeleteAccount } from '../application/use-cases/delete-account.js';
import type { RequestAccountDeletionOtp } from '../application/use-cases/request-account-deletion-otp.js';
import type { RequestDataExport } from '../application/use-cases/request-data-export.js';

export interface DataRightsRoutesDeps {
  readonly requestDataExport: RequestDataExport;
  readonly getDataExport: GetDataExport;
  readonly downloadDataExport: DownloadDataExport;
  readonly requestAccountDeletionOtp: RequestAccountDeletionOtp;
  readonly deleteAccount: DeleteAccount;
  readonly getAccountDeletionStatus: GetAccountDeletionStatus;
  readonly requireUser: MiddlewareHandler<AppEnv>;
}

const exportDto = (v: DataExportView) => ({
  ...v,
  requestedAt: v.requestedAt.toISOString(),
  readyAt: v.readyAt?.toISOString() ?? null,
  expiresAt: v.expiresAt?.toISOString() ?? null,
});

const deletionDto = (v: AccountDeletionView) => ({ ...v, requestedAt: v.requestedAt.toISOString() });

/** Quyền dữ liệu cá nhân (BE-S7-06): xuất dữ liệu + xoá tài khoản. */
export function createDataRightsRoutes(deps: DataRightsRoutesDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  /** Yêu cầu xuất dữ liệu: 202 khi tạo mới, 200 khi trả lại yêu cầu đang dựng. */
  routes.post('/me/data-exports', deps.requireUser, async (c) => {
    const result = await deps.requestDataExport.execute({ userId: c.get('auth').userId });
    if (result.isErr()) return problemResponse(c, result.error);
    return c.json(exportDto(result.value.view), result.value.created ? 202 : 200);
  });

  routes.get('/me/data-exports/:exportId', deps.requireUser, async (c) => {
    const result = await deps.getDataExport.execute({
      userId: c.get('auth').userId,
      exportId: c.req.param('exportId'),
    });
    return sendResult(c, result.map(exportDto));
  });

  /** Liên kết có ký — không cần đăng nhập, hết hạn cùng file (24 giờ). */
  routes.get('/data-exports/:exportId/download', async (c) => {
    const query = parseQuery(c, dataExportDownloadQuerySchema);
    if (query.isErr()) return query.error;
    const result = await deps.downloadDataExport.execute({
      exportId: c.req.param('exportId'),
      expires: query.value.expires,
      signature: query.value.sig,
    });
    if (result.isErr()) return problemResponse(c, result.error);
    const doc = result.value;
    return c.json(
      { ...doc, files: doc.files.map((f) => ({ ...f, expiresAt: f.expiresAt.toISOString() })) },
      200,
      {
        'content-disposition': `attachment; filename="tamgiao-data-${doc.exportId}.json"`,
        'cache-control': 'no-store',
      },
    );
  });

  routes.post('/me/account/deletion/otp', deps.requireUser, async (c) =>
    sendResult(
      c,
      await deps.requestAccountDeletionOtp.execute({ userId: c.get('auth').userId, ip: c.get('clientIp') }),
    ),
  );

  routes.post('/me/account/deletion', deps.requireUser, async (c) => {
    const body = await parseBody(c, deleteAccountBodySchema);
    if (body.isErr()) return body.error;
    const result = await deps.deleteAccount.execute({
      userId: c.get('auth').userId,
      code: body.value.code,
      ip: c.get('clientIp'),
    });
    return sendResult(c, result.map(deletionDto), 202);
  });

  /** Tiến độ xoá — không cần đăng nhập (phiên đã bị thu hồi khi xoá). */
  routes.get('/account-deletions/:requestId', async (c) =>
    sendResult(c, (await deps.getAccountDeletionStatus.execute(c.req.param('requestId'))).map(deletionDto)),
  );

  return routes;
}
