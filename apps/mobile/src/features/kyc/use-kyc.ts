import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isApiError, messageFor } from '@tamgiao/api-client';
import { useApiClient } from '@tamgiao/api-client/react';
import {
  kycProgressResponseSchema,
  type KycProgressResponse,
  type SubmitKycBody,
} from '@tamgiao/contracts/verification';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { KYC_COPY } from './copy.js';
import { loadSubmittedKycKeys, saveSubmittedKycKeys } from './submitted-keys-store.js';
import { deleteTempPhoto, readTempPhoto } from './temp-photo.js';
import { KYC_SLOT_CONFIG, KYC_SLOTS, type KycDocumentKeys, type KycSlot } from './types.js';

export const KYC_QUERY_KEY = ['kyc'] as const;

export function useKycProgress(): UseQueryResult<KycProgressResponse, Error> {
  const client = useApiClient();

  return useQuery({
    queryKey: KYC_QUERY_KEY,
    queryFn: () => client.get('/me/kyc', { schema: kycProgressResponseSchema }),
  });
}

export type SubmittedKycKeysState = { status: 'loading' } | { status: 'ready'; keys: KycDocumentKeys };

/**
 * Đọc key upload của lần nộp gần nhất (SecureStore) theo tài khoản. Chỉ trả `ready` khi keys đã đọc xong cho đúng
 * `userId` hiện tại, để form khởi tạo state một lần với dữ liệu đúng.
 */
export function useSubmittedKycKeys(userId: string | undefined): SubmittedKycKeysState {
  const [loaded, setLoaded] = useState<{ userId: string; keys: KycDocumentKeys } | null>(null);

  useEffect(() => {
    if (!userId) return;
    let isMounted = true;
    loadSubmittedKycKeys(userId)
      .then((keys) => {
        if (isMounted) setLoaded({ userId, keys });
      })
      .catch(() => {
        // Không đọc được SecureStore → coi như không có key cũ: người dùng chụp lại đủ ảnh.
        if (isMounted) setLoaded({ userId, keys: {} });
      });
    return () => {
      isMounted = false;
    };
  }, [userId]);

  return loaded !== null && loaded.userId === userId
    ? { status: 'ready', keys: loaded.keys }
    : { status: 'loading' };
}

export type KycSlotState =
  | { status: 'empty' }
  | { status: 'uploading' }
  | { status: 'uploaded'; key: string; source: 'new' | 'previous' }
  | { status: 'failed'; message: string };

export interface UseKycDocumentsOptions {
  /** Slot buộc phải chụp mới. Lần nộp đầu: cả 4. Nộp bổ sung: slot được yêu cầu + slot không có key cũ. */
  requiredSlots: readonly KycSlot[];
  /** Key cũ dùng lại cho slot không bắt buộc chụp mới. */
  previousKeys: KycDocumentKeys;
}

export interface UseKycDocumentsResult {
  slots: Record<KycSlot, KycSlotState>;
  requiredSlots: readonly KycSlot[];
  /** Theo dõi ảnh tạm vừa tạo (ảnh resize) để chắc chắn được xoá khi unmount. */
  trackTempPhoto: (uri: string) => void;
  /** Xoá + bỏ theo dõi ảnh tạm (chụp lại / huỷ). */
  discardTempPhoto: (uri: string) => void;
  /** Đọc bytes (readTempPhoto) → client.upload → slot 'uploaded' (source 'new'); lỗi → 'failed' với message (messageFor(err).title nếu isApiError, ngược lại KYC_COPY.genericError). LUÔN xoá + bỏ theo dõi file trong finally. */
  uploadPhoto: (slot: KycSlot, uri: string) => Promise<void>;
  /** Đưa slot về 'empty' và thêm vào requiredSlots (BE báo key thiếu/không hợp lệ). */
  resetSlot: (slot: KycSlot) => void;
  /** Đủ 4 slot 'uploaded' và mọi slot trong requiredSlots có source 'new'. */
  canSubmit: boolean;
  /** Body POST /me/kyc khi canSubmit, ngược lại null. */
  documentKeys: SubmitKycBody | null;
}

