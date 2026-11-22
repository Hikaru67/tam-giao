import {
  notificationSettingsBodySchema,
  registerDeviceBodySchema,
  type DeviceResponse,
  type NotificationSettingsResponse,
} from '@tamgiao/contracts';
import { parseBody, problemResponse, sendResult, type AppEnv } from '@tamgiao/http';
import { Hono, type MiddlewareHandler } from 'hono';
import type {
  GetNotificationSettings,
  NotificationSettingsView,
  RegisterDevice,
  UnregisterDevice,
  UpdateNotificationSettings,
} from '../application/notification-settings.js';
import type { DeviceView } from '../application/ports/notification-settings-store.js';

export interface NotificationRoutesDeps {
  readonly registerDevice: RegisterDevice;
  readonly unregisterDevice: UnregisterDevice;
  readonly getSettings: GetNotificationSettings;
  readonly updateSettings: UpdateNotificationSettings;
  readonly requireUser: MiddlewareHandler<AppEnv>;
}

const toDevice = (d: DeviceView): DeviceResponse => ({
  deviceId: d.deviceId,
  platform: d.platform,
  registeredAt: d.registeredAt.toISOString(),
});

const toSettings = (s: NotificationSettingsView): NotificationSettingsResponse => ({
  matches: s.matches,
  messages: s.messages,
  dates: s.dates,
  alwaysOn: [...s.alwaysOn],
});

/**
 * Route người dùng app của module notification (BE-S7-05): `POST /me/devices` (đăng ký push token),
 * `DELETE /me/devices/:deviceId` (huỷ khi đăng xuất), `GET|PUT /me/notification-settings`.
 */
export function createNotificationRoutes(deps: NotificationRoutesDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.post('/me/devices', deps.requireUser, async (c) => {
    const body = await parseBody(c, registerDeviceBodySchema);
    if (body.isErr()) return body.error;
    const saved = await deps.registerDevice.execute({ userId: c.get('auth').userId, ...body.value });
    return sendResult(c, saved.map(toDevice), 201);
  });

  routes.delete('/me/devices/:deviceId', deps.requireUser, async (c) => {
    const result = await deps.unregisterDevice.execute({
      userId: c.get('auth').userId,
      deviceId: c.req.param('deviceId'),
    });
    return result.isErr() ? problemResponse(c, result.error) : c.body(null, 204);
  });

  routes.get('/me/notification-settings', deps.requireUser, async (c) =>
    sendResult(c, (await deps.getSettings.execute(c.get('auth').userId)).map(toSettings)),
  );

  routes.put('/me/notification-settings', deps.requireUser, async (c) => {
    const body = await parseBody(c, notificationSettingsBodySchema);
    if (body.isErr()) return body.error;
    const saved = await deps.updateSettings.execute({
      userId: c.get('auth').userId,
      preferences: body.value,
    });
    return sendResult(c, saved.map(toSettings));
  });

  return routes;
}
