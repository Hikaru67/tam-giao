import type { EventBus, JobHandler, RetryPolicy } from '@tamgiao/db';

export interface WorkerJob {
  readonly queue: string;
  readonly handler: JobHandler;
  readonly retry?: RetryPolicy;
}

/**
 * Nơi các module đăng ký consumer event (`bus.on(...)`) và job hẹn giờ.
 * Mỗi module export `registerXWorker(bus)` trả về danh sách job; thêm vào đây khi có (Sprint 2+).
 */
export function registerWorkers(_bus: EventBus): readonly WorkerJob[] {
  return [];
}
