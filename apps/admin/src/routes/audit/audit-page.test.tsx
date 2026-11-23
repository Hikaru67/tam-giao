// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach, afterAll, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { TEST_API_URL, problem } from '@tamgiao/api-client/mocks';
import type { AuditLogEntry } from '@tamgiao/contracts/identity';
import { server, meHandler } from '../../test-utils/msw-server';
import { adminMe } from '../../test-utils/fixtures';
import { renderApp } from '../../test-utils/render-app';
import { FORBIDDEN_COPY, NAV_COPY } from '../../layout/copy';
import { AUDIT_PAGE_LIMIT } from './audit-api';
import { AUDIT_COPY } from './copy';

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

beforeEach(() => {
  server.use(meHandler(adminMe('SUPERVISOR')));
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});

function makeEntry(overrides?: Partial<AuditLogEntry>): AuditLogEntry {
  return {
    id: '0193a4f2-7c3e-7b1a-9f2d-3c4b5a6d7e01',
    occurredAt: '2026-11-20T08:00:00.000Z',
    actor: {
      type: 'admin',
      id: '0193a4f2-7c3e-7b1a-9f2d-3c4b5a6d7e8f',
    },
    action: 'kyc.view_detail',
    targetType: 'kyc_submission',
    targetId: '0193a4f2-7c3e-7b1a-9f2d-3c4b5a6d7e99',
    ip: '127.0.0.1',
    meta: {},
    ...overrides,
  };
}

