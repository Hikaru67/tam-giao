import { DATING_DAYS } from '@tamgiao/contracts/constants';

/**
 * Gợi ý phá băng theo ngày tìm hiểu (BE-S6-04, chip "Chủ đề sâu" ở màn chat). Danh sách tĩnh cấu hình trong code — đổi
 * nội dung thì sửa file này, không cần migration. Các chặng phủ kín 1…`DATING_DAYS`, không chồng lấn (có test).
 */
export interface IcebreakerStage {
  /** Ngày bắt đầu chặng (tính từ 1). */
  readonly fromDay: number;
  /** Ngày kết thúc chặng (bao gồm). */
  readonly toDay: number;
  /** Chủ đề của chặng (hiển thị làm tiêu đề nhóm gợi ý). */
  readonly theme: string;
  readonly topics: readonly string[];
}

export const ICEBREAKER_STAGES: readonly IcebreakerStage[] = [
  {
    fromDay: 1,
    toDay: 3,
    theme: 'Làm quen',
    topics: [
      'Một ngày cuối tuần lý tưởng của bạn trông như thế nào?',
      'Điều gì khiến bạn quyết định tìm một mối quan hệ nghiêm túc lúc này?',
      'Bạn thích món ăn quê nhà nào nhất, và có kỷ niệm gì gắn với nó?',
      'Công việc hiện tại có điều gì khiến bạn thấy tự hào?',
    ],
  },
  {
    fromDay: 4,
    toDay: 7,
    theme: 'Giá trị sống & gia đình',
    topics: [
      'Gia đình bạn thường quây quần vào dịp nào? Bạn giữ vai trò gì trong nhà?',
      'Ba điều bạn coi trọng nhất ở một người bạn đời là gì?',
      'Khi có mâu thuẫn, bạn thường cần thời gian một mình hay muốn nói chuyện ngay?',
      'Bạn học được điều gì quan trọng nhất từ cách bố mẹ đối xử với nhau?',
    ],
  },
  {
    fromDay: 8,
    toDay: 11,
    theme: 'Chủ đề sâu',
    topics: [
      'Bạn hình dung cuộc sống hôn nhân của mình sau 5 năm sẽ thế nào?',
      'Bạn nghĩ hai vợ chồng nên quản lý chi tiêu chung ra sao?',
      'Quan điểm của bạn về việc sống chung hay sống riêng với bố mẹ sau khi cưới?',
      'Bạn mong muốn có con khi nào, và bạn muốn nuôi dạy con theo cách nào?',
    ],
  },
  {
    fromDay: 12,
    toDay: DATING_DAYS,
    theme: 'Tương lai & gặp mặt',
    topics: [
      'Sau những ngày trò chuyện, điều gì ở mình khiến bạn bất ngờ nhất?',
      'Nếu gặp nhau lần đầu, bạn muốn chúng mình đi đâu?',
      'Có điều gì bạn muốn hỏi trực tiếp thay vì qua tin nhắn?',
      'Bạn cảm thấy thế nào về việc tiếp tục tìm hiểu nhau sau giai đoạn này?',
    ],
  },
];

/** Chặng gợi ý của ngày `day` (ngoài 1…`DATING_DAYS` bị kẹp về hai đầu). */
export function icebreakersForDay(day: number): IcebreakerStage {
  const clamped = Math.min(Math.max(Math.trunc(day), 1), DATING_DAYS);
  const stage = ICEBREAKER_STAGES.find((s) => clamped >= s.fromDay && clamped <= s.toDay);
  if (!stage) throw new Error(`ICEBREAKER_STAGES không phủ ngày ${clamped}`);
  return stage;
}
