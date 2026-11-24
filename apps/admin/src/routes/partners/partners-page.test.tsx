// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { messageFor } from '@tamgiao/api-client';
import { problem, TEST_API_URL } from '@tamgiao/api-client/mocks';
import type { AdminPartner, AdminPartnerStaff } from '@tamgiao/contracts/billing';
import { FORBIDDEN_COPY, NAV_COPY } from '../../layout/copy';
import { adminMe } from '../../test-utils/fixtures';
import { meHandler, server } from '../../test-utils/msw-server';
import { renderApp } from '../../test-utils/render-app';
import { PARTNERS_COPY } from '../../features/partners/copy';

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

beforeEach(() => {
  server.use(meHandler(adminMe('ADMIN')));
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});

const PARTNER_1_ID = '01890a5d-ac96-774b-bcce-b302099a8001';
const PARTNER_2_ID = '01890a5d-ac96-774b-bcce-b302099a8002';
const STAFF_1_ID = '01890a5d-ac96-774b-bcce-b302099a8010';

function makePartner(overrides?: Partial<AdminPartner>): AdminPartner {
  return {
    id: PARTNER_1_ID,
    name: 'The Coffee House',
    address: '86 Cao Thắng, Quận 3, TP.HCM',
    photoUrl: 'https://images.unsplash.com/photo-cafe.jpg',
    tags: ['cafe', 'lãng mạn'],
    active: true,
    createdAt: '2026-11-20T08:00:00.000Z',
    updatedAt: '2026-11-20T08:00:00.000Z',
    ...overrides,
  };
}

function makeStaff(overrides?: Partial<AdminPartnerStaff>): AdminPartnerStaff {
  return {
    id: STAFF_1_ID,
    partnerId: PARTNER_1_ID,
    name: 'Nguyễn Văn Pha Chế',
    deviceId: 'device-test-12345',
    active: true,
    lockedUntil: null,
    lastLoginAt: '2026-11-24T09:00:00.000Z',
    createdAt: '2026-11-20T08:00:00.000Z',
    updatedAt: '2026-11-20T08:00:00.000Z',
    ...overrides,
  };
}

