# Mẫu task BE (copy khi tạo task mới)

Mọi task trong `sprint-XX.md` phải theo đúng format này để subagent đọc thống nhất.
ID: `BE-S<sprint>-<số thứ tự 2 chữ số>`. Ước lượng tính theo ngày công (d).

```markdown
### BE-S0-00 · <Tiêu đề ngắn, bắt đầu bằng động từ>

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| matching | domain, application | P0 | 2d | BE-S1-03 | BE-S5-03 | TODO |

**Mục tiêu:** <1–2 câu: vì sao cần task này, phục vụ màn hình / luồng nào>

**Phạm vi**
- Trong: <những gì phải làm>
- Ngoài: <những gì KHÔNG làm trong task này (thường là task khác)>

**Tiêu chí nghiệm thu**
- [ ] AC1: Given … When … Then …
- [ ] AC2: …

**Test bắt buộc:** <loại test + case quan trọng phải có>

**File dự kiến:** <đường dẫn file/thư mục được phép tạo/sửa — vùng sở hữu của task>

**Contract / Event:** <DTO, mã lỗi, event, migration sẽ thêm — hoặc "Không có">

**Ghi chú:** <rủi ro, gợi ý kỹ thuật, quyết định còn mở liên quan (D1…D6)>
```

Quy ước:
- **Ưu tiên:** P0 = bắt buộc cho MVP · P1 = nên có trong sprint · P2 = làm nếu dư thời gian.
- **Lớp:** domain · application · infrastructure · presentation · devops.
- **Trạng thái:** TODO · IN_PROGRESS · IN_REVIEW · DONE · BLOCKED (kèm lý do ngay dưới bảng).
