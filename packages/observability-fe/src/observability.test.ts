import { ApiError } from '@tamgiao/api-client';
import { describe, expect, it } from 'vitest';
import {
  createObservability,
  shouldReportApiError,
  type ObservabilityInitOptions,
  type ObservabilitySdk,
} from './observability.js';
import { REDACTED } from './scrub.js';

interface RecordedSdk extends ObservabilitySdk {
  initCalls: ObservabilityInitOptions[];
  exceptionCalls: { error: unknown; context: { tags: Record<string, string> } }[];
  messageCalls: {
    message: string;
    context: { level: 'info'; tags: Record<string, string> };
  }[];
  breadcrumbCalls: { category: string; message: string; level: 'info' }[];
}

function createFakeSdk(): RecordedSdk {
  const initCalls: ObservabilityInitOptions[] = [];
  const exceptionCalls: { error: unknown; context: { tags: Record<string, string> } }[] = [];
  const messageCalls: {
    message: string;
    context: { level: 'info'; tags: Record<string, string> };
  }[] = [];
  const breadcrumbCalls: { category: string; message: string; level: 'info' }[] = [];

  return {
    initCalls,
    exceptionCalls,
    messageCalls,
    breadcrumbCalls,
    init: (options) => {
      initCalls.push(options);
    },
    captureException: (error, context) => {
      exceptionCalls.push({ error, context });
    },
    captureMessage: (message, context) => {
      messageCalls.push({ message, context });
    },
    addBreadcrumb: (breadcrumb) => {
      breadcrumbCalls.push(breadcrumb);
    },
  };
}

