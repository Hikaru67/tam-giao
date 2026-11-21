import {
  adminCandidateListQuerySchema,
  matchesBoardQuerySchema,
  proposeMatchBodySchema,
  type AdminCandidateListResponse,
  type MatchesBoardResponse,
  type ProposeMatchResponse,
} from '@tamgiao/contracts';
import {
  parseBody,
  parseQuery,
  problemResponse,
  sendResult,
  type AppEnv,
  type RequireAdmin,
} from '@tamgiao/http';
import { domainError } from '@tamgiao/kernel';
import { Hono } from 'hono';
import type { MatchBoardCursor } from '../application/ports/match-board-query.js';
import type { ProposeMatch } from '../application/propose-match.js';
import type { GetMatchesBoard } from '../application/queries/get-matches-board.js';
import type { ListCandidates } from '../application/queries/list-candidates.js';
import { snapshotToScoreDto, toPhotoDto, toScoreDto } from './match-dto-mappers.js';

export interface MatchAdminRoutesDeps {
  readonly proposeMatch: ProposeMatch;
  readonly listCandidates: ListCandidates;
  readonly getMatchesBoard: GetMatchesBoard;
  readonly requireAdmin: RequireAdmin;
}

/**
 * Cả ba route admin matching dùng `match:propose`: xem ứng viên và bảng theo dõi cặp là công việc của chính chuyên
 * viên mai mối (role `MATCHMAKER`; `SUPERVISOR`/`ADMIN` cũng có) — không thêm permission đọc riêng.
 */
const MATCH_PERMISSION = 'match:propose';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Phần `expiresAt` của cursor khi dòng cuối không có hạn (`MET`, trạng thái đóng). */
const NO_EXPIRY = '-';

/** Cursor mờ cho client: base64url của `<expiresAt ISO | ->|<id>`. */
const encodeCursor = (c: MatchBoardCursor): string =>
  Buffer.from(`${c.expiresAt?.toISOString() ?? NO_EXPIRY}|${c.id}`, 'utf8').toString('base64url');

function decodeCursor(raw: string): MatchBoardCursor | null {
  const [iso, id, ...rest] = Buffer.from(raw, 'base64url').toString('utf8').split('|');
  if (iso === undefined || id === undefined || rest.length > 0 || !UUID_PATTERN.test(id)) return null;
  if (iso === NO_EXPIRY) return { expiresAt: null, id };
  const expiresAt = new Date(iso);
  return Number.isNaN(expiresAt.getTime()) ? null : { expiresAt, id };
}

/**
 * Route admin "Điều phối mai mối" (BE-S5-07): `GET /admin/users/:id/candidates`, `POST /admin/matches`,
 * `GET /admin/matches`. Response chứa PII (họ tên, ảnh) — chỉ ở API admin, không log; `staffNote` không log.
 */
export function createMatchAdminRoutes(deps: MatchAdminRoutesDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  const admin = deps.requireAdmin(MATCH_PERMISSION);

  routes.get('/admin/users/:id/candidates', admin, async (c) => {
    const query = parseQuery(c, adminCandidateListQuerySchema);
    if (query.isErr()) return query.error;
    const result = await deps.listCandidates.execute({
      userId: c.req.param('id'),
      ...(query.value.limit === undefined ? {} : { limit: query.value.limit }),
    });
    return sendResult(
      c,
      result.map((items): AdminCandidateListResponse => ({
        items: items.map((v) => ({
          userId: v.userId,
          score: toScoreDto(v.score),
          commonPoints: [...v.commonPoints],
          profile:
            v.profile === null
              ? null
              : {
                  fullName: v.profile.fullName,
                  age: v.profile.age,
                  gender: v.profile.gender,
                  currentCity: v.profile.currentCity,
                  occupation: v.profile.occupation,
                  education: v.profile.education,
                  avatar: v.profile.avatar === null ? null : toPhotoDto(v.profile.avatar),
                },
        })),
      })),
    );
  });

  routes.post('/admin/matches', admin, async (c) => {
    const body = await parseBody(c, proposeMatchBodySchema);
    if (body.isErr()) return body.error;
    const ip = c.get('clientIp');
    const result = await deps.proposeMatch.execute({
      staffId: c.get('admin').adminId,
      userAId: body.value.userAId,
      userBId: body.value.userBId,
      staffNote: body.value.staffNote ?? null,
      ip: ip === 'unknown' ? null : ip,
    });
    return sendResult(
      c,
      result.map((v): ProposeMatchResponse => ({
        matchId: v.matchId,
        status: v.status,
        participantIds: [v.participantIds[0], v.participantIds[1]],
        score: snapshotToScoreDto(v.scoreSnapshot),
        expiresAt: v.expiresAt.toISOString(),
      })),
      201,
    );
  });

  routes.get('/admin/matches', admin, async (c) => {
    const query = parseQuery(c, matchesBoardQuerySchema);
    if (query.isErr()) return query.error;
    const { cursor: rawCursor, limit, status } = query.value;

    const cursor = rawCursor === undefined ? null : decodeCursor(rawCursor);
    if (rawCursor !== undefined && cursor === null) {
      return problemResponse(c, domainError('VALIDATION_FAILED'), {
        errors: [{ path: 'cursor', message: 'cursor không hợp lệ' }],
      });
    }

    const result = await deps.getMatchesBoard.execute({
      cursor,
      ...(status === undefined ? {} : { statuses: status }),
      ...(limit === undefined ? {} : { limit }),
    });
    return sendResult(
      c,
      result.map((page): MatchesBoardResponse => ({
        items: page.items.map((m) => ({
          matchId: m.matchId,
          status: m.status,
          participants: m.participants.map((p) => ({
            userId: p.userId,
            fullName: p.fullName,
            accepted: p.accepted,
          })),
          score: toScoreDto(m.score),
          expiresAt: m.expiresAt?.toISOString() ?? null,
          offeredAt: m.offeredAt.toISOString(),
          updatedAt: m.updatedAt.toISOString(),
          createdBy: m.createdBy,
        })),
        nextCursor: page.nextCursor === null ? null : encodeCursor(page.nextCursor),
      })),
    );
  });

  return routes;
}
