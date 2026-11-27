import { describe, expect, it } from 'vitest';
import {
  buildContentSecurityPolicy,
  buildSecurityHeaders,
  injectCspMeta,
  originOf,
  renderStaticHeadersFile,
} from './web-security-headers.js';

describe('originOf', () => {
  it('trích đúng origin từ URL http/https/ws/wss hợp lệ', () => {
    expect(originOf('https://api.tamgiao.example/v1/auth')).toBe('https://api.tamgiao.example');
    expect(originOf('http://localhost:3000/api')).toBe('http://localhost:3000');
    expect(originOf('wss://ws.tamgiao.example/chat')).toBe('wss://ws.tamgiao.example');
  });

  it('throw khi URL tương đối hoặc scheme không được hỗ trợ', () => {
    expect(() => originOf('/relative')).toThrow();
    expect(() => originOf('ftp://x')).toThrow();
  });
});

describe('buildContentSecurityPolicy', () => {
  it('sinh CSP cho admin (meta và header) không có unsafe-eval/unsafe-inline/localhost', () => {
    const metaCsp = buildContentSecurityPolicy(
      { apiUrl: 'https://api.tamgiao.example/', allowCamera: false },
      'meta',
    );
    expect(metaCsp).toContain("connect-src 'self' https://api.tamgiao.example");
    expect(metaCsp).not.toContain('unsafe-eval');
    expect(metaCsp).not.toContain('unsafe-inline');
    expect(metaCsp).not.toContain('frame-ancestors');
    expect(metaCsp).not.toContain('localhost');
    expect(metaCsp).not.toContain('http:');

    const headerCsp = buildContentSecurityPolicy(
      { apiUrl: 'https://api.tamgiao.example/', allowCamera: false },
      'header',
    );
    expect(headerCsp).toContain("frame-ancestors 'none'");
  });

  it('gộp extraConnectUrls theo origin unique, không lặp origin của API', () => {
    const csp = buildContentSecurityPolicy(
      {
        apiUrl: 'https://api.tamgiao.example/',
        extraConnectUrls: ['https://o1.ingest.sentry.example/123', 'https://api.tamgiao.example/x'],
        allowCamera: false,
      },
      'header',
    );

    expect(csp).toContain("connect-src 'self' https://api.tamgiao.example https://o1.ingest.sentry.example");
  });

  it('cho phép http://<host>:* trong img-src khi API chạy http local', () => {
    const localCsp = buildContentSecurityPolicy(
      { apiUrl: 'http://localhost:3000', allowCamera: false },
      'header',
    );
    expect(localCsp).toContain("img-src 'self' data: blob: https: http://localhost:*");
  });
});

describe('buildSecurityHeaders', () => {
  it('partner bật camera=(self), admin tắt camera=()', () => {
    const partnerHeaders = buildSecurityHeaders(
      { apiUrl: 'https://api.tamgiao.example', allowCamera: true },
      { hsts: false },
    );
    expect(partnerHeaders['Permissions-Policy']).toContain('camera=(self)');
    expect(partnerHeaders['Content-Security-Policy']).toBeDefined();
    expect(partnerHeaders['Strict-Transport-Security']).toBeUndefined();

    const adminHeaders = buildSecurityHeaders(
      { apiUrl: 'https://api.tamgiao.example', allowCamera: false },
      { hsts: true },
    );
    expect(adminHeaders['Permissions-Policy']).toContain('camera=()');
    expect(adminHeaders['Strict-Transport-Security']).toBe('max-age=31536000; includeSubDomains');
  });

  it('options = null không sinh CSP nhưng vẫn giữ đủ các header an toàn khác', () => {
    const headers = buildSecurityHeaders(null, { hsts: false });
    expect(headers['Content-Security-Policy']).toBeUndefined();
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['Referrer-Policy']).toBe('no-referrer');
    expect(headers['X-Frame-Options']).toBe('DENY');
    expect(headers['Cross-Origin-Opener-Policy']).toBe('same-origin');
    expect(headers['Permissions-Policy']).toContain('camera=()');
  });
});

describe('renderStaticHeadersFile', () => {
  it('xuất đúng định dạng _headers với header thụt 2 space và rule Cache-Control', () => {
    const headers = buildSecurityHeaders(
      { apiUrl: 'https://api.tamgiao.example', allowCamera: false },
      { hsts: true },
    );
    const rendered = renderStaticHeadersFile(headers);

    expect(rendered).toContain('\n/*\n');
    expect(rendered).toContain('\n  X-Content-Type-Options: nosniff\n');
    expect(rendered).toContain('/index.html\n  Cache-Control: no-cache\n');
    expect(rendered).toContain('/sw.js\n  Cache-Control: no-cache\n');
    expect(rendered).toContain('/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n');
  });
});

describe('injectCspMeta', () => {
  it('chèn ngay sau <meta charset="UTF-8" /> và escape ký tự đặc biệt', () => {
    const html = [
      '<!doctype html>',
      '<html>',
      '  <head>',
      '    <meta charset="UTF-8" />',
      '    <title>App</title>',
      '  </head>',
      '</html>',
    ].join('\n');
    const result = injectCspMeta(html, 'default-src "self" & https:');

    expect(result).toContain(
      '<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="default-src &quot;self&quot; &amp; https:" />',
    );
  });

  it('throw nếu HTML đã có CSP hoặc không có thẻ <head>', () => {
    const withCsp =
      '<html><head><meta http-equiv="Content-Security-Policy" content="default-src \'self\'" /></head></html>';
    expect(() => injectCspMeta(withCsp, "default-src 'self'")).toThrow();

    const noHead = '<html><body></body></html>';
    expect(() => injectCspMeta(noHead, "default-src 'self'")).toThrow();
  });
});
