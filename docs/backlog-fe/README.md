# Backlog Frontend — Tâm Giao

Backend (7 sprint, `docs/backlog/`) đã xong phần lõi: API REST + WebSocket chat, OpenAPI tại `/docs`, Zod DTO / mã lỗi /
hằng số dùng chung ở `@tamgiao/contracts`. Backlog này dựng **3 ứng dụng FE** trên nền đó:

| App | Thư mục | Người dùng | Thiết kế |
|---|---|---|---|
| Mobile (iOS/Android) | `apps/mobile` | Người dùng tìm bạn đời | 14 màn trong `design/stitch/*` (khung 390px) |
| Web admin | `apps/admin` | Chuyên viên thẩm định / mai mối / kiểm duyệt | 2 màn (khung 1280px): đăng nhập, thẩm định eKYC |
| Partner (PWA) | `apps/partner` | Nhân viên quán đối tác quét voucher | **Chưa có thiết kế** |

- Sprint dài **2 tuần**. Tổng: **6 sprint ≈ 12 tuần**, 41 task. Từ FE-S3, mobile và admin chạy song song (2 luồng).
- Mỗi task theo format `docs/backlog/_TASK_TEMPLATE.md`, ID `FE-S<sprint>-<nn>`; cột **Module** ghi app/package.
- Agent làm task FE tuân thủ `AGENTS.md` (mục 1, 7, 8, 9, 10) **và** luật FE ở mục "Luật FE" dưới đây.

## Lộ trình sprint

| Sprint | Chủ đề | Demo cuối sprint | Số task | File |
|---|---|---|---|---|
| FE-S1 | Nền móng FE | 3 app chạy trong monorepo, design tokens, api-client typed gọi được BE local, CI xanh | 7 | [sprint-fe-01.md](sprint-fe-01.md) |
| FE-S2 | Mobile: đăng nhập & hồ sơ | Đăng nhập OTP → tạo hồ sơ + ảnh → tiêu chí → bật push | 6 | [sprint-fe-02.md](sprint-fe-02.md) |
| FE-S3 | Xác thực (mobile) + Thẩm định (admin) | User trả phí, nộp eKYC, đặt phỏng vấn; chuyên viên đăng nhập 2FA và duyệt hồ sơ | 8 | [sprint-fe-03.md](sprint-fe-03.md) |
| FE-S4 | Ghép đôi & Chat | Chuyên viên đề xuất ghép; 2 user đồng ý → chat realtime; báo cáo vi phạm → kiểm duyệt | 8 | [sprint-fe-04.md](sprint-fe-04.md) |
| FE-S5 | Hẹn hò & Partner | Đặt lịch tại quán → quán quét voucher → check-in → đánh giá → tốt nghiệp | 7 | [sprint-fe-05.md](sprint-fe-05.md) |
| FE-S6 | Hoàn thiện & phát hành | E2E mobile/web, Sentry, build TestFlight/Internal + web staging | 5 | [sprint-fe-06.md](sprint-fe-06.md) |

```
FE-S1 Nền móng ─► FE-S2 Mobile onboarding ─► FE-S3 ┬ Mobile: thanh toán, eKYC, phỏng vấn ─► FE-S4 ┬ Mobile: ghép, chat ─► FE-S5 ┬ Mobile: hẹn hò ─► FE-S6
                                                    └ Admin: login 2FA, thẩm định          ──────► └ Admin: ghép, kiểm duyệt ─► ├ Admin: quán, cờ
                                                                                                                              └ Partner: quét voucher
```

## Bản đồ màn thiết kế → task