export function useKycDocuments(options: UseKycDocumentsOptions): UseKycDocumentsResult {
  const client = useApiClient();

  const [requiredSlots, setRequiredSlots] = useState<readonly KycSlot[]>(() => {
    const list = new Set<KycSlot>(options.requiredSlots);
    for (const slot of KYC_SLOTS) {
      if (!list.has(slot) && !options.previousKeys[slot]) {
        list.add(slot);
      }
    }
    return Array.from(list);
  });

  const [slots, setSlots] = useState<Record<KycSlot, KycSlotState>>(() => {
    const initialFor = (slot: KycSlot): KycSlotState => {
      const prevKey = options.previousKeys[slot];
      return !options.requiredSlots.includes(slot) && prevKey
        ? { status: 'uploaded', key: prevKey, source: 'previous' }
        : { status: 'empty' };
    };
    return {
      CCCD_FRONT: initialFor('CCCD_FRONT'),
      CCCD_BACK: initialFor('CCCD_BACK'),
      SELFIE: initialFor('SELFIE'),
      MARITAL_STATUS_CERTIFICATE: initialFor('MARITAL_STATUS_CERTIFICATE'),
    };
  });

  const trackedUris = useRef<Set<string>>(new Set());
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      for (const uri of trackedUris.current) {
        deleteTempPhoto(uri);
      }
      trackedUris.current.clear();
    };
  }, []);

  const trackTempPhoto = useCallback((uri: string) => {
    trackedUris.current.add(uri);
  }, []);

  const discardTempPhoto = useCallback((uri: string) => {
    trackedUris.current.delete(uri);
    deleteTempPhoto(uri);
  }, []);

  const uploadPhoto = useCallback(
    async (slot: KycSlot, uri: string) => {
      if (isMountedRef.current) {
        setSlots((prev) => ({ ...prev, [slot]: { status: 'uploading' } }));
      }
      try {
        const bytes = await readTempPhoto(uri);
        const { key } = await client.upload({
          purpose: KYC_SLOT_CONFIG[slot].purpose,
          contentType: 'image/jpeg',
          body: bytes,
          sizeBytes: bytes.byteLength,
        });
        if (isMountedRef.current) {
          setSlots((prev) => ({
            ...prev,
            [slot]: { status: 'uploaded', key, source: 'new' },
          }));
        }
      } catch (err) {
        if (isMountedRef.current) {
          const message = isApiError(err) ? messageFor(err).title : KYC_COPY.genericError;
          setSlots((prev) => ({
            ...prev,
            [slot]: { status: 'failed', message },
          }));
        }
      } finally {
        trackedUris.current.delete(uri);
        deleteTempPhoto(uri);
      }
    },
    [client],
  );

  const resetSlot = useCallback((slot: KycSlot) => {
    if (!isMountedRef.current) return;
    setSlots((prev) => ({ ...prev, [slot]: { status: 'empty' } }));
    setRequiredSlots((prev) => (prev.includes(slot) ? prev : [...prev, slot]));
  }, []);

  const canSubmit = useMemo(() => {
    return KYC_SLOTS.every((slot) => {
      const s = slots[slot];
      if (s.status !== 'uploaded') return false;
      if (requiredSlots.includes(slot)) {
        return s.source === 'new';
      }
      return true;
    });
  }, [slots, requiredSlots]);

  const documentKeys = useMemo<SubmitKycBody | null>(() => {
    if (!canSubmit) return null;
    const cccdFront = slots.CCCD_FRONT;
    const cccdBack = slots.CCCD_BACK;
    const selfie = slots.SELFIE;
    const maritalStatus = slots.MARITAL_STATUS_CERTIFICATE;
    if (
      cccdFront.status !== 'uploaded' ||
      cccdBack.status !== 'uploaded' ||
      selfie.status !== 'uploaded' ||
      maritalStatus.status !== 'uploaded'
    ) {
      return null;
    }
    return {
      cccdFrontKey: cccdFront.key,
      cccdBackKey: cccdBack.key,
      selfieKey: selfie.key,
      maritalStatusCertificateKey: maritalStatus.key,
    };
  }, [canSubmit, slots]);

  return {
    slots,
    requiredSlots,
    trackTempPhoto,
    discardTempPhoto,
    uploadPhoto,
    resetSlot,
    canSubmit,
    documentKeys,
  };
}

export function useSubmitKyc(userId: string): UseMutationResult<KycProgressResponse, Error, SubmitKycBody> {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: SubmitKycBody) =>
      client.post('/me/kyc', {
        body,
        schema: kycProgressResponseSchema,
      }),
    onSuccess: async (_data, body) => {
      const keysBySlot: KycDocumentKeys = {};
      for (const slot of KYC_SLOTS) {
        const field = KYC_SLOT_CONFIG[slot].field;
        const key = body[field];
        if (typeof key === 'string' && key.length > 0) {
          keysBySlot[slot] = key;
        }
      }
      try {
        await saveSubmittedKycKeys(userId, keysBySlot);
      } catch {
        // bỏ qua: chỉ mất khả năng dùng lại key khi nộp bổ sung
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: KYC_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ['me'] }),
      ]);
    },
    onError: (error) => {
      if (isApiError(error) && error.code === 'KYC_ALREADY_SUBMITTED') {
        void queryClient.invalidateQueries({ queryKey: KYC_QUERY_KEY });
      }
    },
  });
}
