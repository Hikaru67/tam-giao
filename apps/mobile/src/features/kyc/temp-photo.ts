import { File } from 'expo-file-system';

/**
 * Thao tác file ảnh tạm do camera / image-manipulator tạo trong thư mục cache của app (luật F5): ảnh CCCD/selfie
 * không lưu vào thư viện ảnh, chỉ đọc để upload rồi xoá. Tách module riêng để test mock `expo-file-system`.
 */

/** Đọc bytes ảnh tạm để upload presigned. Lỗi đọc → ném ra (không upload dữ liệu thay thế). */
export async function readTempPhoto(uri: string): Promise<Uint8Array> {
  const file = new File(uri);
  return new Uint8Array(await file.arrayBuffer());
}

/** Xoá ảnh tạm khỏi máy. File đã không còn → bỏ qua. */
export function deleteTempPhoto(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) {
      file.delete();
    }
  } catch {
    // Không ném tiếp: xoá chạy trong `finally`/cleanup, ném ở đây sẽ che lỗi gốc của upload/nộp hồ sơ.
  }
}