| Màn (`design/stitch/…`) | Task |
|---|---|
| `ng_nh_p_ng_k` (Đăng nhập/Đăng ký) | FE-S2-01 |
| `x_c_th_c_s_i_n_tho_i_otp` (Xác thực SĐT OTP) | FE-S2-01 |
| `kh_i_t_o_h_s_mi_n_ph` (Khởi tạo hồ sơ) | FE-S2-03 |
| `thi_t_l_p_ti_u_ch_b_n_i_b_l_c_c_ng` (Tiêu chí bạn đời) | FE-S2-04 |
| `x_c_th_c_ekyc_m_kh_a_h_s_t_ng_h_p_b_o_ch_ng_100` (eKYC + thanh toán) | FE-S3-01, FE-S3-02 |
| `h_s_ang_th_m_nh_h_ng_ch_1_1` (Hồ sơ đang thẩm định) | FE-S3-04 |
| `ng_nh_p_qu_n_tr_i_u_ph_i_mai_m_i` (Admin đăng nhập) | FE-S3-05 |
| `web_admin_th_m_nh_ekyc_gh_p_i_c_quy_n` (Admin thẩm định eKYC) | FE-S3-06 (+ khung điều hướng admin cho FE-S4-07/08, FE-S5-06/07) |
| `g_i_gh_p_i_c_quy_n` (Gợi ý ghép độc quyền) | FE-S4-01 |
| `ch_ph_n_h_i_gh_p_i_1_1` (Chờ phản hồi) | FE-S4-02 |
| `chi_ti_t_h_s_quan_ni_m_h_n_nh_n` (Chi tiết hồ sơ đối phương) | FE-S4-03 |
| `tr_chuy_n_h_n_h_c_quy_n` (Trò chuyện) | FE-S4-04 |
| `h_p_th_h_n_h_t_v_n_vi_n` (Hộp thư / Trò chuyện & Hẹn hò) | FE-S4-05 |
| `b_o_c_o_vi_ph_m_trung_t_m_an_to_n_kh_n_c_p` (Báo cáo & An toàn) | FE-S4-06 |
| `t_l_ch_g_p_m_t_i_m_h_n_an_to_n` (Đặt lịch gặp) | FE-S5-01, FE-S5-03 |
| `nh_gi_sau_g_p_m_t_quy_t_nh_h_n_h` (Đánh giá sau gặp) | FE-S5-04 |
| `t_m_giao_matchmaking_system/DESIGN.md` (design system) | FE-S1-02, FE-S1-07 |

Màn **chưa có thiết kế** (dựng từ design system, cần designer duyệt — FE-D4): cài đặt & thông báo, quyền dữ liệu,
đặt lịch phỏng vấn, voucher QR, check-in an toàn chi tiết, toàn bộ app partner, admin: đề xuất ghép, kiểm duyệt, quán đối
tác, slot phỏng vấn, audit log.

## Quyết định FE (PO đã đồng ý 2026-11-22)

| ID | Quyết định | Mặc định | Lý do |
|---|---|---|---|
| FE-D1 | Stack mobile | **Expo (React Native + TypeScript) + Expo Router** | BE đã chọn Expo Push (`ExpoPushSender`, token `ExponentPushToken[…]`); một codebase iOS/Android |
| FE-D2 | Stack web admin / partner | **React + Vite + TanStack Router/Query**; partner là PWA | Cùng TypeScript + `@tamgiao/contracts`; partner chỉ cần camera quét QR, không cần app store |
| FE-D3 | Styling | **Tailwind (web) + NativeWind (mobile)**, token từ `DESIGN.md` | Code Stitch là HTML + Tailwind → chuyển nhanh, một bộ token |
| FE-D4 | Màn chưa có thiết kế | Dựng từ design system + component chung, designer duyệt ở review sprint | Không chặn tiến độ |
| FE-D5 | Câu chữ thiết kế cần pháp lý | **Không hiển thị** "Bộ Công An • Đã kết nối", "Cơ sở dữ liệu VNeID", "VNeID Mức 2", "Bộ Ngoại Giao", "ký quỹ", "bảo chứng 100%" cho tới khi PO/pháp lý chốt (liên quan D1, D2) | Hệ thống chưa tích hợp thật các nguồn này; khẳng định sai là rủi ro pháp lý |
| FE-D6 | Tính năng có trong thiết kế nhưng BE chưa có | **Ẩn**: chat với chuyên viên đồng hành, % tương hợp + "3 trụ cột", thống kê dashboard admin, hộp thông báo lịch sử | Xem "Việc BE phát sinh" — chỉ bật khi BE có API |

## Luật FE (bổ sung AGENTS.md cho mọi task FE)

