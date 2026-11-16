# Backlog Backend — Tâm Giao

- Sprint dài **2 tuần**, team giả định 1–2 dev BE (hoặc nhiều subagent song song theo cột "Song song với").
- Mọi task theo format `docs/backlog/_TASK_TEMPLATE.md`; agent làm task theo luật `AGENTS.md`.
- Tổng: **7 sprint ≈ 14 tuần**, 53 task.

## Lộ trình sprint

| Sprint | Chủ đề | Mục tiêu demo cuối sprint | Số task | File |
|---|---|---|---|---|
| S1 | Nền móng | Monorepo chạy, CI xanh, API `/health`, outbox + job queue chạy được | 9 | [sprint-01.md](sprint-01.md) |
| S2 | Identity & Profile | Đăng nhập OTP, admin đăng nhập 2FA, tạo hồ sơ + tiêu chí, upload ảnh | 8 | [sprint-02.md](sprint-02.md) |
| S3 | Verification (eKYC) | Nộp eKYC (provider giả), admin duyệt/từ chối, phát `KycApproved` | 7 | [sprint-03.md](sprint-03.md) |
| S4 | Billing & Voucher | Thanh toán 299k (gateway giả), webhook, ledger, hoàn tiền khi bị từ chối, voucher QR | 7 | [sprint-04.md](sprint-04.md) |
| S5 | Matching (lõi) | Chuyên viên đề xuất ghép, user đồng ý/từ chối, hết hạn 24h tự động, độc quyền 1-1 | 7 | [sprint-05.md](sprint-05.md) |
| S6 | Messaging & Safety | Chat realtime 14 ngày, lọc lừa đảo, báo cáo → khoá 2 chiều | 6 | [sprint-06.md](sprint-06.md) |
| S7 | Dating, Notification, Hardening | Đặt hẹn quán đối tác, đổi voucher, đánh giá sau gặp → CLOSED_*, push, sẵn sàng staging | 9 | [sprint-07.md](sprint-07.md) |

## Sơ đồ phụ thuộc giữa sprint

```
S1 Nền móng ─► S2 Identity/Profile ─► S3 Verification ─┬─► S5 Matching ─► S6 Messaging/Safety ─► S7 Dating/Notif/Hardening
                                    └─► S4 Billing ─────┘                                         ▲
                                                         └──────────── voucher ───────────────────┘
```
S3 và S4 có thể chạy song song (2 dev / 2 nhóm subagent) sau khi S2 xong.

## Quyết định còn mở (không chặn code — dùng port + Fake adapter)

| ID | Quyết định | Ảnh hưởng task | Mặc định tạm thời |
|---|---|---|---|
| D1 | Mô hình thu tiền & tên gọi ("ký quỹ" vs "phí dịch vụ trả trước + voucher") — cần tư vấn pháp lý | BE-S4-01, S4-03, S4-04 | Đặt tên trung tính trong code: `VerificationPayment`; số tiền `DEPOSIT_VND` |
| D2 | Nhà cung cấp eKYC (FPT.AI / VNPT / khác) | BE-S3-02 | `FakeEkycProvider` |
| D3 | Cổng thanh toán (PayOS / VNPay / MoMo) | BE-S4-02 | `FakePaymentGateway` |
| D4 | Nhà cung cấp SMS brandname | BE-S2-01, BE-S7-05 | `ConsoleSmsSender` |
| D5 | Hạ tầng & KMS (cloud VN / region) | BE-S1-09, BE-S7-08 | `LocalKeyEncryptor` (master key từ env) |
| D6 | Tuổi tối thiểu, thời gian lưu ảnh eKYC | BE-S2-05, BE-S3-06 | `MIN_AGE=20`, `KYC_MEDIA_RETENTION_DAYS=30` |

## Bảng theo dõi tổng

Cập nhật cột Trạng thái tại đây và trong file sprint khi task đổi trạng thái.

| Sprint | TODO | IN_PROGRESS | IN_REVIEW | DONE | BLOCKED |
|---|---|---|---|---|---|
| S1 | 5 | 0 | 4 | 0 | 0 |
| S2 | 8 | 0 | 0 | 0 | 0 |
| S3 | 7 | 0 | 0 | 0 | 0 |
| S4 | 7 | 0 | 0 | 0 | 0 |
| S5 | 7 | 0 | 0 | 0 | 0 |
| S6 | 6 | 0 | 0 | 0 | 0 |
| S7 | 9 | 0 | 0 | 0 | 0 |

## Cách giao task cho subagent

Prompt chuẩn khi giao 1 task (copy, thay ID):

```
Bạn là agent BE của dự án Tâm Giao tại /Volumes/SSD 512/projects/tam-giao.
1. Đọc AGENTS.md, docs/ARCHITECTURE.md, docs/backlog/README.md.
2. Làm task <TASK-ID> trong docs/backlog/sprint-XX.md — chỉ trong phạm vi "Trong" và "File dự kiến".
3. Kiểm chứng theo AGENTS.md mục 8.
4. Cập nhật trạng thái task trong file sprint.
5. Kết thúc bằng báo cáo đúng format AGENTS.md mục 9.
```
