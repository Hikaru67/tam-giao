// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { TEST_API_URL, problem } from '@tamgiao/api-client/mocks';
import { messageFor } from '@tamgiao/api-client';
import { INTERVIEW_DURATION_MINUTES } from '@tamgiao/contracts/constants';
import { PAGE_LIMIT_MAX } from '@tamgiao/contracts/http';
import type { AdminInterviewSlot } from '@tamgiao/contracts/verification';
import { server, meHandler } from '../../test-utils/msw-server';
import { ADMIN_ID, adminMe } from '../../test-utils/fixtures';
import { renderApp } from '../../test-utils/render-app';
import { INTERVIEWS_COPY } from './copy';
import { addDays, startOfWeek, toLocalInputValue } from './week';

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});

function makeSlot(overrides: Partial<AdminInterviewSlot>): AdminInterviewSlot {
  const startsAt = overrides.startsAt ?? new Date().toISOString();
  const endsAt =
    overrides.endsAt ??
    new Date(new Date(startsAt).getTime() + INTERVIEW_DURATION_MINUTES * 60_000).toISOString();

  return {
    id: '0193a4f2-7c3e-7b1a-9f2d-000000000001',
    interviewerId: ADMIN_ID,
    startsAt,
    endsAt,
    meetingUrl: null,
    status: 'OPEN',
    bookedBy: null,
    bookedAt: null,
    outcome: null,
    notes: null,
    recordedBy: null,
    recordedAt: null,
    createdAt: '2026-11-20T10:00:00.000Z',
    ...overrides,
  };
}

