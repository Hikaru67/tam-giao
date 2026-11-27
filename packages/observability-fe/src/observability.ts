import { isApiError, type ApiError } from '@tamgiao/api-client';
import type { FunnelStep } from './funnel.js';
import { scrubBreadcrumb, scrubEvent } from './scrub.js';

export interface ObservabilityInitOptions {
  dsn: string;
  environment?: string;
  release?: string;
  sendDefaultPii: false;
  tracesSampleRate: 0;
  beforeSend: <E extends object>(event: E) => E | null;
  beforeBreadcrumb: <B extends object>(breadcrumb: B) => B | null;
}

export interface ObservabilitySdk {
  init(options: ObservabilityInitOptions): void;
  captureException(error: unknown, context: { tags: Record<string, string> }): void;
  captureMessage(message: string, context: { level: 'info'; tags: Record<string, string> }): void;
  addBreadcrumb(breadcrumb: { category: string; message: string; level: 'info' }): void;
}

export interface CreateObservabilityOptions {
  dsn: string | undefined;
  sdk: ObservabilitySdk;
  environment?: string | undefined;
  release?: string | undefined;
}

export interface Observability {
  readonly enabled: boolean;
  captureError(error: unknown): void;
  trackFunnelStep(step: FunnelStep): void;
}

/**
 * Chỉ báo lỗi API lên Sentry khi là lỗi hệ thống (5xx) hoặc lệch schema phản hồi (`RESPONSE_INVALID`).
 * Các lỗi 4xx nghiệp vụ, mất mạng hoặc hết hạn phiên không phải bug app nên bỏ qua để tránh nhiễu.
 */
export function shouldReportApiError(error: ApiError): boolean {
  return error.status >= 500 || error.code === 'RESPONSE_INVALID';
}

/**
 * Tạo cấu hình khởi tạo SDK chuẩn hoá: tắt gửi PII mặc định, tắt tracing và luôn chạy scrub trước khi gửi.
 */
export function buildInitOptions(
  dsn: string,
  options?: { environment?: string | undefined; release?: string | undefined },
): ObservabilityInitOptions {
  const initOptions: ObservabilityInitOptions = {
    dsn,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend: (event) => scrubEvent(event),
    beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
  };

  if (options?.environment) {
    initOptions.environment = options.environment;
  }
  if (options?.release) {
    initOptions.release = options.release;
  }

  return initOptions;
}

/**
 * Khởi tạo lớp observability độc lập SDK; no-op hoàn toàn khi thiếu DSN.
 */
export function createObservability(options: CreateObservabilityOptions): Observability {
  const dsn = options.dsn?.trim();
  const enabled = Boolean(dsn);

  if (enabled && dsn !== undefined) {
    options.sdk.init(
      buildInitOptions(dsn, {
        environment: options.environment,
        release: options.release,
      }),
    );
  }

  return {
    enabled,

    captureError: (error: unknown): void => {
      if (!enabled) {
        return;
      }

      if (isApiError(error)) {
        if (!shouldReportApiError(error)) {
          return;
        }

        // Chỉ giữ mã lỗi, HTTP status và traceId; loại bỏ message/meta/fieldErrors/stack gốc có thể chứa PII.
        const sanitized = new Error(`${error.code} (HTTP ${error.status})`);
        sanitized.name = 'ApiError';

        const tags: Record<string, string> = {
          api_error_code: error.code,
          api_status: String(error.status),
        };
        if (error.traceId) {
          tags['traceId'] = error.traceId;
        }

        options.sdk.captureException(sanitized, { tags });
        return;
      }

      options.sdk.captureException(error, { tags: {} });
    },

    trackFunnelStep: (step: FunnelStep): void => {
      if (!enabled) {
        return;
      }

      options.sdk.addBreadcrumb({
        category: 'funnel',
        message: step,
        level: 'info',
      });
      options.sdk.captureMessage(`funnel:${step}`, {
        level: 'info',
        tags: { funnel_step: step },
      });
    },
  };
}
