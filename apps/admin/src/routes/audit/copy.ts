import type { AuditLogEntry } from '@tamgiao/contracts/identity';
import type { AuditFilterField } from './audit-search';

export const AUDIT_COPY = {
  description:
    'Tra cứu ai đã xem hoặc thao tác dữ liệu nhạy cảm, phục vụ giám sát theo Nghị định 13/2023/NĐ-CP.',
  filterTitle: 'Bộ lọc nhật ký truy cập',
  loading: 'Đang tải nhật ký truy cập...',
  actorType: {
    label: 'Loại người thực hiện',
    all: 'Tất cả',
  },
  actorId: {
    label: 'Mã người thực hiện',
    placeholder: '0193a4f2-7c3e-7b1a-9f2d-3c4b5a6d7e01',
  },
  targetType: {
    label: 'Loại đối tượng',
    placeholder: 'vd: kyc_submission',
  },
  targetId: {
    label: 'Mã đối tượng',
    placeholder: 'vd: 0193a4f2-7c3e-7b1a-9f2d-3c4b5a6d7e99',
  },
  from: {
    label: 'Từ thời điểm',
  },
  to: {
    label: 'Đến thời điểm',
  },
  apply: 'Lọc',
  reset: 'Xoá bộ lọc',
  loadMore: 'Tải thêm',
  endOfList: 'Đã hiển thị toàn bộ bản ghi.',
  emptyTitle: 'Không có bản ghi nhật ký nào',
  emptyDescription: 'Chưa có thao tác nào hoặc không có bản ghi phù hợp với bộ lọc hiện tại.',
  columns: {
    occurredAt: 'Thời điểm',
    actor: 'Người thực hiện',
    action: 'Hành động',
    target: 'Đối tượng',
    ip: 'IP',
  },
  noIp: '—',
  actorTypeLabels: {
    admin: 'Quản trị viên',
    user: 'Người dùng',
    system: 'Hệ thống',
  } satisfies Record<AuditLogEntry['actor']['type'], string>,
  fieldErrors: {
    actorType: 'Loại người thực hiện không hợp lệ.',
    actorId: 'Mã người thực hiện phải là UUID hợp lệ.',
    targetType: 'Loại đối tượng tối đa 50 ký tự.',
    targetId: 'Mã đối tượng tối đa 100 ký tự.',
    from: 'Thời điểm bắt đầu không hợp lệ.',
    to: 'Thời điểm kết thúc không hợp lệ hoặc không sau thời điểm bắt đầu.',
  } satisfies Record<AuditFilterField, string>,
} as const;