describe('createObservability', () => {
  it('becomes a complete no-op when DSN is missing or blank', () => {
    for (const dsn of [undefined, '', '   ']) {
      const sdk = createFakeSdk();
      const obs = createObservability({ dsn, sdk });

      expect(obs.enabled).toBe(false);
      expect(sdk.initCalls).toHaveLength(0);

      obs.captureError(new Error('x'));
      obs.trackFunnelStep('signed_in');

      expect(sdk.exceptionCalls).toHaveLength(0);
      expect(sdk.messageCalls).toHaveLength(0);
      expect(sdk.breadcrumbCalls).toHaveLength(0);
    }
  });

  it('initializes SDK once with PII disabled and attaches scrubbing hooks', () => {
    const sdk = createFakeSdk();
    const obs = createObservability({
      dsn: 'https://key@o0.ingest.sentry.io/1',
      environment: 'test',
      sdk,
    });

    expect(obs.enabled).toBe(true);
    expect(sdk.initCalls).toHaveLength(1);

    const initOpts = sdk.initCalls[0];
    expect(initOpts).toBeDefined();
    if (!initOpts) {
      return;
    }

    expect(initOpts.dsn).toBe('https://key@o0.ingest.sentry.io/1');
    expect(initOpts.environment).toBe('test');
    expect('release' in initOpts).toBe(false);
    expect(initOpts.sendDefaultPii).toBe(false);
    expect(initOpts.tracesSampleRate).toBe(0);

    const scrubbedEvent = initOpts.beforeSend({ message: 'gọi 0912345678' });
    expect(scrubbedEvent?.message).not.toContain('0912345678');

    const scrubbedBreadcrumb = initOpts.beforeBreadcrumb({
      category: 'chat',
      data: { content: 'bí mật' },
    });
    expect(scrubbedBreadcrumb?.data).toEqual({ content: REDACTED });
  });

  it('sanitizes reportable ApiError and attaches traceId tag when present', () => {
    const sdk = createFakeSdk();
    const obs = createObservability({
      dsn: 'https://key@o0.ingest.sentry.io/1',
      sdk,
    });

    obs.captureError(
      new ApiError({
        code: 'INTERNAL_ERROR',
        status: 500,
        message: 'chi tiết thô 0912345678',
        traceId: 'trace-abc',
      }),
    );

    expect(sdk.exceptionCalls).toHaveLength(1);
    const call = sdk.exceptionCalls[0];
    expect(call).toBeDefined();
    if (!call) {
      return;
    }

    expect(call.error).toBeInstanceOf(Error);
    if (call.error instanceof Error) {
      expect(call.error.name).toBe('ApiError');
      expect(call.error.message).toBe('INTERNAL_ERROR (HTTP 500)');
      expect(call.error.message).not.toContain('chi tiết thô');
    }
    expect(call.context).toEqual({
      tags: {
        api_error_code: 'INTERNAL_ERROR',
        api_status: '500',
        traceId: 'trace-abc',
      },
    });
  });

  it('omits traceId tag when reportable ApiError has no traceId', () => {
    const sdk = createFakeSdk();
    const obs = createObservability({
      dsn: 'https://key@o0.ingest.sentry.io/1',
      sdk,
    });

    obs.captureError(
      new ApiError({
        code: 'INTERNAL_ERROR',
        status: 500,
        message: 'server failed',
      }),
    );

    const call = sdk.exceptionCalls[0];
    expect(call).toBeDefined();
    if (!call) {
      return;
    }
    expect(call.context).toEqual({
      tags: {
        api_error_code: 'INTERNAL_ERROR',
        api_status: '500',
      },
    });
    expect('traceId' in call.context.tags).toBe(false);
  });

  it('ignores non-bug ApiErrors and reports RESPONSE_INVALID even on HTTP 200', () => {
    const sdk = createFakeSdk();
    const obs = createObservability({
      dsn: 'https://key@o0.ingest.sentry.io/1',
      sdk,
    });

    const ignoredErrors = [
      new ApiError({ code: 'VALIDATION_FAILED', status: 400, message: 'bad input' }),
      new ApiError({ code: 'UNAUTHENTICATED', status: 401, message: 'expired' }),
      new ApiError({ code: 'NETWORK_ERROR', status: 0, message: 'offline' }),
    ];

    for (const err of ignoredErrors) {
      expect(shouldReportApiError(err)).toBe(false);
      obs.captureError(err);
    }
    expect(sdk.exceptionCalls).toHaveLength(0);

    const schemaErr = new ApiError({
      code: 'RESPONSE_INVALID',
      status: 200,
      message: 'schema mismatch',
    });
    expect(shouldReportApiError(schemaErr)).toBe(true);
    obs.captureError(schemaErr);
    expect(sdk.exceptionCalls).toHaveLength(1);
  });

  it('forwards regular errors directly with empty tags', () => {
    const sdk = createFakeSdk();
    const obs = createObservability({
      dsn: 'https://key@o0.ingest.sentry.io/1',
      sdk,
    });

    const err = new Error('boom');
    obs.captureError(err);

    expect(sdk.exceptionCalls).toHaveLength(1);
    const call = sdk.exceptionCalls[0];
    expect(call?.error).toBe(err);
    expect(call?.context).toEqual({ tags: {} });
  });

  it('records anonymous breadcrumb and message for trackFunnelStep', () => {
    const sdk = createFakeSdk();
    const obs = createObservability({
      dsn: 'https://key@o0.ingest.sentry.io/1',
      sdk,
    });

    obs.trackFunnelStep('ekyc_submitted');

    expect(sdk.breadcrumbCalls).toEqual([
      {
        category: 'funnel',
        message: 'ekyc_submitted',
        level: 'info',
      },
    ]);
    expect(sdk.messageCalls).toEqual([
      {
        message: 'funnel:ekyc_submitted',
        context: {
          level: 'info',
          tags: { funnel_step: 'ekyc_submitted' },
        },
      },
    ]);
  });

  it('supports detached method invocation without binding', () => {
    const sdk = createFakeSdk();
    const obs = createObservability({
      dsn: 'https://key@o0.ingest.sentry.io/1',
      sdk,
    });

    const { captureError } = obs;
    const err = new Error('detached');
    captureError(err);

    expect(sdk.exceptionCalls).toHaveLength(1);
    expect(sdk.exceptionCalls[0]?.error).toBe(err);
  });
});
