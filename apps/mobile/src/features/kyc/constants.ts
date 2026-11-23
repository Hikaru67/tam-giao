/**
 * Cấu hình ảnh chụp eKYC (FE-S3-02).
 * Giới hạn upload của BE là 10MB; nén JPEG 0.85 và cạnh dài tối đa 2000px đảm bảo chất lượng đọc OCR/thẩm định
 * trong khi dung lượng ảnh luôn dưới 2MB.
 */
export const KYC_MAX_IMAGE_SIDE = 2000;
export const KYC_JPEG_COMPRESSION = 0.85;
