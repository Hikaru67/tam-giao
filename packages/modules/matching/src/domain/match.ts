import { DATING_DAYS, OFFER_TTL_HOURS, RESPONSE_TTL_HOURS } from '@tamgiao/contracts/constants';
import {
  AggregateRoot,
  addDuration,
  fail,
  ok,
  type DomainError,
  type Id,
  type Result,
} from '@tamgiao/kernel';
import {
  MATCH_AWAITING_RESPONSE,
  MATCH_CLOSED,
  MATCH_DECLINED,
  MATCH_EXPIRED,
  MATCH_LOCKED,
  MATCH_MET,
  MATCH_OFFERED,
  MATCH_STARTED_DATING,
} from './match-events.js';

export type MatchId = Id<'Match'>;
/** Id tài khoản app (module identity) — matching chỉ giữ tham chiếu, không import domain identity (A3). */
export type MatchUserId = string;
/** Id chuyên viên (admin) tạo đề xuất. */
export type MatchStaffId = string;

/**
 * Trạng thái vòng đời ghép đôi (ARCHITECTURE mục 5).
 * Mở: `OFFERED`, `AWAITING_RESPONSE`, `DATING`, `MET`. Đóng (trạng thái cuối): `CLOSED_SUCCESS`,
 * `CLOSED_STOPPED`, `EXPIRED`, `DECLINED`, `LOCKED`.
 */
export const MATCH_STATUSES = [
  'OFFERED',
  'AWAITING_RESPONSE',
  'DATING',
  'MET',
  'CLOSED_SUCCESS',
  'CLOSED_STOPPED',
  'EXPIRED',
  'DECLINED',
  'LOCKED',
] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

export const OPEN_MATCH_STATUSES = ['OFFERED', 'AWAITING_RESPONSE', 'DATING', 'MET'] as const;
export type OpenMatchStatus = (typeof OPEN_MATCH_STATUSES)[number];

/** Kết quả đóng match: `SUCCESS` (cả hai chọn tiếp tục sau buổi gặp) | `STOPPED` (dừng). */
export const MATCH_CLOSE_OUTCOMES = ['SUCCESS', 'STOPPED'] as const;
export type MatchCloseOutcome = (typeof MATCH_CLOSE_OUTCOMES)[number];

/** Nguyên nhân đóng match trong event `MatchClosed`: thao tác `close()` hay hết `DATING_DAYS` (`expire()`). */
export const MATCH_CLOSE_TRIGGERS = ['MANUAL', 'DATING_PERIOD_ENDED'] as const;
export type MatchCloseTrigger = (typeof MATCH_CLOSE_TRIGGERS)[number];

/**
 * Snapshot điểm tương hợp lúc đề xuất (dữ liệu thuần, không phụ thuộc `CompatibilityScorer` của BE-S5-03):
 * tổng 0–100 và điểm từng trụ cột (key → 0–100). Giữ nguyên để màn hình hiển thị đúng con số đã gửi.
 */
export interface MatchScoreSnapshot {
  readonly total: number;
  readonly pillars: Readonly<Record<string, number>>;
}

export type MatchTransitionError = DomainError<'INVALID_TRANSITION'>;
/** Lỗi của các thao tác người trong cặp: `accept`, `decline`, `withdraw`. */
export type MatchResponseError = DomainError<
  'INVALID_TRANSITION' | 'NOT_PARTICIPANT' | 'ALREADY_RESPONDED' | 'OFFER_EXPIRED'
>;
export type MatchExpireError = DomainError<'NOT_YET_EXPIRED'>;

