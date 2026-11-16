# @tamgiao/contracts

Hợp đồng dùng chung giữa backend và frontend (mobile, admin, partner). **Không import gì từ backend.**

| Subpath | Nội dung | Ai được dùng |
|---|---|---|
| `@tamgiao/contracts/constants` | Hằng số nghiệp vụ (thuần TS, không Zod) | Mọi nơi, kể cả domain/application |
| `@tamgiao/contracts/errors` | Registry mã lỗi + HTTP status | presentation, FE |
| `@tamgiao/contracts/http` | Problem JSON, phân trang cursor (Zod) | presentation, FE |
| `@tamgiao/contracts` | Tất cả ở trên | presentation, FE |

## Quy ước thư mục theo module

Mỗi module nghiệp vụ thêm thư mục riêng khi có contract đầu tiên (không tạo thư mục rỗng trước):

```
src/<module>/
  dto.ts        # Zod schema request/response + type suy ra (z.infer)
  errors.ts     # registerErrors('<module>', { ... })
  events.ts     # type payload của domain event phát ra ngoài module
  index.ts      # re-export, đồng thời được export ở src/index.ts
```

- Chỉ **thêm** DTO / mã lỗi / event mới; không sửa hay xoá cái đã có mà không có task riêng (AGENTS.md mục 7).
- Đăng ký trùng mã lỗi sẽ throw khi nạp module → test fail ngay.
