import type { ApiClient } from '@tamgiao/api-client';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { readLocalFile } from './local-file.js';

const MAX_IMAGE_SIDE = 1600;
const JPEG_COMPRESSION = 0.8;

export interface PickedImageResult {
  uri: string;
  width?: number | undefined;
  height?: number | undefined;
}

export interface UploadedPhotoResult {
  key: string;
  uri: string;
}

/**
 * Mở thư viện để người dùng chọn một ảnh.
 * Trả về thông tin ảnh đã chọn hoặc null nếu người dùng huỷ.
 */
export async function pickImageFromLibrary(): Promise<PickedImageResult | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    throw new Error('PERMISSION_DENIED');
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: false,
    quality: 1,
  });

  if (result.canceled || !result.assets || result.assets.length === 0) {
    return null;
  }

  const asset = result.assets[0];
  if (!asset?.uri) {
    return null;
  }

  return {
    uri: asset.uri,
    width: asset.width,
    height: asset.height,
  };
}

/**
 * Mở máy ảnh để người dùng chụp ảnh mới.
 * Trả về thông tin ảnh đã chụp hoặc null nếu người dùng huỷ.
 */
export async function takePhotoWithCamera(): Promise<PickedImageResult | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) {
    throw new Error('PERMISSION_DENIED');
  }

  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    allowsEditing: false,
    quality: 1,
  });

  if (result.canceled || !result.assets || result.assets.length === 0) {
    return null;
  }

  const asset = result.assets[0];
  if (!asset?.uri) {
    return null;
  }

  return {
    uri: asset.uri,
    width: asset.width,
    height: asset.height,
  };
}

/**
 * Xử lý nén, chỉnh kích thước (cạnh dài ≤ 1600px, JPEG 0.8) và tải ảnh lên qua presigned URL.
 * Đọc file local qua fetch(uri).blob() theo quy định đặc cách.
 */
export async function processAndUploadPhoto(
  image: PickedImageResult,
  client: ApiClient,
): Promise<UploadedPhotoResult> {
  const actions: ImageManipulator.Action[] = [];

  const { width, height } = image;
  if (width && height) {
    if (width >= height && width > MAX_IMAGE_SIDE) {
      actions.push({ resize: { width: MAX_IMAGE_SIDE } });
    } else if (height > width && height > MAX_IMAGE_SIDE) {
      actions.push({ resize: { height: MAX_IMAGE_SIDE } });
    }
  } else {
    actions.push({ resize: { width: MAX_IMAGE_SIDE } });
  }

  const manipulated = await ImageManipulator.manipulateAsync(image.uri, actions, {
    compress: JPEG_COMPRESSION,
    format: ImageManipulator.SaveFormat.JPEG,
  });

  // Đọc lỗi → ném ra để ảnh được đánh dấu `failed` và người dùng thử lại (không upload dữ liệu thay thế).
  const blob = await readLocalFile(manipulated.uri);

  const uploadResult = await client.upload({
    purpose: 'profile_photo',
    contentType: 'image/jpeg',
    body: blob,
    sizeBytes: blob.size,
  });

  return {
    key: uploadResult.key,
    uri: manipulated.uri,
  };
}