/** Snapshot đầy đủ để repository lưu / dựng lại aggregate (`toState` ↔ `restore`). */
export interface MatchState {
  readonly id: MatchId;
  /** Hai người trong cặp (khác nhau), giữ đúng thứ tự lúc đề xuất. */
  readonly participants: readonly [MatchUserId, MatchUserId];
  readonly createdBy: MatchStaffId;
  readonly scoreSnapshot: MatchScoreSnapshot | null;
  /** Lời nhắn / ghi chú chuyên viên — có thể chứa thông tin cá nhân, KHÔNG đưa vào event. */
  readonly staffNote: string | null;
  readonly status: MatchStatus;
  /** Những người đã bấm "Đồng ý kết nối", theo thứ tự (0, 1 hoặc 2 phần tử). */
  readonly acceptedBy: readonly MatchUserId[];
  /**
   * Hạn của trạng thái hiện tại: `OFFERED` = lúc đề xuất + `OFFER_TTL_HOURS`; `AWAITING_RESPONSE` = lúc bên thứ nhất
   * đồng ý + `RESPONSE_TTL_HOURS`; `DATING` = lúc bên thứ hai đồng ý + `DATING_DAYS`. `MET` và trạng thái đóng → `null`.
   */
  readonly expiresAt: Date | null;
  readonly offeredAt: Date;
  readonly datingStartedAt: Date | null;
  readonly metAt: Date | null;
  /** Thời điểm vào trạng thái đóng (bất kỳ). */
  readonly closedAt: Date | null;
  /** Người từ chối / rút lời ngỏ (`DECLINED`). */
  readonly declinedBy: MatchUserId | null;
  /** Lý do bỏ qua người dùng chọn — có thể là văn bản tự do, KHÔNG đưa vào event. */
  readonly declineReason: string | null;
  /** `true` khi `DECLINED` do người đã đồng ý rút lời ngỏ (`withdraw`), `false` khi do `decline`. */
  readonly withdrawn: boolean;
  /** Kết quả khi `CLOSED_SUCCESS | CLOSED_STOPPED`. */
  readonly closeOutcome: MatchCloseOutcome | null;
  /** Mã lý do khoá (vd `REPORT_FILED`) — mã phân loại, không PII. */
  readonly lockReason: string | null;
  readonly updatedAt: Date;
  readonly version: number;
}

type MutableState = Omit<MatchState, 'version'>;

type Action = 'accept' | 'decline' | 'withdraw' | 'markMet' | 'close' | 'lock';

const isOpenStatus = (status: MatchStatus): status is OpenMatchStatus =>
  (OPEN_MATCH_STATUSES as readonly MatchStatus[]).includes(status);

const invalidTransition = (
  action: Action,
  status: MatchStatus,
  reason?: string,
): Result<never, MatchTransitionError> =>
  fail('INVALID_TRANSITION', reason === undefined ? { action, status } : { action, status, reason });

const assertScore = (value: number, field: string): void => {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`Điểm tương hợp ${field} phải trong khoảng 0–100`);
  }
};