| # | Luật |
|---|---|
| F1 | Gọi API **chỉ qua `@tamgiao/api-client`** (FE-S1-03). Không `fetch` trực tiếp trong màn. Request/response parse bằng schema Zod của `@tamgiao/contracts`. |
| F2 | Con số nghiệp vụ (TTL, giới hạn ảnh, độ dài tin, cutoff…) lấy từ `@tamgiao/contracts/constants`. Không hardcode. |
| F3 | Lỗi hiển thị theo **mã lỗi** (`code` trong Problem JSON) qua bảng thông điệp FE-S1-04. Không hiển thị `detail` thô. |
| F4 | **Không lưu PII** ở storage thường (AsyncStorage/localStorage), không log PII (SĐT, CCCD, ảnh, nội dung chat). Token: `expo-secure-store` (mobile); admin/partner: cookie/bộ nhớ phiên theo BE. |
| F5 | Ảnh nhạy cảm (CCCD, selfie, bằng chứng) **không cache đĩa**, chỉ dùng presigned URL ngắn hạn; màn eKYC/chat/thẩm định bật chặn chụp màn hình khi nền tảng hỗ trợ. |
| F6 | Màu, chữ, khoảng cách lấy từ token (FE-S1-02). Không mã màu lẻ. Văn bản tiếng Việt đặt trong file nội dung, không rải trong component. |
| F7 | Mỗi màn có test: logic/hook (Vitest / jest-expo) + render màn với API giả (MSW); luồng chính có E2E ở FE-S6. |
| F8 | Server state dùng TanStack Query (cache, retry, invalidate). Không tự viết cache. WebSocket chat qua một client duy nhất (FE-S4-04). |

**Definition of Done FE** (thay cho lệnh test:int của BE): `pnpm typecheck`, `pnpm lint`, `pnpm test` pass ở root; màn
chạy được trên BE local (`pnpm dev` + provider giả) với ảnh chụp/ghi hình đính kèm báo cáo; AC có test chứng minh.

## Việc BE phát sinh từ FE (chưa có trong backlog BE)

| Việc | Cần cho | Ghi chú |
|---|---|---|
| `GET /me/notifications` (danh sách thông báo đã gửi, đánh dấu đã đọc) | Hộp thông báo trong app | Đọc từ `notification.deliveries` |
| Chat / hẹn tư vấn 1-1 với chuyên viên đồng hành | `h_p_th…`, `ch_ph_n_h_i…`, `g_i_gh_p_i…` (khối "Chị Mai Hương") | Tính năng mới — cần PO chốt phạm vi |
| Điểm tương hợp + phân tích 3 trụ cột | `g_i_gh_p_i…`, `ch_ph_n_h_i…` | Cần thuật toán + PO chốt có hiển thị con số không |
| `GET /admin/dashboard` (số hồ sơ chờ, cặp đang ghép, cảnh báo) | Header `web_admin_th_m_nh…` | Facade đọc từ các module |
| Lịch sử đổi voucher của quán | Partner app | Facade billing |
| BE-S7-10 phần riêng tư hồ sơ đối phương | `chi_ti_t_h_s…` | Đang BLOCKED (PO + pháp lý) |

## Bảng theo dõi tổng

| Sprint | TODO | IN_PROGRESS | IN_REVIEW | DONE | BLOCKED |
|---|---|---|---|---|---|
| FE-S1 | 0 | 0 | 0 | 7 | 0 |
| FE-S2 | 0 | 0 | 0 | 6 | 0 |
| FE-S3 | 0 | 0 | 0 | 8 | 0 |
| FE-S4 | 8 | 0 | 0 | 0 | 0 |
| FE-S5 | 7 | 0 | 0 | 0 | 0 |
| FE-S6 | 5 | 0 | 0 | 0 | 0 |

## Cách giao task

Theo quy trình đã thống nhất: **Claude lập kế hoạch/contract → `agy` viết code → Claude review**, chạy DoD rồi mới merge.
Mỗi task gộp thành **một commit** trên nhánh `sprint-fe/<NN>`; PR sprint có số commit = số task.
