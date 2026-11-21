/**
 * Cấu hình bộ lọc lừa đảo tài chính trong chat (BE-S6-03) — nguồn chân lý của luật, trọng số và ngưỡng.
 *
 * Mỗi luật có `id` (mã luật — đi vào `flag_reasons` / event `MessageFlagged`, không trích nội dung tin) và `weight`.
 * Điểm của một tin = tổng `weight` của các luật khớp (mỗi luật tính một lần). Điểm ≥ `FRAUD_FLAG_THRESHOLD` → gắn cờ.
 *
 * Luật so trên các góc nhìn đã chuẩn hoá (xem `buildScanViews`):
 * - `patterns`: regex trên `plain` và `leet` (đã bỏ dấu, chữ thường, token cách nhau một khoảng trắng) — viết có
 *   `\b` để không khớp nhầm giữa từ (`dau tu` ≠ `dau tuan`, `vay` ≠ `vay` trong "như vậy" vì luật vay cần ngữ cảnh).
 * - `compact`: chuỗi con trên `compact` (bỏ hết khoảng trắng) — chỉ cho từ khoá dài, đặc trưng, khó khớp nhầm.
 * - `raw`: regex trên `folded` (giữ dấu chấm/gạch chéo), dùng cho link rút gọn.
 *
 * Nguyên tắc chọn trọng số: một tín hiệu "nặng" đứng riêng (OTP) đủ gắn cờ; tín hiệu dễ xuất hiện trong chat bình
 * thường (tên ngân hàng, ví điện tử, "đầu tư", số tiền, "cho anh mượn"…) đứng riêng không đủ ngưỡng, phải kết hợp.
 */

export interface FraudRule {
  readonly id: string;
  readonly weight: number;
  readonly patterns?: readonly RegExp[];
  readonly compact?: readonly string[];
  readonly raw?: readonly RegExp[];
}

/** Ngưỡng gắn cờ: điểm ≥ ngưỡng → `flagged`, gửi cảnh báo cho người nhận, event `MessageFlagged`. */
export const FRAUD_FLAG_THRESHOLD = 5;