/**
 * Aggregate `Match` — vòng đời một lần ghép đôi giữa hai người do chuyên viên đề xuất (ARCHITECTURE mục 5).
 *
 * Bảng chuyển trạng thái (hành động không liệt kê ở một trạng thái → `INVALID_TRANSITION`; test bảng trong
 * `match.test.ts` phủ đủ 9 trạng thái × mọi hành động):
 *
 * - OFFERED
 *   - accept(A|B)               → AWAITING_RESPONSE   (hạn mới = now + RESPONSE_TTL_HOURS)
 *   - decline(A|B)              → DECLINED
 *   - expire (now ≥ expiresAt)  → EXPIRED
 *   - lock                      → LOCKED
 * - AWAITING_RESPONSE (X đã đồng ý, Y chưa)
 *   - accept(Y)                 → DATING              (hạn mới = now + DATING_DAYS); accept(X) → ALREADY_RESPONDED
 *   - decline(Y)                → DECLINED            ; decline(X) → ALREADY_RESPONDED (X dùng withdraw)
 *   - withdraw(X)               → DECLINED{withdrawn} ; withdraw(Y) → INVALID_TRANSITION
 *   - expire (now ≥ expiresAt)  → EXPIRED
 *   - lock                      → LOCKED
 * - DATING
 *   - markMet                   → MET                 (bỏ hạn)
 *   - close(STOPPED)            → CLOSED_STOPPED      ; close(SUCCESS) → INVALID_TRANSITION (chưa gặp)
 *   - expire (now ≥ expiresAt)  → CLOSED_STOPPED      (hết DATING_DAYS — ARCHITECTURE mục 5)
 *   - lock                      → LOCKED
 * - MET
 *   - close(SUCCESS)            → CLOSED_SUCCESS
 *   - close(STOPPED)            → CLOSED_STOPPED
 *   - expire                    → no-op `ok()`        (không có hạn; job cũ của DATING)
 *   - lock                      → LOCKED
 * - CLOSED_SUCCESS | CLOSED_STOPPED | EXPIRED | DECLINED | LOCKED (đã đóng)
 *   - expire                    → no-op `ok()`        (idempotent cho job)
 *   - mọi hành động khác        → INVALID_TRANSITION
 *
 * Event: accept → `MatchAwaitingResponse` / `MatchStartedDating`; decline, withdraw → `MatchDeclined{withdrawn}`;
 * expire → `MatchExpired` (OFFERED/AWAITING_RESPONSE) hoặc `MatchClosed{STOPPED, DATING_PERIOD_ENDED}` (DATING);
 * markMet → `MatchMet`; close → `MatchClosed{outcome, MANUAL}`; lock → `MatchLocked`. No-op và lỗi không phát event,
 * không đổi state, không tăng `version`.
 *
 * Thứ tự kiểm tra của `accept` / `decline` / `withdraw`: người ngoài cặp → `NOT_PARTICIPANT` (trước mọi kiểm tra
 * khác, không lộ trạng thái cho người ngoài) → trạng thái không hợp lệ → `INVALID_TRANSITION` → đã phản hồi →
 * `ALREADY_RESPONDED` → quá hạn → `OFFER_EXPIRED`.
 *
 * Quy ước biên thời gian: match coi là quá hạn khi `now >= expiresAt`. Tại đúng `expiresAt`: `accept`/`decline`/
 * `withdraw` → `OFFER_EXPIRED`, `expire` thành công. Sau hạn chỉ còn `expire()` (và `lock`) được phép đổi trạng thái
 * OFFERED/AWAITING_RESPONSE, để job hết hạn và thao tác người dùng luôn cho cùng một kết quả.
 * `markMet` / `close` (thao tác hệ thống/chuyên viên ở DATING/MET) không kiểm tra hạn.
 */
export class Match extends AggregateRoot<MatchId> {
  protected readonly aggregateType = 'Match';

  private constructor(
    private state: MutableState,
    version: number,
  ) {
    super(state.id, version);
  }

  /**
   * Chuyên viên đề xuất ghép đôi: tạo match `OFFERED`, hạn `OFFER_TTL_HOURS`, phát `MatchOffered`.
   * Hai người phải khác nhau và điểm trong 0–100 (vi phạm là lỗi lập trình của tầng trên → `throw`).
   */
  static offer(
    input: {
      readonly id: MatchId;
      readonly participants: readonly [MatchUserId, MatchUserId];
      readonly createdBy: MatchStaffId;
      readonly scoreSnapshot?: MatchScoreSnapshot | null;
      readonly staffNote?: string | null;
    },
    now: Date,
  ): Match {
    const [first, second] = input.participants;
    if (first === second) throw new Error('Match cần hai người khác nhau');
    const snapshot = input.scoreSnapshot ?? null;
    if (snapshot) {
      assertScore(snapshot.total, 'total');
      for (const [key, value] of Object.entries(snapshot.pillars)) assertScore(value, key);
    }

    const expiresAt = addDuration(now, { hours: OFFER_TTL_HOURS });
    const match = new Match(
      {
        id: input.id,
        participants: [first, second],
        createdBy: input.createdBy,
        scoreSnapshot: snapshot ? { total: snapshot.total, pillars: { ...snapshot.pillars } } : null,
        staffNote: input.staffNote ?? null,
        status: 'OFFERED',
        acceptedBy: [],
        expiresAt,
        offeredAt: now,
        datingStartedAt: null,
        metAt: null,
        closedAt: null,
        declinedBy: null,
        declineReason: null,
        withdrawn: false,
        closeOutcome: null,
        lockReason: null,
        updatedAt: now,
      },
      0,
    );
    match.record(
      MATCH_OFFERED,
      {
        matchId: match.id,
        participantIds: [first, second],
        createdBy: input.createdBy,
        expiresAt: expiresAt.toISOString(),
      },
      now,
    );
    return match;
  }

