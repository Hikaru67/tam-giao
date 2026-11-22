import * as SecureStore from 'expo-secure-store';
import { KYC_SLOTS, type KycDocumentKeys } from './types.js';

/**
 * Lưu key upload (định danh object trên storage, không phải ảnh hay PII) của lần nộp eKYC gần nhất vào
 * `expo-secure-store`, theo từng tài khoản. Khi chuyên viên yêu cầu bổ sung, app chỉ chụp lại ảnh được yêu cầu và
 * gửi lại key cũ cho các ảnh còn lại (BE yêu cầu đủ 4 key — `submitKycBodySchema`).
 */
function storageKey(userId: string): string {
  return `tg.kyc.docKeys.${userId}`;
}

function parseKeys(raw: string | null): KycDocumentKeys {
  if (raw === null) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null) return {};
  const keys: KycDocumentKeys = {};
  for (const slot of KYC_SLOTS) {
    const value: unknown = (parsed as Record<string, unknown>)[slot];
    if (typeof value === 'string' && value.length > 0) {
      keys[slot] = value;
    }
  }
  return keys;
}

export async function loadSubmittedKycKeys(userId: string): Promise<KycDocumentKeys> {
  return parseKeys(await SecureStore.getItemAsync(storageKey(userId)));
}

export async function saveSubmittedKycKeys(userId: string, keys: KycDocumentKeys): Promise<void> {
  await SecureStore.setItemAsync(storageKey(userId), JSON.stringify(keys));
}
