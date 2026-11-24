import type { ApiClient } from '@tamgiao/api-client';
import * as ImageManipulator from 'expo-image-manipulator';
import { deleteTempPhoto } from '../kyc/temp-photo.js';
import { pickImageFromLibrary, type PickedImageResult } from '../profile/image-service.js';
import { readLocalFile } from '../profile/local-file.js';

export const MAX_EVIDENCE_SIDE = 1600;
export const EVIDENCE_JPEG_COMPRESSION = 0.8;

export { pickImageFromLibrary, type PickedImageResult };

/**
 * Xoá bản sao ảnh mà image-picker tạo trong cache của app. Chỉ xoá file trong thư mục `ImagePicker` — không đụng tới ảnh
 * gốc trong thư viện.
 */
export function deletePickedCopy(uri: string): void {
  if (uri.includes('/ImagePicker/')) deleteTempPhoto(uri);
}

export interface ProcessAndUploadEvidenceResult {
  key: string;
}

export async function processAndUploadEvidence(
  image: PickedImageResult,
  client: ApiClient,
): Promise<ProcessAndUploadEvidenceResult> {
  const actions: ImageManipulator.Action[] = [];
  const { width, height } = image;
  if (width && height) {
    if (width >= height && width > MAX_EVIDENCE_SIDE) {
      actions.push({ resize: { width: MAX_EVIDENCE_SIDE } });
    } else if (height > width && height > MAX_EVIDENCE_SIDE) {
      actions.push({ resize: { height: MAX_EVIDENCE_SIDE } });
    }
  } else {
    actions.push({ resize: { width: MAX_EVIDENCE_SIDE } });
  }

  const manipulated = await ImageManipulator.manipulateAsync(image.uri, actions, {
    compress: EVIDENCE_JPEG_COMPRESSION,
    format: ImageManipulator.SaveFormat.JPEG,
  });

  try {
    const blob = await readLocalFile(manipulated.uri);
    const result = await client.upload({
      purpose: 'report_evidence',
      contentType: 'image/jpeg',
      body: blob,
      sizeBytes: blob.size,
    });
    return { key: result.key };
  } finally {
    deleteTempPhoto(manipulated.uri);
  }
}