export const FRAUD_RULES: readonly FraudRule[] = [
  {
    id: 'OTP_REQUEST',
    weight: 5,
    patterns: [/\botp\b/, /\b(ma|so|day so) (xac nhan|xac thuc|kich hoat|bao mat)\b/],
    compact: ['maxacnhan', 'maxacthuc'],
  },
  {
    id: 'MONEY_TRANSFER',
    weight: 3,
    patterns: [
      /\bchuyen ?(khoan|tien|coc)\b/,
      /\bck (cho|giup|truoc|tien|qua|vao|ho)\b/,
      /\b(gui|bank) ?tien\b/,
      /\bnap (tien|usdt|coin|toi thieu|\d)/,
      /\bchuyen (lai|ho) (cho )?(anh|em|minh|toi)\b/,
      /\b(internet ?)?banking\b/,
    ],
    compact: ['chuyenkhoan', 'chuyentien'],
  },
  {
    id: 'BANK_ACCOUNT',
    weight: 3,
    patterns: [
      /\bstk\b/,
      /\bso ?(tai ?khoan|tk)\b/,
      /\b(tai ?khoan|tk) ngan ?hang\b/,
      /\bchu tai khoan\b/,
      /\b(vietcombank|vcb|techcombank|tcb|vietinbank|bidv|agribank|mb ?bank|acb|tpbank|vpbank|sacombank|shb|hdbank|ocb)\b/,
    ],
    compact: ['sotaikhoan', 'taikhoannganhang'],
  },
  {
    id: 'ACCOUNT_NUMBER',
    weight: 2,
    // Dãy 9–16 chữ số (cho phép cách nhau bằng khoảng trắng/dấu chấm/gạch trong tin gốc → token số liền nhau).
    patterns: [/(?<![0-9])[0-9](?: ?[0-9]){8,15}(?![0-9])/],
  },
  {
    id: 'E_WALLET',
    weight: 3,
    patterns: [/\b(momo|zalo ?pay|viettel ?money|shopee ?pay|vnpay|vi dien tu|paypal)\b/],
    compact: ['vidientu', 'zalopay'],
  },
  {
    id: 'FOREX',
    weight: 4,
    patterns: [
      /\b(forex|ngoai hoi|fx)\b/,
      /\bsan (giao dich|forex|ngoai hoi|vang|coin|crypto)\b/,
      /\b(giao dich|choi|danh) (vang|ngoai te|phai sinh)\b/,
      /\bmt[45]\b/,
    ],
    compact: ['ngoaihoi', 'sangiaodich'],
  },
  {
    id: 'CRYPTO',
    weight: 4,
    patterns: [
      /\b(crypto|bitcoin|btc|usdt|eth|ethereum|binance|okx|bybit|blockchain|altcoin|coin)\b/,
      /\b(tien ao|tien dien tu|tien ma hoa|dao coin|danh coin)\b/,
    ],
    compact: ['bitcoin', 'binance', 'tienmahoa', 'crypto'],
  },
  {
    id: 'INVESTMENT',
    weight: 3,
    patterns: [
      /\bdau ?tu\b/,
      /\b(loi nhuan|lai suat|hoan von|sinh loi|kiem loi|thu nhap thu dong|vao lenh)\b/,
      /\b(an|nhan|huong) hoa hong\b/,
      /\bhoa hong \d/,
      /\blai \d+(%| phan tram)/,
      /\b(x2|x3|x5|x10) (tai khoan|von|tien)\b/,
      /\bgap (doi|ba|\d+ lan)\b/,
      /\bnhan (lai|ve) \d/,
      /\b(cam ket|dam bao) (loi|lai|thang)\b/,
    ],
    compact: ['loinhuan'],
  },
  {
    id: 'LOAN',
    weight: 4,
    patterns: [
      /\b(cho vay|khoan vay|app vay|giai ngan)\b/,
      /\bvay (tien|von|nong|gap|online|tin chap)\b/,
      /\bmuon (tam |giup |ho )?(em |anh |minh )?(\d|tien|it tien)/,
      /\bcho (anh|em|minh|toi) muon\b/,
      /\b(ket tien|can tien gap|ung truoc)\b/,
    ],
  },
  {
    id: 'MONEY_MULE',
    weight: 3,
    patterns: [/\bdung ten\b/, /\bnhan (tien )?(giup|ho)\b/, /\b(cho muon|thue|mua) tai khoan\b/],
  },
  {
    id: 'TASK_SCAM',
    weight: 4,
    patterns: [
      /\b(lam nhiem vu|nhiem vu (online|tuong tac)|kiem tien online|viec nhe luong cao|tha tim)\b/,
      /\bcong tac vien online\b/,
    ],
  },
  {
    id: 'GAMBLING',
    weight: 4,
    patterns: [/\b(ca cuoc|nha cai|tai xiu|casino|lo de|danh de|xoc dia|baccarat)\b/],
  },
  {
    id: 'PARCEL_FEE',
    weight: 4,
    patterns: [
      /\bphi (hai quan|thong quan|van chuyen quoc te|nhan hang|bao hiem kien hang)\b/,
      /\bkien hang bi giu\b/,
    ],
  },
  {
    id: 'PRIZE',
    weight: 3,
    patterns: [/\b(nhan qua|trung thuong|qua tang mien phi|nhan thuong)\b/],
  },
  {
    id: 'SHORT_LINK',
    weight: 3,
    raw: [
      /\b(bit\.ly|tinyurl\.com|goo\.gl|cutt\.ly|shorturl\.at|rebrand\.ly|is\.gd|t\.co|s\.id|tiny\.cc|rb\.gy)\//,
    ],
    patterns: [/\b(bit ly|tinyurl|cutt ly|shorturl|rebrand ly)\b/],
  },
  {
    id: 'APP_INSTALL',
    weight: 2,
    patterns: [/\b(tai|cai|down) (app|ung dung)\b/],
  },
  {
    id: 'MONEY_AMOUNT',
    weight: 1,
    patterns: [/\b\d+(?: \d+)? ?(k|tr|trieu|cu|ty|nghin|ngan|usd|do la|dola)\b/, /\$ ?\d|\d ?\$/],
  },
  {
    id: 'PRESSURE_SECRECY',
    weight: 1,
    patterns: [/\b(khan cap|ngay lap tuc|giu bi mat|dung (noi|ke) (voi|cho) ai)\b/],
  },
];