describe('PartnersPage (FE-S5-06)', () => {
  it('1. ADMIN thấy menu, SUPERVISOR không thấy và vào /partners → FORBIDDEN_COPY.title', async () => {
    server.use(
      meHandler(adminMe('ADMIN')),
      http.get(`${TEST_API_URL}/admin/partners`, () => {
        return HttpResponse.json({ items: [makePartner()] });
      }),
    );

    const { unmount } = await renderApp('/partners', { token: 'valid-token' });

    expect(await screen.findByRole('link', { name: NAV_COPY.partners })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: PARTNERS_COPY.title })).toBeTruthy();

    unmount();

    server.use(meHandler(adminMe('SUPERVISOR')));
    await renderApp('/partners', { token: 'valid-token' });

    expect(await screen.findByRole('heading', { name: FORBIDDEN_COPY.title })).toBeTruthy();
    expect(screen.queryByRole('link', { name: NAV_COPY.partners })).toBeNull();
  });

  it('2. danh sách + lọc gửi active=true/false/không gửi', async () => {
    const requestedActives: (string | null)[] = [];

    server.use(
      http.get(`${TEST_API_URL}/admin/partners`, ({ request }) => {
        const url = new URL(request.url);
        requestedActives.push(url.searchParams.get('active'));

        const activeParam = url.searchParams.get('active');
        if (activeParam === 'true') {
          return HttpResponse.json({ items: [makePartner({ active: true })] });
        }
        if (activeParam === 'false') {
          return HttpResponse.json({
            items: [makePartner({ id: PARTNER_2_ID, name: 'Quán Đã Tắt', active: false })],
          });
        }
        return HttpResponse.json({
          items: [
            makePartner({ active: true }),
            makePartner({ id: PARTNER_2_ID, name: 'Quán Đã Tắt', active: false }),
          ],
        });
      }),
    );

    await renderApp('/partners', { token: 'valid-token' });

    expect(await screen.findByText('The Coffee House')).toBeTruthy();
    expect(requestedActives[0]).toBeNull();

    const select = screen.getByLabelText(PARTNERS_COPY.filters.filterLabel);

    // Lọc Đang hoạt động -> active=true
    fireEvent.change(select, { target: { value: 'active' } });
    await waitFor(() => {
      expect(requestedActives).toContain('true');
    });

    // Lọc Đã tắt -> active=false
    fireEvent.change(select, { target: { value: 'inactive' } });
    await waitFor(() => {
      expect(requestedActives).toContain('false');
    });

    // Lọc Tất cả -> không có active param
    fireEvent.change(select, { target: { value: 'all' } });
    await waitFor(() => {
      expect(requestedActives[requestedActives.length - 1]).toBeNull();
    });
  });

  it('3. tạo quán body đúng', async () => {
    let capturedBody: unknown = null;

    server.use(
      http.get(`${TEST_API_URL}/admin/partners`, () => {
        return HttpResponse.json({ items: [] });
      }),
      http.post(`${TEST_API_URL}/admin/partners`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json(
          makePartner({
            name: 'Highlands Coffee',
            address: '123 Lê Duẩn, Q.1',
            photoUrl: 'https://images.unsplash.com/photo-cafe.jpg',
            tags: ['cafe', 'lãng mạn'],
          }),
          { status: 201 },
        );
      }),
      http.get(`${TEST_API_URL}/admin/partners/${PARTNER_1_ID}`, () => {
        return HttpResponse.json(makePartner());
      }),
      http.get(`${TEST_API_URL}/admin/partners/${PARTNER_1_ID}/staff`, () => {
        return HttpResponse.json({ items: [] });
      }),
    );

    await renderApp('/partners', { token: 'valid-token' });

    const createBtn = await screen.findByRole('button', { name: PARTNERS_COPY.list.createButton });
    fireEvent.click(createBtn);

    const nameInput = screen.getByPlaceholderText(PARTNERS_COPY.partnerForm.namePlaceholder);
    const addressInput = screen.getByPlaceholderText(PARTNERS_COPY.partnerForm.addressPlaceholder);
    const photoInput = screen.getByPlaceholderText(PARTNERS_COPY.partnerForm.photoUrlPlaceholder);
    const tagsInput = screen.getByPlaceholderText(PARTNERS_COPY.partnerForm.tagsPlaceholder);

    fireEvent.change(nameInput, { target: { value: 'Highlands Coffee' } });
    fireEvent.change(addressInput, { target: { value: '123 Lê Duẩn, Q.1' } });
    fireEvent.change(photoInput, { target: { value: 'https://images.unsplash.com/photo-cafe.jpg' } });
    fireEvent.change(tagsInput, { target: { value: 'cafe, lãng mạn' } });

    const submitBtn = screen.getByRole('button', { name: PARTNERS_COPY.partnerForm.submitCreate });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(capturedBody).toEqual({
        name: 'Highlands Coffee',
        address: '123 Lê Duẩn, Q.1',
        photoUrl: 'https://images.unsplash.com/photo-cafe.jpg',
        tags: ['cafe', 'lãng mạn'],
      });
    });
  });

  it('4. sửa chỉ gửi trường đổi', async () => {
    let capturedPatchBody: unknown = null;

    server.use(
      http.get(`${TEST_API_URL}/admin/partners`, () => {
        return HttpResponse.json({ items: [makePartner()] });
      }),
      http.get(`${TEST_API_URL}/admin/partners/${PARTNER_1_ID}`, () => {
        return HttpResponse.json(makePartner());
      }),
      http.get(`${TEST_API_URL}/admin/partners/${PARTNER_1_ID}/staff`, () => {
        return HttpResponse.json({ items: [] });
      }),
      http.patch(`${TEST_API_URL}/admin/partners/${PARTNER_1_ID}`, async ({ request }) => {
        capturedPatchBody = await request.json();
        return HttpResponse.json(makePartner({ name: 'The Coffee House Mới' }));
      }),
    );

    await renderApp(`/partners/${PARTNER_1_ID}`, { token: 'valid-token' });

    const editBtn = await screen.findByRole('button', { name: PARTNERS_COPY.detail.editButton });
    fireEvent.click(editBtn);

    const nameInput = screen.getByPlaceholderText(PARTNERS_COPY.partnerForm.namePlaceholder);
    fireEvent.change(nameInput, { target: { value: 'The Coffee House Mới' } });

    const submitBtn = screen.getByRole('button', { name: PARTNERS_COPY.partnerForm.submitEdit });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(capturedPatchBody).toEqual({
        name: 'The Coffee House Mới',
      });
    });
  });

  it('5. không đổi gì → không gọi', async () => {
    let patchCalled = false;

    server.use(
      http.get(`${TEST_API_URL}/admin/partners`, () => {
        return HttpResponse.json({ items: [makePartner()] });
      }),
      http.get(`${TEST_API_URL}/admin/partners/${PARTNER_1_ID}`, () => {
        return HttpResponse.json(makePartner());
      }),
      http.get(`${TEST_API_URL}/admin/partners/${PARTNER_1_ID}/staff`, () => {
        return HttpResponse.json({ items: [] });
      }),
      http.patch(`${TEST_API_URL}/admin/partners/${PARTNER_1_ID}`, () => {
        patchCalled = true;
        return HttpResponse.json(makePartner());
      }),
    );

    await renderApp(`/partners/${PARTNER_1_ID}`, { token: 'valid-token' });

    const editBtn = await screen.findByRole('button', { name: PARTNERS_COPY.detail.editButton });
    fireEvent.click(editBtn);

    const submitBtn = screen.getByRole('button', { name: PARTNERS_COPY.partnerForm.submitEdit });
    fireEvent.click(submitBtn);

    expect(patchCalled).toBe(false);
    expect(screen.queryByRole('heading', { name: PARTNERS_COPY.partnerForm.titleEdit })).toBeNull();
  });

  it('6. gỡ ảnh gửi photoUrl: null', async () => {
    let capturedPatchBody: unknown = null;

    server.use(
      http.get(`${TEST_API_URL}/admin/partners`, () => {
        return HttpResponse.json({ items: [makePartner()] });
      }),
      http.get(`${TEST_API_URL}/admin/partners/${PARTNER_1_ID}`, () => {
        return HttpResponse.json(makePartner({ photoUrl: 'https://images.unsplash.com/photo-cafe.jpg' }));
      }),
      http.get(`${TEST_API_URL}/admin/partners/${PARTNER_1_ID}/staff`, () => {
        return HttpResponse.json({ items: [] });
      }),
      http.patch(`${TEST_API_URL}/admin/partners/${PARTNER_1_ID}`, async ({ request }) => {
        capturedPatchBody = await request.json();
        return HttpResponse.json(makePartner({ photoUrl: null }));
      }),
    );

    await renderApp(`/partners/${PARTNER_1_ID}`, { token: 'valid-token' });

    const editBtn = await screen.findByRole('button', { name: PARTNERS_COPY.detail.editButton });
    fireEvent.click(editBtn);

    const photoInput = screen.getByPlaceholderText(PARTNERS_COPY.partnerForm.photoUrlPlaceholder);
    fireEvent.change(photoInput, { target: { value: '' } });

    const submitBtn = screen.getByRole('button', { name: PARTNERS_COPY.partnerForm.submitEdit });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(capturedPatchBody).toEqual({
        photoUrl: null,
      });
    });
  });

  it('7. tắt quán body {active:false} sau xác nhận', async () => {
    let capturedPatchBody: unknown = null;

    server.use(
      http.get(`${TEST_API_URL}/admin/partners`, () => {
        return HttpResponse.json({ items: [makePartner({ active: true })] });
      }),
      http.get(`${TEST_API_URL}/admin/partners/${PARTNER_1_ID}`, () => {
        return HttpResponse.json(makePartner({ active: true }));
      }),
      http.get(`${TEST_API_URL}/admin/partners/${PARTNER_1_ID}/staff`, () => {
        return HttpResponse.json({ items: [] });
      }),
      http.patch(`${TEST_API_URL}/admin/partners/${PARTNER_1_ID}`, async ({ request }) => {
        capturedPatchBody = await request.json();
        return HttpResponse.json(makePartner({ active: false }));
      }),
    );

    await renderApp(`/partners/${PARTNER_1_ID}`, { token: 'valid-token' });

    const deactivateBtn = await screen.findByRole('button', {
      name: PARTNERS_COPY.detail.toggleActive.deactivateButton,
    });
    fireEvent.click(deactivateBtn);

    expect(await screen.findByText(PARTNERS_COPY.detail.toggleActive.confirmDeactivateBody)).toBeTruthy();

    const confirmSubmitBtn = within(screen.getByRole('dialog')).getByRole('button', {
      name: PARTNERS_COPY.detail.toggleActive.confirmDeactivateSubmit,
    });
    fireEvent.click(confirmSubmitBtn);

    await waitFor(() => {
      expect(capturedPatchBody).toEqual({
        active: false,
      });
    });
  });

  it('7b. tắt quán lỗi → báo lỗi trong hộp thoại, không đóng', async () => {
    server.use(
      http.get(`${TEST_API_URL}/admin/partners`, () => HttpResponse.json({ items: [makePartner()] })),
      http.get(`${TEST_API_URL}/admin/partners/${PARTNER_1_ID}`, () => HttpResponse.json(makePartner())),
      http.get(`${TEST_API_URL}/admin/partners/${PARTNER_1_ID}/staff`, () =>
        HttpResponse.json({ items: [] }),
      ),
      http.patch(`${TEST_API_URL}/admin/partners/${PARTNER_1_ID}`, () => problem(404, 'PARTNER_NOT_FOUND')),
    );
    await renderApp(`/partners/${PARTNER_1_ID}`, { token: 'valid-token' });
    fireEvent.click(
      await screen.findByRole('button', { name: PARTNERS_COPY.detail.toggleActive.deactivateButton }),
    );
    const dialog = screen.getByRole('dialog');
    fireEvent.click(
      within(dialog).getByRole('button', {
        name: PARTNERS_COPY.detail.toggleActive.confirmDeactivateSubmit,
      }),
    );
    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      messageFor({ code: 'PARTNER_NOT_FOUND' }).title,
    );
  });

  it('8. tạo nhân viên (PIN không khớp → lỗi, không gửi; đúng → body)', async () => {
    let capturedStaffBody: unknown = null;

    server.use(
      http.get(`${TEST_API_URL}/admin/partners`, () => {
        return HttpResponse.json({ items: [makePartner()] });
      }),
      http.get(`${TEST_API_URL}/admin/partners/${PARTNER_1_ID}`, () => {
        return HttpResponse.json(makePartner());
      }),
      http.get(`${TEST_API_URL}/admin/partners/${PARTNER_1_ID}/staff`, () => {
        return HttpResponse.json({ items: [] });
      }),
      http.post(`${TEST_API_URL}/admin/partners/${PARTNER_1_ID}/staff`, async ({ request }) => {
        capturedStaffBody = await request.json();
        return HttpResponse.json(makeStaff(), { status: 201 });
      }),
    );

    await renderApp(`/partners/${PARTNER_1_ID}`, { token: 'valid-token' });

    const createStaffBtn = await screen.findByRole('button', {
      name: PARTNERS_COPY.staff.createButton,
    });
    fireEvent.click(createStaffBtn);

    const nameInput = screen.getByPlaceholderText(PARTNERS_COPY.staffForm.namePlaceholder);
    const pinInput = screen.getByPlaceholderText(PARTNERS_COPY.staffForm.pinPlaceholder);
    const pinConfirmInput = screen.getByPlaceholderText(PARTNERS_COPY.staffForm.pinConfirmPlaceholder);

    fireEvent.change(nameInput, { target: { value: 'Trần Văn Nhân Viên' } });
    fireEvent.change(pinInput, { target: { value: '123456' } });
    fireEvent.change(pinConfirmInput, { target: { value: '654321' } });

    const submitBtn = screen.getByRole('button', { name: PARTNERS_COPY.staffForm.submitCreate });
    fireEvent.click(submitBtn);

    expect(await screen.findByText(PARTNERS_COPY.staffForm.errors.pinMismatch)).toBeTruthy();
    expect(capturedStaffBody).toBeNull();

    fireEvent.change(pinConfirmInput, { target: { value: '123456' } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(capturedStaffBody).toEqual({
        name: 'Trần Văn Nhân Viên',
        pin: '123456',
      });
    });
  });

  it('9. đặt lại PIN {pin}', async () => {
    let capturedStaffPatch: unknown = null;

    server.use(
      http.get(`${TEST_API_URL}/admin/partners`, () => {
        return HttpResponse.json({ items: [makePartner()] });
      }),
      http.get(`${TEST_API_URL}/admin/partners/${PARTNER_1_ID}`, () => {
        return HttpResponse.json(makePartner());
      }),
      http.get(`${TEST_API_URL}/admin/partners/${PARTNER_1_ID}/staff`, () => {
        return HttpResponse.json({ items: [makeStaff()] });
      }),
      http.patch(
        `${TEST_API_URL}/admin/partners/${PARTNER_1_ID}/staff/${STAFF_1_ID}`,
        async ({ request }) => {
          capturedStaffPatch = await request.json();
          return HttpResponse.json(makeStaff());
        },
      ),
    );

    await renderApp(`/partners/${PARTNER_1_ID}`, { token: 'valid-token' });

    const resetPinBtn = await screen.findByRole('button', {
      name: PARTNERS_COPY.staff.resetPinAction,
    });
    fireEvent.click(resetPinBtn);

    expect(await screen.findByText(PARTNERS_COPY.staffForm.resetPinNote)).toBeTruthy();

    const pinInput = screen.getByPlaceholderText(PARTNERS_COPY.staffForm.pinPlaceholder);
    const pinConfirmInput = screen.getByPlaceholderText(PARTNERS_COPY.staffForm.pinConfirmPlaceholder);

    fireEvent.change(pinInput, { target: { value: '888999' } });
    fireEvent.change(pinConfirmInput, { target: { value: '888999' } });

    const submitBtn = screen.getByRole('button', { name: PARTNERS_COPY.staffForm.submitResetPin });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(capturedStaffPatch).toEqual({
        pin: '888999',
      });
    });
  });

  it('10. gỡ thiết bị {deviceId:null}', async () => {
    let capturedStaffPatch: unknown = null;

    server.use(
      http.get(`${TEST_API_URL}/admin/partners`, () => {
        return HttpResponse.json({ items: [makePartner()] });
      }),
      http.get(`${TEST_API_URL}/admin/partners/${PARTNER_1_ID}`, () => {
        return HttpResponse.json(makePartner());
      }),
      http.get(`${TEST_API_URL}/admin/partners/${PARTNER_1_ID}/staff`, () => {
        return HttpResponse.json({ items: [makeStaff({ deviceId: 'device-xyz' })] });
      }),
      http.patch(
        `${TEST_API_URL}/admin/partners/${PARTNER_1_ID}/staff/${STAFF_1_ID}`,
        async ({ request }) => {
          capturedStaffPatch = await request.json();
          return HttpResponse.json(makeStaff({ deviceId: null }));
        },
      ),
    );

    await renderApp(`/partners/${PARTNER_1_ID}`, { token: 'valid-token' });

    const removeDeviceBtn = await screen.findByRole('button', {
      name: PARTNERS_COPY.staff.removeDeviceAction,
    });
    fireEvent.click(removeDeviceBtn);

    expect(await screen.findByText(PARTNERS_COPY.staff.confirmRemoveDeviceBody)).toBeTruthy();

    const confirmBtn = within(screen.getByRole('dialog')).getByRole('button', {
      name: PARTNERS_COPY.staff.confirmRemoveDeviceSubmit,
    });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(capturedStaffPatch).toEqual({
        deviceId: null,
      });
    });
  });

  it('11. vô hiệu hoá {active:false}', async () => {
    let capturedStaffPatch: unknown = null;

    server.use(
      http.get(`${TEST_API_URL}/admin/partners`, () => {
        return HttpResponse.json({ items: [makePartner()] });
      }),
      http.get(`${TEST_API_URL}/admin/partners/${PARTNER_1_ID}`, () => {
        return HttpResponse.json(makePartner());
      }),
      http.get(`${TEST_API_URL}/admin/partners/${PARTNER_1_ID}/staff`, () => {
        return HttpResponse.json({ items: [makeStaff({ active: true })] });
      }),
      http.patch(
        `${TEST_API_URL}/admin/partners/${PARTNER_1_ID}/staff/${STAFF_1_ID}`,
        async ({ request }) => {
          capturedStaffPatch = await request.json();
          return HttpResponse.json(makeStaff({ active: false }));
        },
      ),
    );

    await renderApp(`/partners/${PARTNER_1_ID}`, { token: 'valid-token' });

    const deactivateBtn = await screen.findByRole('button', {
      name: PARTNERS_COPY.staff.deactivateAction,
    });
    fireEvent.click(deactivateBtn);

    expect(await screen.findByText(PARTNERS_COPY.staff.confirmDeactivateBody)).toBeTruthy();

    const confirmBtn = within(screen.getByRole('dialog')).getByRole('button', {
      name: PARTNERS_COPY.staff.confirmDeactivateSubmit,
    });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(capturedStaffPatch).toEqual({
        active: false,
      });
    });
  });

  it('12. PARTNER_INVALID field → lỗi đúng ô', async () => {
    server.use(
      http.get(`${TEST_API_URL}/admin/partners`, () => {
        return HttpResponse.json({ items: [] });
      }),
      http.post(`${TEST_API_URL}/admin/partners`, () => {
        return problem(422, 'PARTNER_INVALID', { meta: { field: 'name' } });
      }),
    );

    await renderApp('/partners', { token: 'valid-token' });

    const createBtn = await screen.findByRole('button', { name: PARTNERS_COPY.list.createButton });
    fireEvent.click(createBtn);

    const nameInput = screen.getByPlaceholderText(PARTNERS_COPY.partnerForm.namePlaceholder);
    const addressInput = screen.getByPlaceholderText(PARTNERS_COPY.partnerForm.addressPlaceholder);

    fireEvent.change(nameInput, { target: { value: 'Tên Không Hợp Lệ' } });
    fireEvent.change(addressInput, { target: { value: '123 Đường Số 1' } });

    const submitBtn = screen.getByRole('button', { name: PARTNERS_COPY.partnerForm.submitCreate });
    fireEvent.click(submitBtn);

    expect(await screen.findByText(PARTNERS_COPY.fieldErrors.name)).toBeTruthy();
    // Giữ dialog và giữ dữ liệu
    expect(screen.getByDisplayValue('Tên Không Hợp Lệ')).toBeTruthy();
    expect(screen.getByDisplayValue('123 Đường Số 1')).toBeTruthy();
  });

  it('13. PARTNER_NOT_FOUND ở chi tiết', async () => {
    server.use(
      http.get(`${TEST_API_URL}/admin/partners`, () => {
        return HttpResponse.json({ items: [] });
      }),
      http.get(`${TEST_API_URL}/admin/partners/${PARTNER_2_ID}`, () => {
        return problem(404, 'PARTNER_NOT_FOUND');
      }),
    );

    await renderApp(`/partners/${PARTNER_2_ID}`, { token: 'valid-token' });

    expect(await screen.findByText(messageFor({ code: 'PARTNER_NOT_FOUND' }).title)).toBeTruthy();
  });
});
