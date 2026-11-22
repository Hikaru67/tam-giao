/**
 * Đọc bytes của file ảnh local (URI `file://` do image-picker/manipulator trả) — ngoại lệ được phép của luật F1:
 * không gọi API, chỉ đọc file trên máy. Tách module riêng để test mock, không cài nhánh dự phòng trong code chính.
 */
export async function readLocalFile(uri: string): Promise<Blob> {
  const response = await fetch(uri);
  return response.blob();
}
