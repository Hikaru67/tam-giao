/**
 * Văn bản hiển thị tiếng Việt cho màn hình Thiết lập tiêu chuẩn bạn đời (FE-S2-04).
 * Tuân thủ quy ước: F6 (văn bản đặt trong file copy), F4 (không PII), FE-D5 (không nhắc VNeID, Bộ Công An, ký quỹ, bảo chứng 100%).
 */
export const PREFERENCES_COPY = {
  header: {
    back: 'Quay lại',
    title: 'Thiết Lập Tiêu Chuẩn Bạn Đời',
    saveChanges: 'Lưu thay đổi',
  },
  progress: {
    stepBadge: 'Bước 2/3',
    stepTitle: 'Tiêu chuẩn bạn đời',
    steps: {
      profile: '1. Hồ sơ cơ bản',
      preferences: '2. Tiêu chuẩn bạn đời',
      verification: '3. Xác thực eKYC',
    },
  },
  philosophyBanner: {
    title: 'Nguyên tắc bất biến',
    content:
      'Tâm Giao cam kết chỉ gửi hồ sơ đáp ứng 100% các tiêu chuẩn tiên quyết của bạn. Mọi sự ghép đôi đều dựa trên sự tôn trọng và chân thành.',
  },
  dealBreakers: {
    title: 'Bộ lọc cứng (Không thỏa hiệp)',
    badge: 'Bắt buộc',
    age: {
      title: 'Độ tuổi mong muốn',
      subtitle: 'Khoảng cách tuổi tác phù hợp với sự đồng điệu tâm lý & định hướng tương lai.',
      minLabel: 'Tuổi tối thiểu',
      maxLabel: 'Tuổi tối đa',
      unit: 'tuổi',
      decreaseMinA11y: 'Giảm tuổi tối thiểu',
      increaseMinA11y: 'Tăng tuổi tối thiểu',
      decreaseMaxA11y: 'Giảm tuổi tối đa',
      increaseMaxA11y: 'Tăng tuổi tối đa',
      rangeDisplay: (min: number, max: number) => `${min} – ${max} tuổi`,
    },
    area: {
      title: 'Khu vực sinh sống',
      radiusTitle: 'Bán kính tìm kiếm',
      cityTitle: 'Tỉnh/thành phố mong muốn',
      cityPlaceholder: 'Nhập hoặc chọn tỉnh/thành...',
      cities: {
        all: 'Toàn quốc',
        hcm: 'TP. Hồ Chí Minh',
        hanoi: 'Hà Nội',
        danang: 'Đà Nẵng',
      },
      radii: {
        all: 'Cả tỉnh/thành',
        km20: 'Bán kính 20km',
        km50: 'Bán kính 50km',
        km100: 'Bán kính 100km',
      },
    },
    childrenPlan: {
      title: 'Kế hoạch con cái',
      options: {
        want_children: 'Muốn có con trong tương lai',
        no_children: 'Không muốn có con',
        open: 'Tùy duyên / Thảo luận sau',
        not_important: 'Không quan trọng',
      },
    },
    religion: {
      title: 'Tôn giáo & Tín ngưỡng',
      options: {
        not_important: 'Không phân biệt',
        none: 'Không tôn giáo',
        buddhism: 'Phật giáo',
        catholicism: 'Công giáo',
        protestantism: 'Tin Lành',
        caodaism: 'Cao Đài',
        hoa_hao: 'Hòa Hảo',
        other: 'Khác',
      },
    },
    lifestyle: {
      title: 'Lối sống & Thói quen thường nhật',
      smoking: {
        title: 'Thói quen hút thuốc',
        options: {
          never: 'Tuyệt đối không hút (kể cả vape)',
          occasionally: 'Thỉnh thoảng xã giao',
          regularly: 'Thường xuyên',
          not_important: 'Không quan trọng',
        },
      },
      drinking: {
        title: 'Uống rượu bia',
        options: {
          never: 'Hoàn toàn không uống',
          occasionally: 'Chỉ uống xã giao / có chừng mực',
          regularly: 'Thường xuyên',
          not_important: 'Không quan trọng',
        },
      },
      dailyRhythm: {
        title: 'Nhịp sinh hoạt',
        options: {
          early_bird: 'Dậy sớm ngủ sớm',
          night_owl: 'Cú đêm',
          flexible: 'Linh hoạt theo công việc',
          not_important: 'Không quan trọng',
        },
      },
      sports: {
        title: 'Thể thao & Vận động',
        options: {
          regularly: 'Tập luyện thường xuyên',
          sometimes: 'Vận động nhẹ / Cuối tuần',
          rarely: 'Hiếm khi vận động',
          not_important: 'Không quan trọng',
        },
      },
    },
  },
  educationAndBackground: {
    title: 'Tiêu chuẩn học vấn & Nền tảng',
    minEducation: {
      title: 'Trình độ học vấn tối thiểu',
      subtitle: 'Đảm bảo sự tương đồng về vốn sống, thế giới quan và khả năng thấu hiểu chiều sâu.',
      options: {
        none: 'Không yêu cầu',
        high_school: 'Tốt nghiệp THPT',
        college: 'Cao đẳng',
        bachelor: 'Tốt nghiệp Đại học',
        master: 'Thạc sĩ',
        doctorate: 'Tiến sĩ',
      },
    },
    financialIndependence: {
      title: 'Mức độ độc lập tài chính',
      subtitle:
        'Cùng có trách nhiệm tài chính độc lập, sẵn sàng xây dựng kế hoạch tương lai dài hạn ổn định cho tổ ấm.',
      options: {
        preferred: 'Ưu tiên độc lập tài chính',
        required: 'Bắt buộc độc lập tài chính',
        not_important: 'Không quan trọng',
      },
    },
  },
  coreTraits: {
    title: '3 Phẩm chất cốt lõi ưu tiên',
    counter: (count: number, max: number) => `${count}/${max} đã chọn`,
    subtitle: 'Chọn đúng 3 giá trị tinh thần bạn trân quý nhất ở người bạn đời đồng hành:',
    requiredNotice: 'Vui lòng chọn đúng 3 phẩm chất cốt lõi.',
    options: {
      honest: 'Chân thành',
      kind: 'Tử tế',
      responsible: 'Có trách nhiệm gia đình',
      ambitious: 'Chí tiến thủ',
      family_oriented: 'Hướng về gia đình',
      humorous: 'Hài hước',
      patient: 'Kiên nhẫn',
      independent: 'Tự lập',
      loyal: 'Chung thủy',
      respectful: 'Biết lắng nghe & tôn trọng',
      generous: 'Rộng lượng',
      optimistic: 'Lạc quan',
    },
  },
  mutualAssurance: {
    title: 'Đối soát hai chiều công bằng',
    content:
      'Tâm Giao đối soát hai chiều: Người ấy cũng phải có tiêu chí tương thích với hồ sơ của bạn. Cả hai chỉ được kết nối khi có sự đồng thuận nguyên tắc đôi bên.',
  },
  submit: {
    hint: 'Hệ thống sẽ gợi ý ngay hồ sơ bí mật tương thích cao đang chờ bạn sau bước này',
    button: 'Lưu tiêu chí & Quét hồ sơ tương hợp',
    subtitle: 'Thuật toán tìm kiếm hồ sơ độc thân đã xác thực khớp 100% bộ lọc của bạn',
    securityNotice: 'Dữ liệu được mã hóa & bảo mật theo tiêu chuẩn Tâm Giao',
  },
  validation: {
    ageMinGreaterThanMax: 'Tuổi tối thiểu không được lớn hơn tuổi tối đa',
    ageOutOfRange: (min: number, max: number) => `Độ tuổi phải nằm trong khoảng từ ${min} đến ${max}`,
    coreTraitsCount: 'Cần chọn đúng 3 phẩm chất cốt lõi',
  },
  loading: 'Đang tải tiêu chí bạn đời...',
  error: {
    title: 'Không thể tải tiêu chí bạn đời',
    retry: 'Thử lại',
  },
} as const;
