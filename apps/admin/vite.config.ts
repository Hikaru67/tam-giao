import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig, loadEnv } from 'vite';
import type { WebSecurityOptions } from '../../tools/security/web-security-headers';
import {
  buildContentSecurityPolicy,
  buildSecurityHeaders,
  injectCspMeta,
  renderStaticHeadersFile,
} from '../../tools/security/web-security-headers';

/** Chèn meta CSP vào index.html và phát `_headers` cho hosting tĩnh — chỉ khi build (FE-S6-03). */
function securityHeaders(options: WebSecurityOptions): Plugin {
  return {
    name: 'tamgiao-security-headers',
    apply: 'build',
    transformIndexHtml: (html) => injectCspMeta(html, buildContentSecurityPolicy(options, 'meta')),
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: '_headers',
        source: renderStaticHeadersFile(buildSecurityHeaders(options, { hsts: true })),
      });
    },
  };
}

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const apiUrl = env['VITE_API_URL'];
  if (command === 'build' && !apiUrl) {
    throw new Error('VITE_API_URL bắt buộc khi build (FE-S6-03): bản build không được trỏ về API máy dev.');
  }

  const sentryDsn = env['VITE_SENTRY_DSN'];
  const security: WebSecurityOptions | null = apiUrl
    ? { apiUrl, extraConnectUrls: sentryDsn ? [sentryDsn] : [], allowCamera: false }
    : null;

  return {
    plugins: [react(), ...(security ? [securityHeaders(security)] : [])],
    server: {
      port: 5173,
    },
    preview: {
      headers: buildSecurityHeaders(security, { hsts: false }),
    },
  };
});