describe('InterviewsPage', () => {
  it('AC1: slot đã có người đặt hiển thị khác slot trống', async () => {
    const currentWeekStart = startOfWeek(new Date());
    const monDate = addDays(currentWeekStart, 0);
    monDate.setHours(10, 0, 0, 0);

    const tueDate = addDays(currentWeekStart, 1);
    tueDate.setHours(14, 0, 0, 0);

    const openSlot = makeSlot({
      id: '0193a4f2-7c3e-7b1a-9f2d-000000000001',
      startsAt: monDate.toISOString(),
      status: 'OPEN',
    });

    const bookedSlot = makeSlot({
      id: '0193a4f2-7c3e-7b1a-9f2d-000000000002',
      startsAt: tueDate.toISOString(),
      status: 'BOOKED',
      bookedBy: '0193a4f2-7c3e-7b1a-9f2d-0000000000aa',
      bookedAt: '2026-11-21T08:00:00.000Z',
    });

    const captured: { params: URLSearchParams | null } = { params: null };
    server.use(
      meHandler(adminMe('REVIEWER')),
      http.get(`${TEST_API_URL}/admin/kyc/interview/slots`, ({ request }) => {
        captured.params = new URL(request.url).searchParams;
        return HttpResponse.json({ items: [openSlot, bookedSlot] });
      }),
    );

    await renderApp('/interviews', { token: 'valid-token' });

    // Assert query request GET
    await waitFor(() => expect(captured.params).not.toBeNull());
    expect(captured.params?.get('from')).toBe(currentWeekStart.toISOString());
    expect(captured.params?.get('to')).toBe(addDays(currentWeekStart, 7).toISOString());
    expect(captured.params?.get('limit')).toBe(String(PAGE_LIMIT_MAX));

    // Tìm 2 nút slot
    const bookedBtn = await screen.findByRole('button', {
      name: new RegExp(INTERVIEWS_COPY.statusLabels.BOOKED),
    });
    const openBtn = await screen.findByRole('button', {
      name: new RegExp(INTERVIEWS_COPY.statusLabels.OPEN),
    });

    // Assert data-status khác nhau
    expect(bookedBtn.getAttribute('data-status')).toBe('BOOKED');
    expect(openBtn.getAttribute('data-status')).toBe('OPEN');

    // Assert text badge khác nhau
    expect(bookedBtn.textContent).toContain(INTERVIEWS_COPY.statusLabels.BOOKED);
    expect(openBtn.textContent).toContain(INTERVIEWS_COPY.statusLabels.OPEN);

    // Assert className khác nhau
    expect(bookedBtn.className).not.toBe(openBtn.className);

    // Assert disabled: OPEN disabled, BOOKED không disabled
    expect((openBtn as HTMLButtonElement).disabled).toBe(true);
    expect((bookedBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it('chuyển tuần sau gọi API với from tuần kế tiếp', async () => {
    const currentWeekStart = startOfWeek(new Date());
    const capturedFroms: string[] = [];

    server.use(
      meHandler(adminMe('REVIEWER')),
      http.get(`${TEST_API_URL}/admin/kyc/interview/slots`, ({ request }) => {
        const url = new URL(request.url);
        const fromParam = url.searchParams.get('from');
        if (fromParam) capturedFroms.push(fromParam);
        return HttpResponse.json({ items: [] });
      }),
    );

    await renderApp('/interviews', { token: 'valid-token' });

    // Click nút "Tuần sau"
    const nextWeekBtn = await screen.findByRole('button', {
      name: INTERVIEWS_COPY.nextWeek,
    });
    fireEvent.click(nextWeekBtn);

    const expectedNextFrom = addDays(currentWeekStart, 7).toISOString();
    await waitFor(() => {
      expect(capturedFroms).toContain(expectedNextFrom);
    });
  });

  it('tạo slot: gửi startsAt ISO, hiển thị thời lượng từ INTERVIEW_DURATION_MINUTES, làm mới lịch', async () => {
    const currentWeekStart = startOfWeek(new Date());
    const thuNam = addDays(currentWeekStart, 3);
    thuNam.setHours(10, 0, 0, 0);

    const newSlot = makeSlot({
      id: '0193a4f2-7c3e-7b1a-9f2d-000000000003',
      startsAt: thuNam.toISOString(),
      meetingUrl: 'https://meet.example.com/abc',
      status: 'OPEN',
    });

    let getCount = 0;
    let capturedPostBody: unknown = null;

    server.use(
      meHandler(adminMe('REVIEWER')),
      http.get(`${TEST_API_URL}/admin/kyc/interview/slots`, () => {
        getCount++;
        return HttpResponse.json({
          items: getCount > 1 ? [newSlot] : [],
        });
      }),
      http.post(`${TEST_API_URL}/admin/kyc/interview/slots`, async ({ request }) => {
        capturedPostBody = await request.json();
        return HttpResponse.json(newSlot, { status: 201 });
      }),
    );

    await renderApp('/interviews', { token: 'valid-token' });

    // Click "Mở slot"
    const openModalBtn = await screen.findByRole('button', {
      name: INTERVIEWS_COPY.openSlotButton,
    });
    fireEvent.click(openModalBtn);

    // Kiểm tra hint chứa String(INTERVIEW_DURATION_MINUTES)
    expect(screen.getByText(new RegExp(String(INTERVIEW_DURATION_MINUTES)))).toBeTruthy();

    // Nhập startsAt và meetingUrl
    fireEvent.change(screen.getByLabelText(INTERVIEWS_COPY.openSlotModal.startsAtLabel), {
      target: { value: toLocalInputValue(thuNam) },
    });
    fireEvent.change(screen.getByLabelText(INTERVIEWS_COPY.openSlotModal.meetingUrlLabel), {
      target: { value: 'https://meet.example.com/abc' },
    });

    // Submit form
    fireEvent.click(screen.getByRole('button', { name: INTERVIEWS_COPY.openSlotModal.submit }));

    // Body POST gửi startsAt ISO và meetingUrl
    await waitFor(() => expect(capturedPostBody).not.toBeNull());
    expect(capturedPostBody).toEqual({
      startsAt: thuNam.toISOString(),
      meetingUrl: 'https://meet.example.com/abc',
    });

    // Thông báo thành công xuất hiện
    await screen.findByText(INTERVIEWS_COPY.openSlotModal.successNotice);

    // Modal đóng
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    // Lịch được làm mới (GET >= 2 lần và hiển thị slot mới)
    expect(getCount).toBeGreaterThanOrEqual(2);
    await screen.findByRole('button', {
      name: new RegExp(INTERVIEWS_COPY.statusLabels.OPEN),
    });
  });

  it('tạo slot trùng giờ hiển thị lỗi theo mã', async () => {
    const currentWeekStart = startOfWeek(new Date());
    const thuNam = addDays(currentWeekStart, 3);
    thuNam.setHours(10, 0, 0, 0);

    server.use(
      meHandler(adminMe('REVIEWER')),
      http.get(`${TEST_API_URL}/admin/kyc/interview/slots`, () => {
        return HttpResponse.json({ items: [] });
      }),
      http.post(`${TEST_API_URL}/admin/kyc/interview/slots`, () => {
        return problem(409, 'INTERVIEW_SLOT_OVERLAP');
      }),
    );

    await renderApp('/interviews', { token: 'valid-token' });

    fireEvent.click(await screen.findByRole('button', { name: INTERVIEWS_COPY.openSlotButton }));

    fireEvent.change(screen.getByLabelText(INTERVIEWS_COPY.openSlotModal.startsAtLabel), {
      target: { value: toLocalInputValue(thuNam) },
    });

    fireEvent.click(screen.getByRole('button', { name: INTERVIEWS_COPY.openSlotModal.submit }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(messageFor({ code: 'INTERVIEW_SLOT_OVERLAP' }).title);

    // Modal vẫn mở
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('tạo slot quá khứ', async () => {
    const currentWeekStart = startOfWeek(new Date());
    const pastTime = addDays(currentWeekStart, -1);
    pastTime.setHours(10, 0, 0, 0);

    server.use(
      meHandler(adminMe('REVIEWER')),
      http.get(`${TEST_API_URL}/admin/kyc/interview/slots`, () => {
        return HttpResponse.json({ items: [] });
      }),
      http.post(`${TEST_API_URL}/admin/kyc/interview/slots`, () => {
        return problem(422, 'INTERVIEW_SLOT_IN_PAST');
      }),
    );

    await renderApp('/interviews', { token: 'valid-token' });

    fireEvent.click(await screen.findByRole('button', { name: INTERVIEWS_COPY.openSlotButton }));

    fireEvent.change(screen.getByLabelText(INTERVIEWS_COPY.openSlotModal.startsAtLabel), {
      target: { value: toLocalInputValue(pastTime) },
    });

    fireEvent.click(screen.getByRole('button', { name: INTERVIEWS_COPY.openSlotModal.submit }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(messageFor({ code: 'INTERVIEW_SLOT_IN_PAST' }).title);
  });

  it('validate client: chưa chọn giờ thì không gọi API', async () => {
    let postCallCount = 0;
    server.use(
      meHandler(adminMe('REVIEWER')),
      http.get(`${TEST_API_URL}/admin/kyc/interview/slots`, () => {
        return HttpResponse.json({ items: [] });
      }),
      http.post(`${TEST_API_URL}/admin/kyc/interview/slots`, () => {
        postCallCount++;
        return HttpResponse.json({}, { status: 201 });
      }),
    );

    await renderApp('/interviews', { token: 'valid-token' });

    fireEvent.click(await screen.findByRole('button', { name: INTERVIEWS_COPY.openSlotButton }));

    // Xoá giờ gợi ý sẵn rồi submit
    fireEvent.change(screen.getByLabelText(INTERVIEWS_COPY.openSlotModal.startsAtLabel), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByRole('button', { name: INTERVIEWS_COPY.openSlotModal.submit }));

    expect(screen.getByText(INTERVIEWS_COPY.openSlotModal.errors.startsAtRequired)).toBeTruthy();
    expect(postCallCount).toBe(0);
  });

  it('ghi chú: mở slot đã đặt, chọn kết quả, nhập nhận xét, gửi PUT', async () => {
    const currentWeekStart = startOfWeek(new Date());
    const thuBa = addDays(currentWeekStart, 1);
    thuBa.setHours(14, 0, 0, 0);

    const slotId = '0193a4f2-7c3e-7b1a-9f2d-000000000002';
    const bookedSlot = makeSlot({
      id: slotId,
      startsAt: thuBa.toISOString(),
      status: 'BOOKED',
      bookedBy: '0193a4f2-7c3e-7b1a-9f2d-0000000000aa',
    });

    const completedSlot = makeSlot({
      ...bookedSlot,
      status: 'COMPLETED',
      outcome: 'PASSED',
      notes: 'Ứng viên nghiêm túc, hồ sơ khớp',
      recordedBy: ADMIN_ID,
      recordedAt: new Date().toISOString(),
    });

    let currentSlot = bookedSlot;
    let capturedPutBody: unknown = null;

    server.use(
      meHandler(adminMe('REVIEWER')),
      http.get(`${TEST_API_URL}/admin/kyc/interview/slots`, () => {
        return HttpResponse.json({ items: [currentSlot] });
      }),
      http.put(`${TEST_API_URL}/admin/kyc/interview/${slotId}/notes`, async ({ request }) => {
        capturedPutBody = await request.json();
        currentSlot = completedSlot;
        return HttpResponse.json(completedSlot);
      }),
    );

    await renderApp('/interviews', { token: 'valid-token' });

    // Click vào slot BOOKED
    const bookedBtn = await screen.findByRole('button', {
      name: new RegExp(INTERVIEWS_COPY.statusLabels.BOOKED),
    });
    fireEvent.click(bookedBtn);

    // Dialog mở ra
    expect(
      await screen.findByRole('heading', {
        name: INTERVIEWS_COPY.notesModal.title,
      }),
    ).toBeTruthy();

    // Chọn radio "Đạt"
    fireEvent.click(screen.getByLabelText(INTERVIEWS_COPY.outcomeLabels.PASSED));

    // Nhập nhận xét
    fireEvent.change(screen.getByLabelText(INTERVIEWS_COPY.notesModal.notesLabel), {
      target: { value: 'Ứng viên nghiêm túc, hồ sơ khớp' },
    });

    // Submit ghi chú
    fireEvent.click(screen.getByRole('button', { name: INTERVIEWS_COPY.notesModal.submit }));

    // Kiểm tra body PUT gửi lên
    await waitFor(() => expect(capturedPutBody).not.toBeNull());
    expect(capturedPutBody).toEqual({
      outcome: 'PASSED',
      notes: 'Ứng viên nghiêm túc, hồ sơ khớp',
    });

    // Thông báo thành công xuất hiện
    await screen.findByText(INTERVIEWS_COPY.notesModal.successNotice);

    // Slot chuyển sang COMPLETED sau khi refetch
    await screen.findByRole('button', {
      name: new RegExp(INTERVIEWS_COPY.statusLabels.COMPLETED),
    });
  });

  it('ghi chú trước giờ phỏng vấn hiển thị lỗi INTERVIEW_NOT_STARTED', async () => {
    const currentWeekStart = startOfWeek(new Date());
    const thuBa = addDays(currentWeekStart, 1);
    thuBa.setHours(14, 0, 0, 0);

    const slotId = '0193a4f2-7c3e-7b1a-9f2d-000000000002';
    const bookedSlot = makeSlot({
      id: slotId,
      startsAt: thuBa.toISOString(),
      status: 'BOOKED',
    });

    server.use(
      meHandler(adminMe('REVIEWER')),
      http.get(`${TEST_API_URL}/admin/kyc/interview/slots`, () => {
        return HttpResponse.json({ items: [bookedSlot] });
      }),
      http.put(`${TEST_API_URL}/admin/kyc/interview/${slotId}/notes`, () => {
        return problem(409, 'INTERVIEW_NOT_STARTED');
      }),
    );

    await renderApp('/interviews', { token: 'valid-token' });

    const bookedBtn = await screen.findByRole('button', {
      name: new RegExp(INTERVIEWS_COPY.statusLabels.BOOKED),
    });
    fireEvent.click(bookedBtn);

    fireEvent.click(screen.getByLabelText(INTERVIEWS_COPY.outcomeLabels.PASSED));
    fireEvent.change(screen.getByLabelText(INTERVIEWS_COPY.notesModal.notesLabel), {
      target: { value: 'Thử ghi nhận' },
    });

    fireEvent.click(screen.getByRole('button', { name: INTERVIEWS_COPY.notesModal.submit }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(messageFor({ code: 'INTERVIEW_NOT_STARTED' }).title);
  });

  it('slot đã phỏng vấn mở lại thấy ghi chú cũ', async () => {
    const currentWeekStart = startOfWeek(new Date());
    const thuBa = addDays(currentWeekStart, 1);
    thuBa.setHours(14, 0, 0, 0);

    const completedSlot = makeSlot({
      id: '0193a4f2-7c3e-7b1a-9f2d-000000000005',
      startsAt: thuBa.toISOString(),
      status: 'COMPLETED',
      outcome: 'FAILED',
      notes: 'Ứng viên nghiêm túc',
    });

    server.use(
      meHandler(adminMe('REVIEWER')),
      http.get(`${TEST_API_URL}/admin/kyc/interview/slots`, () => {
        return HttpResponse.json({ items: [completedSlot] });
      }),
    );

    await renderApp('/interviews', { token: 'valid-token' });

    const completedBtn = await screen.findByRole('button', {
      name: new RegExp(INTERVIEWS_COPY.statusLabels.COMPLETED),
    });
    fireEvent.click(completedBtn);

    // Textarea có giá trị cũ
    const textarea = screen.getByLabelText(INTERVIEWS_COPY.notesModal.notesLabel) as HTMLTextAreaElement;
    expect(textarea.value).toBe('Ứng viên nghiêm túc');

    // Radio FAILED được checked
    const failedRadio = screen.getByLabelText(INTERVIEWS_COPY.outcomeLabels.FAILED) as HTMLInputElement;
    expect(failedRadio.checked).toBe(true);
  });
});
