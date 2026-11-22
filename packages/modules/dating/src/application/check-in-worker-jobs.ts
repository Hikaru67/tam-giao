import { newId, ok, parseId, type Clock, type Scheduler, type Tx, type UnitOfWork } from '@tamgiao/kernel';
import { SafetyCheckIn, type OverdueSkipReason } from '../domain/safety-check-in.js';
import { checkInOverdueJob, type CheckInOverduePayload } from './check-in-jobs.js';
import type { DatePlanRepository } from './ports/date-plan-repository.js';
import type { CheckInLocationStore, SafetyCheckInRepository } from './ports/safety-check-in-repository.js';

/** Chạy `executeIn` trong transaction riêng (test, gọi trực tiếp). */
async function inOwnTx<T>(uow: UnitOfWork, work: (tx: Tx) => Promise<T>): Promise<T> {
  const result = await uow.run(async (tx) => ok(await work(tx)));
  if (result.isErr()) throw new Error('unreachable');
  return result.value;
}

// ── Consumer VoucherRedeemed → check-in ───────────────────────────────────────────────────────────

export interface CheckInOnVoucherRedeemedCommand {
  /** Chủ voucher (`VoucherRedeemedPayload.userId`). */
  readonly userId: string;
  readonly partnerId: string;
  /** Lúc quán quét voucher (`occurredAt` của event) — không dùng giờ xử lý vì hàng đợi có thể trễ. */
  readonly redeemedAt: Date;
}

/**
 * - `CHECKED_IN`: tạo check-in nguồn `VOUCHER` (+ lịch `CHECKED_IN` nếu là người đầu tiên), hẹn job quá hạn.
 * - `ALREADY_CHECKED_IN`: người dùng đã check-in lịch này (thủ công trước khi quét, hoặc event giao lại) → no-op.
 * - `NO_DATE_PLAN`: không có lịch `CONFIRMED | CHECKED_IN` của người dùng tại quán này mà khung giờ chứa lúc quét
 *   (voucher dùng ngoài buổi hẹn) → no-op.
 */
export type CheckInOnVoucherRedeemedOutcome =
  | { readonly kind: 'CHECKED_IN' | 'ALREADY_CHECKED_IN'; readonly datePlanId: string; readonly checkInId: string }
  | { readonly kind: 'NO_DATE_PLAN' };

export interface CheckInOnVoucherRedeemedDeps {
  readonly scheduler: Scheduler;
  readonly datePlans: DatePlanRepository;
  readonly checkIns: SafetyCheckInRepository;
}

/**
 * Consumer `VoucherRedeemed` (billing; consumer `dating.check-in-on-voucher-redeemed`, BE-S7-02): quán quét voucher của
 * người dùng = người đó đang ở quán → tự đánh dấu check-in. Chạy trong transaction của `deliverOnce` (cùng
 * `processed_events`). Idempotent (A9) hai lớp: `processed_events` + khoá lịch `FOR UPDATE` rồi kiểm tra lại check-in
 * hiện có (unique (lịch, người) ở DB là chốt chặn cuối).
 */
export class CheckInOnVoucherRedeemed {
  constructor(private readonly deps: CheckInOnVoucherRedeemedDeps) {}

  async handle(tx: Tx, cmd: CheckInOnVoucherRedeemedCommand): Promise<CheckInOnVoucherRedeemedOutcome> {
    const { datePlans, checkIns } = this.deps;
    const at = cmd.redeemedAt;
    const plan = await datePlans.findForVoucherCheckInForUpdate(tx, {
      userId: cmd.userId,
      partnerId: cmd.partnerId,
      at,
    });
    if (plan === null) return { kind: 'NO_DATE_PLAN' };
    const existing = await checkIns.findByPlanAndUser(tx, plan.id, cmd.userId);
    if (existing !== null) {
      return { kind: 'ALREADY_CHECKED_IN', datePlanId: plan.id, checkInId: existing.id };
    }
    const started = SafetyCheckIn.start(
      { id: newId<'SafetyCheckIn'>(), plan, existing, userId: cmd.userId, source: 'VOUCHER', locationShared: false },
      at,
    );
    // Repository đã lọc người trong cặp + trạng thái + khung giờ → lỗi ở đây là lỗi lập trình / dữ liệu.
    if (started.isErr()) throw new Error(`dating.check-in-on-voucher-redeemed ${plan.id}: ${started.error.code}`);
    const checkIn = started.value;
    const savedPlan = await datePlans.save(tx, plan);
    if (savedPlan.isErr()) throw new Error(`dating.date_plans ${plan.id}: ${savedPlan.error.code} khi check-in`);
    const saved = await checkIns.save(tx, checkIn);
    if (saved.isErr()) throw new Error(`dating.safety_check_ins ${plan.id}: ${saved.error.code}`);
    await this.deps.scheduler.schedule(tx, checkInOverdueJob(checkIn));
    return { kind: 'CHECKED_IN', datePlanId: plan.id, checkInId: checkIn.id };
  }
}

