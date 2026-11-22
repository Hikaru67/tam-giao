/**
 * Nhãn thay cho phần liên hệ bị che (FE hiển thị nguyên văn). Không chứa chữ số để các bước che sau không khớp lại.
 */
export const CONTACT_MASK_LABELS = {
  EMAIL: '[email đã ẩn]',
  LINK: '[liên kết đã ẩn]',
  PHONE: '[SĐT đã ẩn]',
  NUMBER: '[dãy số đã ẩn]',
  SOCIAL: '[tài khoản MXH đã ẩn]',
} as const;

const L = '\\p{L}\\p{N}';
const TLDS = 'com|net|org|vn|me|ly|io|co|gl|gd|cc|gy|info|xyz|link|app|site|online|top|biz|id|to|tv';
const SOCIAL_PLATFORMS =
  'zalo|fb|facebook|ig|insta|instagram|tiktok|telegram|tele|tg|viber|skype|wechat|threads|twitter|messenger';

/** Thứ tự che: email → link → SĐT → dãy số dài → tài khoản MXH (sau tên nền tảng) → `@handle`. */
const MASK_STEPS: readonly (readonly [RegExp, string])[] = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/gu, CONTACT_MASK_LABELS.EMAIL],
  [new RegExp(`(?:https?:\\/\\/|www\\.)[^\\s]+`, 'giu'), CONTACT_MASK_LABELS.LINK],
  [
    new RegExp(
      `(?<![${L}.])[a-z0-9][a-z0-9-]*(?:\\.[a-z0-9-]+)*\\.(?:${TLDS})(?:\\.vn)?(?![${L}])(?:\\/[^\\s]*)?`,
      'giu',
    ),
    CONTACT_MASK_LABELS.LINK,
  ],
  // SĐT Việt Nam: 0 hoặc (+)84 rồi 9 chữ số, cho phép khoảng trắng/dấu chấm/gạch xen giữa ("0912 345 678").
  [/(?<![\p{N}])(?:\+ ?84|84|0)(?:[\s.-]{0,2}\p{N}){9}(?![\p{N}])/gu, CONTACT_MASK_LABELS.PHONE],
  // Dãy ≥ 9 chữ số còn lại (số tài khoản, SĐT viết lạ).
  [/(?<![\p{N}])\p{N}(?:[\s.-]{0,2}\p{N}){8,}(?![\p{N}])/gu, CONTACT_MASK_LABELS.NUMBER],
];

/** `zalo: abc`, `fb - ten.nguoi.dung`, `ig nguyen_van_a` (handle có số/dấu chấm/gạch dưới khi không có dấu ':'). */
const SOCIAL_WITH_SEPARATOR = new RegExp(
  `(?<![${L}])((?:${SOCIAL_PLATFORMS})\\s*[:：=-]\\s*)@?[${L}._-]+`,
  'giu',
);
const SOCIAL_HANDLE_LIKE = new RegExp(
  `(?<![${L}])((?:${SOCIAL_PLATFORMS})\\s+)@?(?=[${L}._-]*[\\p{N}._])[${L}._-]{3,}`,
  'giu',
);
const AT_HANDLE = new RegExp(`(?<![${L}._])@[A-Za-z0-9_.]{2,}`, 'gu');

/**
 * Domain service `ContactMasker` (BE-S6-03): che SĐT, email, link, tài khoản mạng xã hội trong bản hiển thị cho người
 * nhận. Hội thoại chỉ mở trong giai đoạn tìm hiểu (`DATING_DAYS`) nên mọi tin người dùng đều đi qua bước che.
 * Thuần, không log nội dung.
 */
export class ContactMasker {
  /** Trả bản đã che, hoặc `null` khi không có gì cần che. */
  mask(text: string): string | null {
    let out = text;
    for (const [pattern, label] of MASK_STEPS) out = out.replace(pattern, label);
    out = out
      .replace(SOCIAL_WITH_SEPARATOR, `$1${CONTACT_MASK_LABELS.SOCIAL}`)
      .replace(SOCIAL_HANDLE_LIKE, `$1${CONTACT_MASK_LABELS.SOCIAL}`)
      .replace(AT_HANDLE, CONTACT_MASK_LABELS.SOCIAL);
    return out === text ? null : out;
  }
}