  static restore(state: MatchState): Match {
    const { version, ...rest } = state;
    return new Match({ ...rest, participants: [rest.participants[0], rest.participants[1]] }, version);
  }

  get participants(): readonly [MatchUserId, MatchUserId] {
    return this.state.participants;
  }

  get createdBy(): MatchStaffId {
    return this.state.createdBy;
  }

  get scoreSnapshot(): MatchScoreSnapshot | null {
    return this.state.scoreSnapshot;
  }

  get staffNote(): string | null {
    return this.state.staffNote;
  }

  get status(): MatchStatus {
    return this.state.status;
  }

  get expiresAt(): Date | null {
    return this.state.expiresAt;
  }

  get acceptedBy(): readonly MatchUserId[] {
    return this.state.acceptedBy;
  }

  get closeOutcome(): MatchCloseOutcome | null {
    return this.state.closeOutcome;
  }

  isParticipant(userId: MatchUserId): boolean {
    return this.state.participants.includes(userId);
  }

  /** Đối phương của `userId`; `null` nếu `userId` không thuộc cặp. */
  counterpartOf(userId: MatchUserId): MatchUserId | null {
    const [first, second] = this.state.participants;
    if (userId === first) return second;
    if (userId === second) return first;
    return null;
  }

  hasAccepted(userId: MatchUserId): boolean {
    return this.state.acceptedBy.includes(userId);
  }

  /** Match còn mở (`OFFERED | AWAITING_RESPONSE | DATING | MET`) — đang giữ active slot của hai người. */
  isOpen(): boolean {
    return isOpenStatus(this.state.status);
  }

  /** `true` khi trạng thái hiện tại có hạn và `now >= expiresAt` (không xét trạng thái). */
  isPastExpiry(now: Date): boolean {
    return this.state.expiresAt !== null && now.getTime() >= this.state.expiresAt.getTime();
  }

  /**
   * "Đồng ý kết nối". OFFERED → AWAITING_RESPONSE (hạn mới `RESPONSE_TTL_HOURS`, `MatchAwaitingResponse`);
   * AWAITING_RESPONSE + bên còn lại → DATING (hạn `DATING_DAYS`, `MatchStartedDating`); người đã đồng ý bấm lại →
   * `ALREADY_RESPONDED`.
   */
  accept(by: MatchUserId, now: Date): Result<void, MatchResponseError> {
    if (!this.isParticipant(by)) return fail('NOT_PARTICIPANT');
    const { status } = this.state;
    if (status !== 'OFFERED' && status !== 'AWAITING_RESPONSE') return invalidTransition('accept', status);
    if (this.hasAccepted(by)) return fail('ALREADY_RESPONDED', { status });
    if (this.isPastExpiry(now)) return this.offerExpired(status);

    if (status === 'OFFERED') {
      const expiresAt = addDuration(now, { hours: RESPONSE_TTL_HOURS });
      this.state = {
        ...this.state,
        status: 'AWAITING_RESPONSE',
        acceptedBy: [by],
        expiresAt,
        updatedAt: now,
      };
      this.record(
        MATCH_AWAITING_RESPONSE,
        {
          matchId: this.id,
          participantIds: this.participantIds(),
          acceptedBy: by,
          awaitingUserId: this.counterpartOf(by),
          expiresAt: expiresAt.toISOString(),
        },
        now,
      );
      return ok();
    }

    const expiresAt = addDuration(now, { days: DATING_DAYS });
    this.state = {
      ...this.state,
      status: 'DATING',
      acceptedBy: [...this.state.acceptedBy, by],
      expiresAt,
      datingStartedAt: now,
      updatedAt: now,
    };
    this.record(
      MATCH_STARTED_DATING,
      { matchId: this.id, participantIds: this.participantIds(), expiresAt: expiresAt.toISOString() },
      now,
    );
    return ok();
  }