// ── Job quá hạn check-out ─────────────────────────────────────────────────────────────────────────

/**
 * - `ALERTED`: chưa check-out quá `overdueAt` → `DateCheckInOverdue` vào outbox (cảnh báo chuyên viên).
 * - `CHECKED_OUT` | `ALREADY_ALERTED` | `NOT_YET_DUE`: no-op.
 * - `NOT_FOUND`: không có check-in → no-op.
 */
export type MarkCheckInOverdueOutcome =
  | { readonly kind: 'ALERTED' }
  | { readonly kind: OverdueSkipReason }
  | { readonly kind: 'NOT_FOUND' };

export interface MarkCheckInOverdueDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly checkIns: SafetyCheckInRepository;
}

/**
 * Handler job `dating.check-in-overdue` (BE-S7-02, AC2). Idempotent (A9): khoá check-in `FOR UPDATE` (tuần tự hoá với
 * check-out) rồi để domain `markOverdue(now)` quyết định — cảnh báo tối đa một lần. Payload sai dạng → throw.
 */
export class MarkCheckInOverdue {
  constructor(private readonly deps: MarkCheckInOverdueDeps) {}

  execute(payload: CheckInOverduePayload): Promise<MarkCheckInOverdueOutcome> {
    return inOwnTx(this.deps.uow, (tx) => this.executeIn(tx, payload));
  }

  async executeIn(tx: Tx, payload: CheckInOverduePayload): Promise<MarkCheckInOverdueOutcome> {
    const id = parseId<'SafetyCheckIn'>(payload.checkInId);
    if (id.isErr()) throw new Error('dating.check-in-overdue: checkInId không hợp lệ');
    const checkIn = await this.deps.checkIns.findByIdForUpdate(tx, id.value);
    if (checkIn === null) return { kind: 'NOT_FOUND' };
    const marked = checkIn.markOverdue(this.deps.clock.now());
    if (marked.isErr()) return { kind: marked.error };
    const saved = await this.deps.checkIns.save(tx, checkIn);
    if (saved.isErr()) throw new Error(`dating.safety_check_ins ${checkIn.id}: ${saved.error.code} khi cảnh báo`);
    return { kind: 'ALERTED' };
  }
}

// ── Job xoá vị trí hết hạn lưu ────────────────────────────────────────────────────────────────────

export interface PurgeCheckInLocationsOutcome {
  readonly purged: number;
}

export interface PurgeCheckInLocationsDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly locations: CheckInLocationStore;
}

/**
 * Handler job `dating.purge-check-in-locations` (BE-S7-02, AC1): xoá mọi vị trí thô có `purge_after <= now`
 * (`CHECK_IN_LOCATION_RETENTION_HOURS` giờ sau khi ghi nhận). Mỗi lần chạy quét toàn bộ nên job bị lỡ / chạy lại vẫn
 * đúng (A9).
 */
export class PurgeCheckInLocations {
  constructor(private readonly deps: PurgeCheckInLocationsDeps) {}

  execute(): Promise<PurgeCheckInLocationsOutcome> {
    return inOwnTx(this.deps.uow, (tx) => this.executeIn(tx));
  }

  async executeIn(tx: Tx): Promise<PurgeCheckInLocationsOutcome> {
    return { purged: await this.deps.locations.purgeExpired(tx, this.deps.clock.now()) };
  }
}
