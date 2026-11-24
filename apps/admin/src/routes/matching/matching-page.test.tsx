// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach, afterAll, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { TEST_API_URL, problem } from '@tamgiao/api-client/mocks';
import type { AdminCandidateDto, MatchesBoardItem } from '@tamgiao/contracts/matching';
import type { KycQueueItem } from '@tamgiao/contracts/verification';
import { server, meHandler } from '../../test-utils/msw-server';
import { adminMe } from '../../test-utils/fixtures';
import { renderApp } from '../../test-utils/render-app';
import { FORBIDDEN_COPY, NAV_COPY } from '../../layout/copy';
import { MATCHING_COPY } from '../../features/matching/copy';

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

const defaultScore = {
  total: 94,
  pillars: {
    VALUES_FAMILY: 96,
    PLANS_TIMING: 95,
    LIFESTYLE_FINANCE: 91,
  },
};

const USER_A_ID = '01890a5d-ac96-774b-bcce-b302099a8001';
const CANDIDATE_1_ID = '01890a5d-ac96-774b-bcce-b302099a8002';
const CANDIDATE_2_ID = '01890a5d-ac96-774b-bcce-b302099a8003';
const CANDIDATE_NULL_PROFILE_ID = '01890a5d-ac96-774b-bcce-b302099a8004';
const MATCH_1_ID = '01890a5d-ac96-774b-bcce-b302099a8010';
const MATCH_2_ID = '01890a5d-ac96-774b-bcce-b302099a8011';
const STAFF_ID = '0193a4f2-7c3e-7b1a-9f2d-3c4b5a6d7e8f';

function makeBoardItem(overrides?: Partial<MatchesBoardItem>): MatchesBoardItem {
  return {
    matchId: MATCH_1_ID,
    status: 'OFFERED',
    participants: [
      { userId: USER_A_ID, fullName: 'Nguyễn Văn A', accepted: true },
      { userId: CANDIDATE_1_ID, fullName: 'Trần Thị B', accepted: false },
    ],
    score: defaultScore,
    expiresAt: '2026-11-25T10:00:00.000Z',
    offeredAt: '2026-11-24T10:00:00.000Z',
    updatedAt: '2026-11-24T10:00:00.000Z',
    createdBy: STAFF_ID,
    ...overrides,
  };
}

function makeCandidate(overrides?: Partial<AdminCandidateDto>): AdminCandidateDto {
  return {
    userId: CANDIDATE_1_ID,
    score: defaultScore,
    commonPoints: ['SAME_CITY', 'SHARED_TRAIT_HONEST'],
    profile: {
      fullName: 'Trần Thị B',
      age: 26,
      gender: 'female',
      currentCity: 'Hà Nội',
      occupation: 'Kỹ sư phần mềm',
      education: 'bachelor',
      avatar: null,
    },
    ...overrides,
  };
}

function makeKycApprovedItem(overrides?: Partial<KycQueueItem>): KycQueueItem {
  return {
    id: '01890a5d-ac96-774b-bcce-b302099a8099',
    userId: USER_A_ID,
    status: 'APPROVED',
    fullName: 'Nguyễn Văn A',
    occupation: 'Bác sĩ',
    submittedAt: '2026-11-20T08:00:00.000Z',
    updatedAt: '2026-11-20T10:00:00.000Z',
    reviewerId: STAFF_ID,
    flags: [],
    steps: [],
    ...overrides,
  };
}

