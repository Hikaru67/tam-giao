import { isApiError } from '@tamgiao/api-client';
import { useApiClient } from '@tamgiao/api-client/react';
import {
  NOT_IMPORTANT,
  preferencesResponseSchema,
  updatePreferencesBodySchema,
  type PreferencesResponse,
  type UpdatePreferencesBody,
} from '@tamgiao/contracts/profile';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';

/**
 * Giá trị tiêu chí mặc định hợp lệ theo `updatePreferencesBodySchema` (FE-S2-04).
 * Được sử dụng khi người dùng chưa từng thiết lập tiêu chí (API trả về 404 NOT_FOUND).
 */
export const DEFAULT_PREFERENCES: UpdatePreferencesBody = {
  ageMin: 25,
  ageMax: 32,
  area: {
    city: 'TP. Hồ Chí Minh',
    radiusKm: 20,
  },
  childrenPlan: 'want_children',
  religion: NOT_IMPORTANT,
  lifestyle: {
    smoking: 'never',
    drinking: 'occasionally',
    dailyRhythm: 'flexible',
    sports: 'regularly',
  },
  minEducation: 'bachelor',
  financialIndependence: 'preferred',
  coreTraits: ['honest', 'family_oriented', 'kind'],
};

/**
 * Hook truy xuất tiêu chí bạn đời hiện tại qua `GET /me/preferences`.
 * Nếu chưa có (404 / NOT_FOUND) -> trả về `DEFAULT_PREFERENCES` hợp lệ theo schema.
 */
export function usePreferences() {
  const client = useApiClient();

  return useQuery<UpdatePreferencesBody, Error>({
    queryKey: ['preferences'],
    queryFn: async (): Promise<UpdatePreferencesBody> => {
      try {
        const response = await client.get<typeof preferencesResponseSchema>('/me/preferences', {
          schema: preferencesResponseSchema,
        });

        return {
          ageMin: response.ageMin,
          ageMax: response.ageMax,
          area: {
            city: response.area.city,
            radiusKm: response.area.radiusKm,
          },
          childrenPlan: response.childrenPlan,
          religion: response.religion,
          lifestyle: {
            smoking: response.lifestyle.smoking,
            drinking: response.lifestyle.drinking,
            dailyRhythm: response.lifestyle.dailyRhythm,
            sports: response.lifestyle.sports,
          },
          minEducation: response.minEducation,
          financialIndependence: response.financialIndependence,
          coreTraits: response.coreTraits,
        };
      } catch (err) {
        if (isApiError(err) && (err.status === 404 || err.code === 'NOT_FOUND')) {
          return DEFAULT_PREFERENCES;
        }
        throw err;
      }
    },
  });
}

/**
 * Hook lưu tiêu chí bạn đời qua `PUT /me/preferences`.
 * Validate bằng `updatePreferencesBodySchema.safeParse` trước khi gửi.
 * Thành công -> invalidate `['me']` và `['preferences']` -> điều hướng `router.replace('/')`.
 */
export function useSavePreferences() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation<PreferencesResponse, Error, UpdatePreferencesBody>({
    mutationFn: async (body: UpdatePreferencesBody): Promise<PreferencesResponse> => {
      const parsed = updatePreferencesBodySchema.safeParse(body);
      if (!parsed.success) {
        throw parsed.error;
      }

      return client.put<typeof preferencesResponseSchema>('/me/preferences', {
        body: parsed.data,
        schema: preferencesResponseSchema,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      await queryClient.invalidateQueries({ queryKey: ['preferences'] });
      router.replace('/');
    },
  });
}