  /**
   * "Bỏ qua": OFFERED (bất kỳ bên nào) hoặc AWAITING_RESPONSE (chỉ bên chưa đồng ý) → DECLINED, phát
   * `MatchDeclined{withdrawn:false}`. Người đã đồng ý muốn huỷ phải dùng `withdraw` → ở đây trả `ALREADY_RESPONDED`.
   * `reason` lưu trong state, không đưa vào event (có thể là văn bản tự do).
   */
  decline(by: MatchUserId, reason: string | null, now: Date): Result<void, MatchResponseError> {
    if (!this.isParticipant(by)) return fail('NOT_PARTICIPANT');
    const { status } = this.state;
    if (status !== 'OFFERED' && status !== 'AWAITING_RESPONSE') return invalidTransition('decline', status);
    if (this.hasAccepted(by)) return fail('ALREADY_RESPONDED', { status });
    if (this.isPastExpiry(now)) return this.offerExpired(status);
    this.toDeclined(by, reason, false, now);
    return ok();
  }

  /**
   * "Rút lại lời ngỏ" (màn 9): chỉ ở AWAITING_RESPONSE và chỉ bởi người ĐÃ đồng ý → DECLINED, phát
   * `MatchDeclined{withdrawn:true}`. Bên chưa đồng ý không có gì để rút (dùng `decline`) → `INVALID_TRANSITION`.
   */
  withdraw(by: MatchUserId, now: Date): Result<void, MatchResponseError> {
    if (!this.isParticipant(by)) return fail('NOT_PARTICIPANT');
    const { status } = this.state;
    if (status !== 'AWAITING_RESPONSE') return invalidTransition('withdraw', status);
    if (!this.hasAccepted(by)) return invalidTransition('withdraw', status, 'not_accepted');
    if (this.isPastExpiry(now)) return this.offerExpired(status);
    this.toDeclined(by, null, true, now);
    return ok();
  }

  /**
   * Job hết hạn (idempotent):
   * - OFFERED / AWAITING_RESPONSE, `now >= expiresAt` → EXPIRED, phát `MatchExpired`.
   * - DATING, `now >= expiresAt` (hết `DATING_DAYS`) → CLOSED_STOPPED, phát `MatchClosed{STOPPED, DATING_PERIOD_ENDED}`
   *   (ARCHITECTURE mục 5: "stop / hết 14 ngày → CLOSED_STOPPED").
   * - Chưa tới hạn → `NOT_YET_EXPIRED` (vd job cũ của OFFERED chạy khi match đã sang AWAITING_RESPONSE với hạn mới).
   * - MET (không có hạn, job cũ của DATING) và mọi trạng thái đóng → `ok()` no-op, không event.
   */
  expire(now: Date): Result<void, MatchExpireError> {
    const { status } = this.state;
    if (status !== 'OFFERED' && status !== 'AWAITING_RESPONSE' && status !== 'DATING') return ok();
    const { expiresAt } = this.state;
    if (!this.isPastExpiry(now)) {
      return fail('NOT_YET_EXPIRED', { status, expiresAt: expiresAt?.toISOString() ?? null });
    }

    if (status === 'DATING') {
      this.toClosed('STOPPED', 'DATING_PERIOD_ENDED', now);
      return ok();
    }

    this.state = { ...this.state, status: 'EXPIRED', expiresAt: null, closedAt: now, updatedAt: now };
    this.record(
      MATCH_EXPIRED,
      {
        matchId: this.id,
        participantIds: this.participantIds(),
        fromStatus: status,
        acceptedBy: [...this.state.acceptedBy],
      },
      now,
    );
    return ok();
  }