describe('AuditPage', () => {
  it('a. render danh sách: gọi API không có filter, gửi limit=20, hiện hàng có action kyc.view_detail', async () => {
    let capturedUrl: URL | null = null;
    server.use(
      http.get(`${TEST_API_URL}/admin/audit-logs`, ({ request }) => {
        capturedUrl = new URL(request.url);
        return HttpResponse.json({
          items: [makeEntry({ action: 'kyc.view_detail' })],
          nextCursor: null,
        });
      }),
    );

    await renderApp('/audit', { token: 'valid-token' });

    expect(await screen.findByText('kyc.view_detail')).toBeTruthy();
    expect(capturedUrl).not.toBeNull();
    expect(capturedUrl!.searchParams.get('limit')).toBe(String(AUDIT_PAGE_LIMIT));
    expect(capturedUrl!.searchParams.get('actorId')).toBeNull();
    expect(capturedUrl!.searchParams.get('actorType')).toBeNull();
    expect(capturedUrl!.searchParams.get('cursor')).toBeNull();
  });

  it('b. lọc: điền actorId + targetType, chọn actorType admin, bấm Lọc → request mới có query param, URL cập nhật, bảng hiện kết quả; mở thẳng URL có sẵn query param', async () => {
    const requests: URL[] = [];
    server.use(
      http.get(`${TEST_API_URL}/admin/audit-logs`, ({ request }) => {
        const url = new URL(request.url);
        requests.push(url);
        const actorType = url.searchParams.get('actorType');
        if (actorType === 'admin') {
          return HttpResponse.json({
            items: [
              makeEntry({
                id: '0193a4f2-7c3e-7b1a-9f2d-3c4b5a6d7e02',
                action: 'admin.filtered_action',
              }),
            ],
            nextCursor: null,
          });
        }
        return HttpResponse.json({
          items: [makeEntry({ action: 'initial.action' })],
          nextCursor: null,
        });
      }),
    );

    const { history } = await renderApp('/audit', { token: 'valid-token' });
    expect(await screen.findByText('initial.action')).toBeTruthy();

    const actorIdInput = screen.getByLabelText(AUDIT_COPY.actorId.label);
    const targetTypeInput = screen.getByLabelText(AUDIT_COPY.targetType.label);
    const actorTypeSelect = screen.getByLabelText(AUDIT_COPY.actorType.label);

    fireEvent.change(actorIdInput, {
      target: { value: '0193a4f2-7c3e-7b1a-9f2d-3c4b5a6d7e8f' },
    });
    fireEvent.change(targetTypeInput, { target: { value: 'kyc_submission' } });
    fireEvent.change(actorTypeSelect, { target: { value: 'admin' } });

    const applyBtn = screen.getByRole('button', { name: AUDIT_COPY.apply });
    fireEvent.click(applyBtn);

    expect(await screen.findByText('admin.filtered_action')).toBeTruthy();

    await waitFor(() => {
      const searchParams = new URLSearchParams(history.location.search);
      expect(searchParams.get('actorId')).toBe('0193a4f2-7c3e-7b1a-9f2d-3c4b5a6d7e8f');
      expect(searchParams.get('targetType')).toBe('kyc_submission');
      expect(searchParams.get('actorType')).toBe('admin');
    });

    const lastReq = requests[requests.length - 1]!;
    expect(lastReq.searchParams.get('actorId')).toBe('0193a4f2-7c3e-7b1a-9f2d-3c4b5a6d7e8f');
    expect(lastReq.searchParams.get('targetType')).toBe('kyc_submission');
    expect(lastReq.searchParams.get('actorType')).toBe('admin');
  });

  it('b2. mở thẳng URL có sẵn bộ lọc → request đầu mang đúng query param, ô lọc hiển thị sẵn giá trị', async () => {
    let directReqUrl: URL | undefined;
    server.use(
      http.get(`${TEST_API_URL}/admin/audit-logs`, ({ request }) => {
        directReqUrl = new URL(request.url);
        return HttpResponse.json({
          items: [makeEntry({ targetId: 'sub-1', actor: { type: 'user', id: null } })],
          nextCursor: null,
        });
      }),
    );

    await renderApp('/audit?targetId=sub-1&actorType=user', { token: 'valid-token' });

    expect(await screen.findByText('sub-1')).toBeTruthy();
    expect(directReqUrl?.searchParams.get('targetId')).toBe('sub-1');
    expect(directReqUrl?.searchParams.get('actorType')).toBe('user');

    const prefilledTargetId = screen.getByLabelText<HTMLInputElement>(AUDIT_COPY.targetId.label);
    const prefilledActorType = screen.getByLabelText<HTMLSelectElement>(AUDIT_COPY.actorType.label);
    expect(prefilledTargetId.value).toBe('sub-1');
    expect(prefilledActorType.value).toBe('user');
  });

  it('c. lọc thời gian: nhập from/to → request from bằng new Date(val).toISOString()', async () => {
    let capturedFrom: string | null = null;
    let capturedTo: string | null = null;

    server.use(
      http.get(`${TEST_API_URL}/admin/audit-logs`, ({ request }) => {
        const url = new URL(request.url);
        capturedFrom = url.searchParams.get('from');
        capturedTo = url.searchParams.get('to');
        return HttpResponse.json({
          items: [makeEntry({ action: 'time.filtered_action' })],
          nextCursor: null,
        });
      }),
    );

    await renderApp('/audit', { token: 'valid-token' });
    await screen.findByRole('heading', { name: NAV_COPY.audit, level: 1 });

    const fromInput = screen.getByLabelText(AUDIT_COPY.from.label);
    const toInput = screen.getByLabelText(AUDIT_COPY.to.label);

    fireEvent.change(fromInput, { target: { value: '2026-11-01T08:00' } });
    fireEvent.change(toInput, { target: { value: '2026-11-02T18:00' } });

    const applyBtn = screen.getByRole('button', { name: AUDIT_COPY.apply });
    fireEvent.click(applyBtn);

    expect(await screen.findByText('time.filtered_action')).toBeTruthy();

    const expectedFromIso = new Date('2026-11-01T08:00').toISOString();
    const expectedToIso = new Date('2026-11-02T18:00').toISOString();

    await waitFor(() => {
      expect(capturedFrom).toBe(expectedFromIso);
      expect(capturedTo).toBe(expectedToIso);
    });
  });

  it('d. phân trang: trang 1 trả nextCursor, trang 2 trả null → bấm Tải thêm hiện cả 2 trang, nút ẩn và hiện endOfList', async () => {
    const requests: URL[] = [];
    server.use(
      http.get(`${TEST_API_URL}/admin/audit-logs`, ({ request }) => {
        const url = new URL(request.url);
        requests.push(url);
        const cursor = url.searchParams.get('cursor');
        if (cursor === 'cursor-2') {
          return HttpResponse.json({
            items: [
              makeEntry({
                id: '0193a4f2-7c3e-7b1a-9f2d-3c4b5a6d7e02',
                action: 'page.two_action',
              }),
            ],
            nextCursor: null,
          });
        }
        return HttpResponse.json({
          items: [
            makeEntry({
              id: '0193a4f2-7c3e-7b1a-9f2d-3c4b5a6d7e01',
              action: 'page.one_action',
            }),
          ],
          nextCursor: 'cursor-2',
        });
      }),
    );

    await renderApp('/audit?targetType=kyc_submission', { token: 'valid-token' });

    expect(await screen.findByText('page.one_action')).toBeTruthy();
    const loadMoreBtn = await screen.findByRole('button', { name: AUDIT_COPY.loadMore });
    expect(screen.queryByText(AUDIT_COPY.endOfList)).toBeNull();

    fireEvent.click(loadMoreBtn);

    expect(await screen.findByText('page.two_action')).toBeTruthy();
    expect(screen.getByText('page.one_action')).toBeTruthy();

    expect(screen.queryByRole('button', { name: AUDIT_COPY.loadMore })).toBeNull();
    expect(screen.getByText(AUDIT_COPY.endOfList)).toBeTruthy();

    const secondReq = requests.find((u) => u.searchParams.get('cursor') === 'cursor-2');
    expect(secondReq).toBeDefined();
    expect(secondReq!.searchParams.get('targetType')).toBe('kyc_submission');
  });

  it('e. AC1: mở URL có lỗi validation → hiện câu tiếng Việt gắn với ô lỗi, không hiện text thô', async () => {
    server.use(
      http.get(`${TEST_API_URL}/admin/audit-logs`, () => {
        return problem(422, 'VALIDATION_FAILED', {
          errors: [
            { path: 'actorId', message: 'Invalid UUID' },
            { path: 'to', message: '`from` phải trước `to`' },
          ],
        });
      }),
    );

    await renderApp('/audit?actorId=abc&to=2026-01-01T00:00:00.000Z&from=2026-02-01T00:00:00.000Z', {
      token: 'valid-token',
    });

    const actorIdInput = await screen.findByLabelText(AUDIT_COPY.actorId.label);
    await waitFor(() => {
      expect(actorIdInput.getAttribute('aria-invalid')).toBe('true');
    });

    const actorIdErrorId = actorIdInput.getAttribute('aria-describedby');
    expect(actorIdErrorId).toBeTruthy();
    const actorIdErrorEl = document.getElementById(actorIdErrorId!);
    expect(actorIdErrorEl?.textContent).toBe(AUDIT_COPY.fieldErrors.actorId);

    const toInput = screen.getByLabelText(AUDIT_COPY.to.label);
    expect(toInput.getAttribute('aria-invalid')).toBe('true');
    const toErrorId = toInput.getAttribute('aria-describedby');
    expect(toErrorId).toBeTruthy();
    const toErrorEl = document.getElementById(toErrorId!);
    expect(toErrorEl?.textContent).toBe(AUDIT_COPY.fieldErrors.to);

    const targetIdInput = screen.getByLabelText(AUDIT_COPY.targetId.label);
    expect(targetIdInput.getAttribute('aria-invalid')).toBe('false');

    expect(screen.queryByText('Invalid UUID')).toBeNull();
    expect(screen.queryByText('`from` phải trước `to`')).toBeNull();
  });

  it('f. empty: items rỗng → hiện emptyTitle', async () => {
    server.use(
      http.get(`${TEST_API_URL}/admin/audit-logs`, () => {
        return HttpResponse.json({
          items: [],
          nextCursor: null,
        });
      }),
    );

    await renderApp('/audit', { token: 'valid-token' });

    expect(await screen.findByText(AUDIT_COPY.emptyTitle)).toBeTruthy();
  });

  it('g. 403 từ API → màn FORBIDDEN_COPY.title', async () => {
    server.use(
      http.get(`${TEST_API_URL}/admin/audit-logs`, () => {
        return problem(403, 'FORBIDDEN');
      }),
    );

    await renderApp('/audit', { token: 'valid-token' });

    expect(await screen.findByRole('heading', { name: FORBIDDEN_COPY.title })).toBeTruthy();
  });
});
