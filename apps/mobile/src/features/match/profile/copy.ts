export const MATCH_PROFILE_COPY = {
  header: {
    title: 'Chi tiết hồ sơ',
    back: 'Quay lại',
    backIcon: '←',
  },
  loading: 'Đang tải hồ sơ...',
  genericError: 'Có lỗi xảy ra. Vui lòng thử lại sau.',
  noMatch: {
    title: 'Không có ghép đôi đang mở',
    description: 'Bạn hiện không có gợi ý ghép đôi nào đang hoạt động.',
    cta: 'Về trang chính',
  },
  sections: {
    intro: 'Giới thiệu',
    interests: 'Sở thích',
    careerEducation: 'Công việc & học vấn',
  },
  gender: {
    male: 'Nam',
    female: 'Nữ',
  } satisfies Record<'male' | 'female', string>,
  nameAge: (name: string, age: number) => `${name}, ${age}`,
  quoteBio: (bio: string) => `"${bio}"`,
  photoLabel: (displayName: string, index: number, total: number) =>
    `Ảnh ${index}/${total} của ${displayName}`,
  photoCounter: (index: number, total: number) => `${index}/${total}`,
  noPhoto: 'Chưa có ảnh hồ sơ',
  emptyBio: 'Chưa có lời tự bạch',
  emptyInterests: 'Chưa chia sẻ sở thích',
  private: {
    title: 'Thông tin riêng tư',
    badge: 'Chưa mở',
    body: 'Phần thông tin riêng tư chưa được mở ở giai đoạn này.',
  },
} as const;