  /** Buổi hẹn đã diễn ra: DATING → MET (bỏ hạn `DATING_DAYS`, chờ feedback), phát `MatchMet`. */
  markMet(now: Date): Result<void, MatchTransitionError> {
    const { status } = this.state;
    if (status !== 'DATING') return invalidTransition('markMet', status);
    this.state = { ...this.state, status: 'MET', expiresAt: null, metAt: now, updatedAt: now };
    this.record(MATCH_MET, { matchId: this.id, participantIds: this.participantIds() }, now);
    return ok();
  }

  /**
   * Đóng match: DATING + `STOPPED` (một bên dừng tìm hiểu) → CLOSED_STOPPED; MET + `SUCCESS` → CLOSED_SUCCESS;
   * MET + `STOPPED` → CLOSED_STOPPED. DATING + `SUCCESS` (chưa gặp) và mọi trạng thái khác → `INVALID_TRANSITION`.
   * Phát `MatchClosed{outcome, MANUAL}`.
   */
  close(outcome: MatchCloseOutcome, now: Date): Result<void, MatchTransitionError> {
    const { status } = this.state;
    const allowed = status === 'MET' || (status === 'DATING' && outcome === 'STOPPED');
    if (!allowed) {
      return invalidTransition('close', status, status === 'DATING' ? 'not_met_yet' : undefined);
    }
    this.toClosed(outcome, 'MANUAL', now);
    return ok();
  }

  /**
   * Khoá match (vd có báo cáo an toàn `ReportFiled`): mọi trạng thái mở → LOCKED, phát `MatchLocked`.
   * `reason` là mã phân loại (không PII). Match đã đóng (kể cả đã LOCKED) → `INVALID_TRANSITION`.
   */
  lock(reason: string, now: Date): Result<void, MatchTransitionError> {
    const { status } = this.state;
    if (!isOpenStatus(status)) return invalidTransition('lock', status);
    this.state = {
      ...this.state,
      status: 'LOCKED',
      expiresAt: null,
      closedAt: now,
      lockReason: reason,
      updatedAt: now,
    };
    this.record(
      MATCH_LOCKED,
      { matchId: this.id, participantIds: this.participantIds(), fromStatus: status, reason },
      now,
    );
    return ok();
  }

  toState(): MatchState {
    return { ...this.state, version: this.version };
  }

  private participantIds(): MatchUserId[] {
    return [...this.state.participants];
  }

  private offerExpired(status: MatchStatus): Result<never, MatchResponseError> {
    return fail('OFFER_EXPIRED', { status, expiresAt: this.state.expiresAt?.toISOString() ?? null });
  }

  private toDeclined(by: MatchUserId, reason: string | null, withdrawn: boolean, now: Date): void {
    const fromStatus = this.state.status;
    this.state = {
      ...this.state,
      status: 'DECLINED',
      expiresAt: null,
      closedAt: now,
      declinedBy: by,
      declineReason: reason,
      withdrawn,
      updatedAt: now,
    };
    this.record(
      MATCH_DECLINED,
      { matchId: this.id, participantIds: this.participantIds(), declinedBy: by, fromStatus, withdrawn },
      now,
    );
  }

  private toClosed(outcome: MatchCloseOutcome, trigger: MatchCloseTrigger, now: Date): void {
    const fromStatus = this.state.status;
    this.state = {
      ...this.state,
      status: outcome === 'SUCCESS' ? 'CLOSED_SUCCESS' : 'CLOSED_STOPPED',
      expiresAt: null,
      closedAt: now,
      closeOutcome: outcome,
      updatedAt: now,
    };
    this.record(
      MATCH_CLOSED,
      { matchId: this.id, participantIds: this.participantIds(), outcome, fromStatus, trigger },
      now,
    );
  }
}
