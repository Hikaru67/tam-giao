import { updateProfileBodySchema, type ProfileResponse } from '@tamgiao/contracts';
import { parseBody, sendResult, type AppEnv } from '@tamgiao/http';
import { Hono, type MiddlewareHandler } from 'hono';
import type { GetProfile, ProfileView } from '../application/get-profile.js';
import type { SaveProfile } from '../application/save-profile.js';

export interface ProfileRoutesDeps {
  readonly saveProfile: SaveProfile;
  readonly getProfile: GetProfile;
  readonly requireUser: MiddlewareHandler<AppEnv>;
}

const toResponse = ({ profile: p, photos }: ProfileView): ProfileResponse => ({
  userId: p.userId,
  status: p.status,
  ...p.data,
  interests: [...p.data.interests],
  photos: photos.map((ph) => ({ ...ph })),
  completedAt: p.completedAt?.toISOString() ?? null,
  updatedAt: p.updatedAt.toISOString(),
});

export function createProfileRoutes(deps: ProfileRoutesDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.get('/me/profile', deps.requireUser, async (c) => {
    const view = await deps.getProfile.execute(c.get('auth').userId);
    return sendResult(c, view.map(toResponse));
  });

  routes.put('/me/profile', deps.requireUser, async (c) => {
    const body = await parseBody(c, updateProfileBodySchema);
    if (body.isErr()) return body.error;
    const { submit, interests, photos, ...fields } = body.value;
    const userId = c.get('auth').userId;

    const saved = await deps.saveProfile.execute({
      userId,
      submit: submit ?? false,
      data: {
        fullName: fields.fullName ?? null,
        birthDate: fields.birthDate ?? null,
        gender: fields.gender ?? null,
        hometown: fields.hometown ?? null,
        currentCity: fields.currentCity ?? null,
        education: fields.education ?? null,
        occupation: fields.occupation ?? null,
        religion: fields.religion ?? null,
        childrenPlan: fields.childrenPlan ?? null,
        bio: fields.bio || null,
        interests: interests ?? [],
        incomeRange: fields.incomeRange ?? null,
        housing: fields.housing ?? null,
        assets: fields.assets || null,
        photos: photos ?? [],
      },
    });
    if (saved.isErr()) return sendResult(c, saved);
    return sendResult(c, (await deps.getProfile.execute(userId)).map(toResponse));
  });

  return routes;
}
