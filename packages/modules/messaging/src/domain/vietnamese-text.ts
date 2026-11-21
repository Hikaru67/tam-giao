/**
 * Chuẩn hoá văn bản tiếng Việt cho bộ lọc lừa đảo (BE-S6-03). Hàm thuần — không giữ, không log nội dung.
 */

/** Bỏ dấu tiếng Việt (`đ` → `d`), gộp ký tự toàn chiều rộng (NFKC), chữ thường. */
export function foldVietnamese(text: string): string {
  return text
    .normalize('NFKC')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase();
}

/** Ký tự leetspeak → chữ cái, chỉ áp dụng trong token có cả chữ lẫn ký tự thay thế (`b1tc0in`, `z@lo`, `ch0`). */
const LEET_MAP: Readonly<Record<string, string>> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '8': 'b',
  '@': 'a',
  $: 's',
};

/**
 * Các "góc nhìn" của cùng một tin để so luật:
 * - `folded`: bỏ dấu + chữ thường, giữ nguyên ký tự đặc biệt (luật cần dấu chấm/gạch chéo như `bit.ly/…`).
 * - `plain`: token chữ/số (ký tự khác → khoảng trắng); chuỗi ≥ 2 token một ký tự liền nhau được nối lại
 *   (`c h u y e n` / `s.t.k` → `chuyen` / `stk`) — chống lách bằng khoảng trắng/ký tự đặc biệt. Giữ chữ số (số tiền, STK).
 * - `leet`: như `plain` nhưng token lẫn chữ và số/ký hiệu được đổi leetspeak (`f0rex` → `forex`).
 * - `compact`: `leet` bỏ hết khoảng trắng — chỉ dùng cho từ khoá dài, đặc trưng (`chu.yen khoan` → `chuyenkhoan`).
 */
export interface ScanViews {
  readonly folded: string;
  readonly plain: string;
  readonly leet: string;
  readonly compact: string;
}

/**
 * Từ có dấu mà khi bỏ dấu trùng với từ khoá lừa đảo, rất hay gặp trong chat thường — đổi sang dạng không trùng trước
 * khi bỏ dấu ("như vậy tiền…" ≠ "vay tiền"). Tin viết không dấu thì vẫn coi là từ khoá.
 */
const DIACRITIC_DISAMBIGUATION: readonly (readonly [RegExp, string])[] = [
  [/(?<!\p{L})vậy(?!\p{L})/gu, 'vayy'],
];

export function buildScanViews(text: string): ScanViews {
  let lowered = text.normalize('NFC').toLowerCase();
  for (const [pattern, replacement] of DIACRITIC_DISAMBIGUATION)
    lowered = lowered.replace(pattern, replacement);
  const folded = foldVietnamese(lowered);
  const tokens = mergeSingleCharRuns(folded.split(/[^a-z0-9%$@]+/).filter((t) => t.length > 0));
  const leetTokens = tokens.map(deLeet);
  return {
    folded,
    plain: tokens.join(' '),
    leet: leetTokens.join(' '),
    compact: leetTokens.join(''),
  };
}

function mergeSingleCharRuns(tokens: readonly string[]): string[] {
  const out: string[] = [];
  let run: string[] = [];
  const flush = (): void => {
    if (run.length >= 2) out.push(run.join(''));
    else out.push(...run);
    run = [];
  };
  for (const token of tokens) {
    if (token.length === 1) {
      run.push(token);
    } else {
      flush();
      out.push(token);
    }
  }
  flush();
  return out;
}

function deLeet(token: string): string {
  if (!/[a-z]/.test(token) || !/[0-9@$]/.test(token)) return token;
  return token.replace(/[0-9@$]/g, (ch) => LEET_MAP[ch] ?? ch);
}
