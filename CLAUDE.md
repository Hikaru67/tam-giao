@AGENTS.md

## Quy tắc điều phối của Claude (agent chính)

1. **Việc chạy song song được → subagent.** Khi có từ 2 task trở lên không phụ thuộc nhau (xét cột "Phụ thuộc" trong
   file sprint, không chỉ cột "Song song với"), giao mỗi task cho một subagent (Agent tool, `isolation: "worktree"`)
   chạy song song. Mỗi subagent tuân thủ AGENTS.md và trả báo cáo theo mục 9. Task phụ thuộc nhau thì làm tuần tự.
2. **Việc tay chân → agy.** Phần cơ học, phạm vi rõ (một adapter + test, repository/schema Drizzle theo mẫu có sẵn,
   fake, DTO boilerplate) giao cho CLI `agy`:
   - Chạy nền: `agy --mode accept-edits --print-timeout 900s -p "<prompt>"` (`-p` luôn là flag cuối).
   - Prompt ghi rõ **"KHÔNG chạy lệnh shell nào"**, liệt kê chính xác file được tạo/sửa, file mẫu cần đọc, port/contract phải hiện thực.
   - Định nghĩa port/interface/domain trước để agy code theo contract cố định. Trong lúc agy chạy, Claude làm phần khác.
3. **Claude review lại.** Mọi kết quả của subagent và agy phải được Claude đọc lại code, sửa chỗ sai/lệch luật
   (A1–A12, mục 5), tự chạy `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:int` rồi mới merge / báo DONE.
   Không tin báo cáo "đã xong" khi chưa kiểm chứng.
4. **Push:** chỉ push và mở PR khi mọi task của sprint đã merge vào nhánh sprint (AGENTS.md mục 10).
