import * as Sentry from '@sentry/react-native';
import { createObservability, type Observability, type ObservabilitySdk } from '@tamgiao/observability-fe';
import { MOBILE_ENV } from '../env.js';

const sentrySdk: ObservabilitySdk = {
  init: (options) => {
    Sentry.init(options);
  },
  captureException: (error, context) => {
    Sentry.captureException(error, context);
  },
  captureMessage: (message, context) => {
    Sentry.captureMessage(message, context);
  },
  addBreadcrumb: (breadcrumb) => {
    Sentry.addBreadcrumb(breadcrumb);
  },
};

export const observability: Observability = createObservability({
  dsn: MOBILE_ENV.sentryDsn,
  sdk: sentrySdk,
  environment: __DEV__ ? 'development' : 'production',
});

/** Handler lỗi cho QueryCache/MutationCache: chỉ báo lỗi thật (5xx, lệch schema, lỗi JS), không gửi `detail`. */
export function reportError(error: unknown): void {
  observability.captureError(error);
}