describe('Matching Page & Propose Flows', () => {
  it('a. MATCHMAKER thấy menu matching, vào /matching thấy danh sách; REVIEWER vào /matching → FORBIDDEN_COPY.title', async () => {
    server.use(
      meHandler(adminMe('MATCHMAKER')),
      http.get(`${TEST_API_URL}/admin/matches`, () => {
        return HttpResponse.json({
          items: [makeBoardItem()],
          nextCursor: null,
        });
      }),
    );

    const { unmount } = await renderApp('/matching', { token: 'valid-token' });

    expect(await screen.findByRole('link', { name: NAV_COPY.matching })).toBeTruthy();
    expect(await screen.findByText('Nguyễn Văn A')).toBeTruthy();

    unmount();

    server.use(meHandler(adminMe('REVIEWER')));

    await renderApp('/matching', { token: 'valid-token' });
    expect(await screen.findByRole('heading', { name: FORBIDDEN_COPY.title })).toBeTruthy();
  });

  it('b. Lọc trạng thái DECLINED → request status=DECLINED; phân trang cursor', async () => {
    const requests: URL[] = [];
    server.use(
      http.get(`${TEST_API_URL}/admin/matches`, ({ request }) => {
        const url = new URL(request.url);
        requests.push(url);
        const status = url.searchParams.get('status');
        const cursor = url.searchParams.get('cursor');

        if (status === 'DECLINED') {
          return HttpResponse.json({
            items: [
              makeBoardItem({
                matchId: MATCH_2_ID,
                status: 'DECLINED',
                participants: [
                  { userId: USER_A_ID, fullName: 'Người Từ Chối A', accepted: false },
                  { userId: CANDIDATE_1_ID, fullName: 'Người Từ Chối B', accepted: false },
                ],
              }),
            ],
            nextCursor: null,
          });
        }

        if (cursor === 'cursor-page-2') {
          return HttpResponse.json({
            items: [
              makeBoardItem({
                matchId: MATCH_2_ID,
                participants: [
                  { userId: USER_A_ID, fullName: 'Người Trang 2', accepted: false },
                  { userId: CANDIDATE_1_ID, fullName: 'Đối Tượng Trang 2', accepted: false },
                ],
              }),
            ],
            nextCursor: null,
          });
        }

        return HttpResponse.json({
          items: [makeBoardItem()],
          nextCursor: 'cursor-page-2',
        });
      }),
    );

    await renderApp('/matching', { token: 'valid-token' });

    expect(await screen.findByText('Nguyễn Văn A')).toBeTruthy();

    const loadMoreBtn = await screen.findByRole('button', { name: MATCHING_COPY.board.loadMore });
    fireEvent.click(loadMoreBtn);

    expect(await screen.findByText('Người Trang 2')).toBeTruthy();
    expect(screen.getByText(MATCHING_COPY.board.endOfList)).toBeTruthy();

    const select = screen.getByLabelText(MATCHING_COPY.statusFilter.label);
    fireEvent.change(select, { target: { value: 'DECLINED' } });

    expect(await screen.findByText('Người Từ Chối A')).toBeTruthy();
    const declinedReq = requests.find((u) => u.searchParams.get('status') === 'DECLINED');
    expect(declinedReq).toBeDefined();
  });

  it('c. SUPERVISOR: tìm và chọn người đã duyệt → request /admin/kyc/submissions có status=APPROVED; → gọi candidates đúng userId → chọn ứng viên → so sánh hiện tên + điểm chung, không có số điểm → đề xuất: body đúng {userAId,userBId,staffNote} → điều hướng /matching', async () => {
    let capturedKycUrl: URL | null = null;
    let capturedCandidatesUserId: string | null = null;
    let capturedProposeBody: unknown = null;

    server.use(
      http.get(`${TEST_API_URL}/admin/matches`, () => {
        return HttpResponse.json({
          items: [],
          nextCursor: null,
        });
      }),
      http.get(`${TEST_API_URL}/admin/kyc/submissions`, ({ request }) => {
        capturedKycUrl = new URL(request.url);
        return HttpResponse.json({
          items: [makeKycApprovedItem()],
          nextCursor: null,
        });
      }),
      http.get(`${TEST_API_URL}/admin/users/:id/candidates`, ({ params }) => {
        capturedCandidatesUserId = params.id as string;
        return HttpResponse.json({
          items: [makeCandidate()],
        });
      }),
      http.post(`${TEST_API_URL}/admin/matches`, async ({ request }) => {
        capturedProposeBody = await request.json();
        return HttpResponse.json(
          {
            matchId: MATCH_1_ID,
            status: 'OFFERED',
            participantIds: [USER_A_ID, CANDIDATE_1_ID],
            score: defaultScore,
            expiresAt: '2026-11-25T10:00:00.000Z',
          },
          { status: 201 },
        );
      }),
    );

    const { history } = await renderApp('/matching/propose', { token: 'valid-token' });

    expect(await screen.findByText('Nguyễn Văn A')).toBeTruthy();
    expect(capturedKycUrl).not.toBeNull();
    expect(capturedKycUrl!.searchParams.get('status')).toBe('APPROVED');

    const selectBtn = screen.getByRole('button', { name: MATCHING_COPY.propose.selectButton });
    fireEvent.click(selectBtn);

    expect(await screen.findByText('Trần Thị B')).toBeTruthy();
    expect(capturedCandidatesUserId).toBe(USER_A_ID);

    const candidateRadio = screen.getByRole('radio', { name: /Trần Thị B/i });
    fireEvent.click(candidateRadio);

    expect(
      await screen.findByRole('heading', { name: MATCHING_COPY.propose.comparisonSection }),
    ).toBeTruthy();
    expect(screen.getByText('Cùng khu vực sinh sống')).toBeTruthy();
    expect(screen.getByText('Cùng trân trọng sự chân thành')).toBeTruthy();

    expect(screen.queryByText('94')).toBeNull();
    expect(screen.queryByText('96')).toBeNull();

    const noteInput = screen.getByLabelText(MATCHING_COPY.propose.staffNoteLabel);
    fireEvent.change(noteInput, { target: { value: 'Lời nhắn ghi chú chuyên viên' } });

    const submitBtn = screen.getByRole('button', { name: MATCHING_COPY.propose.submitButton });
    fireEvent.click(submitBtn);

    const confirmModalTitle = await screen.findByRole('heading', {
      name: MATCHING_COPY.propose.confirmModalTitle,
    });
    expect(confirmModalTitle).toBeTruthy();

    const confirmSubmitBtn = screen.getByRole('button', { name: MATCHING_COPY.propose.confirmSubmit });
    fireEvent.click(confirmSubmitBtn);

    await waitFor(() => {
      expect(history.location.pathname).toBe('/matching');
    });

    expect(capturedProposeBody).toEqual({
      userAId: USER_A_ID,
      userBId: CANDIDATE_1_ID,
      staffNote: 'Lời nhắn ghi chú chuyên viên',
    });
  });

  it('d. MATCHMAKER: không gọi /admin/kyc/submissions (onUnhandledRequest error + không thấy form tìm kiếm); nhập mã sai → báo lỗi; mã đúng → tải ứng viên', async () => {
    let capturedCandidateUserId: string | null = null;
    server.use(
      meHandler(adminMe('MATCHMAKER')),
      http.get(`${TEST_API_URL}/admin/matches`, () => {
        return HttpResponse.json({
          items: [],
          nextCursor: null,
        });
      }),
      http.get(`${TEST_API_URL}/admin/users/:id/candidates`, ({ params }) => {
        capturedCandidateUserId = params.id as string;
        return HttpResponse.json({
          items: [makeCandidate()],
        });
      }),
    );

    await renderApp('/matching/propose', { token: 'valid-token' });

    const idInput = await screen.findByLabelText(MATCHING_COPY.propose.manualInputLabel);
    expect(screen.queryByText(MATCHING_COPY.propose.userPickerTitle)).toBeNull();
    const confirmIdBtn = screen.getByRole('button', { name: MATCHING_COPY.propose.manualInputSubmit });

    fireEvent.change(idInput, { target: { value: 'invalid-uuid-123' } });
    fireEvent.click(confirmIdBtn);

    expect(await screen.findByText(MATCHING_COPY.propose.invalidUuid)).toBeTruthy();
    expect(capturedCandidateUserId).toBeNull();

    fireEvent.change(idInput, { target: { value: USER_A_ID } });
    fireEvent.click(confirmIdBtn);

    expect(await screen.findByText('Trần Thị B')).toBeTruthy();
    expect(capturedCandidateUserId).toBe(USER_A_ID);
  });

  it('e. AC1: ứng viên có mặt trong board match mở → radio disabled + lý do USER_BUSY', async () => {
    server.use(
      http.get(`${TEST_API_URL}/admin/matches`, () => {
        return HttpResponse.json({
          items: [
            makeBoardItem({
              participants: [
                { userId: STAFF_ID, fullName: 'Người Ngoài', accepted: true },
                { userId: CANDIDATE_2_ID, fullName: 'Ứng Viên Đang Bận', accepted: false },
              ],
            }),
          ],
          nextCursor: null,
        });
      }),
      http.get(`${TEST_API_URL}/admin/users/:id/candidates`, () => {
        return HttpResponse.json({
          items: [
            makeCandidate({
              userId: CANDIDATE_1_ID,
              profile: { ...makeCandidate().profile!, fullName: 'Ứng Viên Rảnh' },
            }),
            makeCandidate({
              userId: CANDIDATE_2_ID,
              profile: { ...makeCandidate().profile!, fullName: 'Ứng Viên Đang Bận' },
            }),
          ],
        });
      }),
    );

    await renderApp(`/matching/propose?userId=${USER_A_ID}`, { token: 'valid-token' });

    expect(await screen.findByText('Ứng Viên Rảnh')).toBeTruthy();
    const busyRadio = screen.getByRole('radio', { name: /Ứng Viên Đang Bận/i });
    expect(busyRadio.hasAttribute('disabled')).toBe(true);

    const busyReasonBadge = screen.getByText(MATCHING_COPY.ineligibleReasons.USER_BUSY);
    expect(busyReasonBadge).toBeTruthy();

    const availableRadio = screen.getByRole('radio', { name: /Ứng Viên Rảnh/i });
    expect(availableRadio.hasAttribute('disabled')).toBe(false);
  });

  it('f. AC1: POST trả 409 USER_COOLING_DOWN meta: { userIds: [candidateId] } → radio ứng viên đó disabled + lý do; không điều hướng. Và USER_BUSY với userIds=[A] → banner, mọi radio disabled', async () => {
    server.use(
      http.get(`${TEST_API_URL}/admin/matches`, () => {
        return HttpResponse.json({ items: [], nextCursor: null });
      }),
      http.get(`${TEST_API_URL}/admin/users/:id/candidates`, () => {
        return HttpResponse.json({
          items: [makeCandidate({ userId: CANDIDATE_1_ID })],
        });
      }),
      http.post(`${TEST_API_URL}/admin/matches`, () => {
        return problem(409, 'USER_COOLING_DOWN', {
          meta: { userIds: [CANDIDATE_1_ID] },
        });
      }),
    );

    const { history } = await renderApp(`/matching/propose?userId=${USER_A_ID}`, {
      token: 'valid-token',
    });

    const candidateRadio = await screen.findByRole('radio', { name: /Trần Thị B/i });
    fireEvent.click(candidateRadio);

    const submitBtn = await screen.findByRole('button', { name: MATCHING_COPY.propose.submitButton });
    fireEvent.click(submitBtn);

    const confirmSubmitBtn = await screen.findByRole('button', { name: MATCHING_COPY.propose.confirmSubmit });
    fireEvent.click(confirmSubmitBtn);

    expect(await screen.findByText(MATCHING_COPY.ineligibleReasons.USER_COOLING_DOWN)).toBeTruthy();
    expect(history.location.pathname).toBe('/matching/propose');
    expect(candidateRadio.hasAttribute('disabled')).toBe(true);
  });

  it('f2. POST 409 USER_BUSY với userIds=[A] → banner người chính, mọi radio disabled, không điều hướng', async () => {
    server.use(
      http.get(`${TEST_API_URL}/admin/matches`, () => HttpResponse.json({ items: [], nextCursor: null })),
      http.get(`${TEST_API_URL}/admin/users/:id/candidates`, () =>
        HttpResponse.json({
          items: [
            makeCandidate({ userId: CANDIDATE_1_ID }),
            makeCandidate({
              userId: CANDIDATE_2_ID,
              profile: { ...makeCandidate().profile!, fullName: 'Lê Thị C' },
            }),
          ],
        }),
      ),
      http.post(`${TEST_API_URL}/admin/matches`, () =>
        problem(409, 'USER_BUSY', { meta: { userIds: [USER_A_ID] } }),
      ),
    );
    const { history } = await renderApp(`/matching/propose?userId=${USER_A_ID}`, { token: 'valid-token' });

    fireEvent.click(await screen.findByRole('radio', { name: /Trần Thị B/i }));
    fireEvent.click(await screen.findByRole('button', { name: MATCHING_COPY.propose.submitButton }));
    fireEvent.click(await screen.findByRole('button', { name: MATCHING_COPY.propose.confirmSubmit }));

    expect(
      await screen.findByText(MATCHING_COPY.propose.userABlocked(MATCHING_COPY.ineligibleReasons.USER_BUSY)),
    ).toBeTruthy();
    for (const radio of screen.getAllByRole('radio')) expect(radio.hasAttribute('disabled')).toBe(true);
    expect(history.location.pathname).toBe('/matching/propose');
  });

  it('f3. người chính nằm ở trang sau của bảng cặp mở → vẫn nhận ra đang bận (tải hết các trang)', async () => {
    server.use(
      http.get(`${TEST_API_URL}/admin/matches`, ({ request }) =>
        new URL(request.url).searchParams.get('cursor') === 'page-2'
          ? HttpResponse.json({ items: [makeBoardItem()], nextCursor: null })
          : HttpResponse.json({ items: [], nextCursor: 'page-2' }),
      ),
      http.get(`${TEST_API_URL}/admin/users/:id/candidates`, () =>
        HttpResponse.json({ items: [makeCandidate({ userId: CANDIDATE_2_ID })] }),
      ),
    );
    await renderApp(`/matching/propose?userId=${USER_A_ID}`, { token: 'valid-token' });

    expect(
      await screen.findByText(MATCHING_COPY.propose.userABlocked(MATCHING_COPY.ineligibleReasons.USER_BUSY)),
    ).toBeTruthy();
    expect((await screen.findByRole('radio')).hasAttribute('disabled')).toBe(true);
  });

  it('g. PAIR_ALREADY_TRIED → lý do trên ứng viên', async () => {
    server.use(
      http.get(`${TEST_API_URL}/admin/matches`, () => {
        return HttpResponse.json({ items: [], nextCursor: null });
      }),
      http.get(`${TEST_API_URL}/admin/users/:id/candidates`, () => {
        return HttpResponse.json({
          items: [makeCandidate({ userId: CANDIDATE_1_ID })],
        });
      }),
      http.post(`${TEST_API_URL}/admin/matches`, () => {
        return problem(409, 'PAIR_ALREADY_TRIED');
      }),
    );

    await renderApp(`/matching/propose?userId=${USER_A_ID}`, { token: 'valid-token' });

    const candidateRadio = await screen.findByRole('radio', { name: /Trần Thị B/i });
    fireEvent.click(candidateRadio);

    const submitBtn = await screen.findByRole('button', { name: MATCHING_COPY.propose.submitButton });
    fireEvent.click(submitBtn);

    const confirmSubmitBtn = await screen.findByRole('button', { name: MATCHING_COPY.propose.confirmSubmit });
    fireEvent.click(confirmSubmitBtn);

    expect(await screen.findByText(MATCHING_COPY.ineligibleReasons.PAIR_ALREADY_TRIED)).toBeTruthy();
    expect(candidateRadio.hasAttribute('disabled')).toBe(true);
  });

  it('h. profile null → radio disabled', async () => {
    server.use(
      http.get(`${TEST_API_URL}/admin/matches`, () => {
        return HttpResponse.json({ items: [], nextCursor: null });
      }),
      http.get(`${TEST_API_URL}/admin/users/:id/candidates`, () => {
        return HttpResponse.json({
          items: [
            makeCandidate({
              userId: CANDIDATE_NULL_PROFILE_ID,
              profile: null,
            }),
          ],
        });
      }),
    );

    await renderApp(`/matching/propose?userId=${USER_A_ID}`, { token: 'valid-token' });

    expect(await screen.findByText(MATCHING_COPY.propose.candidateProfileMissing)).toBeTruthy();
    const radio = screen.getByRole('radio', { name: new RegExp(CANDIDATE_NULL_PROFILE_ID.slice(0, 8), 'i') });
    expect(radio.hasAttribute('disabled')).toBe(true);
  });
});
