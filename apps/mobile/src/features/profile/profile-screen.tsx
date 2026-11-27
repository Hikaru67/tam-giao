import { useEffect, useState } from 'react';
import { isApiError, messageFor } from '@tamgiao/api-client';
import { useApiClient } from '@tamgiao/api-client/react';
import { MAX_PROFILE_PHOTOS, MIN_AGE } from '@tamgiao/contracts/constants';
import {
  EDUCATION_LEVELS,
  GENDERS,
  HOUSING_TYPES,
  INCOME_RANGES,
  PROFILE_BIO_MAX_LENGTH,
  PROFILE_CHILDREN_PLANS,
  PROFILE_INTERESTS_MAX,
  PROFILE_RELIGIONS,
  updateProfileBodySchema,
  type UpdateProfileBody,
} from '@tamgiao/contracts/profile';
import { Badge, Button, Stepper, Text, TextField } from '@tamgiao/ui-mobile';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { calculateAge } from './age.js';
import { PROFILE_COPY } from './copy.js';
import {
  pickImageFromLibrary,
  processAndUploadPhoto,
  takePhotoWithCamera,
  type PickedImageResult,
} from './image-service.js';
import type { FormPhotoItem, ProfileFormData } from './types.js';
import { useProfile, useSaveProfile } from './use-profile.js';
import type {
  EducationLevel,
  Gender,
  HousingType,
  IncomeRange,
  ProfileChildrenPlan,
  ProfileReligion,
} from './types.js';

const INITIAL_FORM_DATA: ProfileFormData = {
  fullName: '',
  birthDate: '',
  gender: '',
  hometown: '',
  currentCity: '',
  education: '',
  occupation: '',
  religion: '',
  childrenPlan: '',
  bio: '',
  interests: [],
  incomeRange: '',
  housing: '',
  assets: '',
  photos: [],
};

export function ProfileScreen() {
  const router = useRouter();
  const client = useApiClient();

  const { data: profile, isLoading: isProfileLoading } = useProfile();
  const saveProfileMutation = useSaveProfile();

  const [formData, setFormData] = useState<ProfileFormData>(INITIAL_FORM_DATA);
  const [hasUserEdited, setHasUserEdited] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [draftSavedFeedback, setDraftSavedFeedback] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [customInterest, setCustomInterest] = useState('');
  const [photoPickerModalVisible, setPhotoPickerModalVisible] = useState(false);

  // Điền dữ liệu từ profile tải về nếu người dùng chưa bắt đầu chỉnh sửa
  useEffect(() => {
    if (profile && !hasUserEdited) {
      setFormData({
        fullName: profile.fullName ?? '',
        birthDate: profile.birthDate ?? '',
        gender: profile.gender ?? '',
        hometown: profile.hometown ?? '',
        currentCity: profile.currentCity ?? '',
        education: profile.education ?? '',
        occupation: profile.occupation ?? '',
        religion: profile.religion ?? '',
        childrenPlan: profile.childrenPlan ?? '',
        bio: profile.bio ?? '',
        interests: profile.interests ? [...profile.interests] : [],
        incomeRange: profile.incomeRange ?? '',
        housing: profile.housing ?? '',
        assets: profile.assets ?? '',
        photos: profile.photos.map((ph, idx) => ({
          id: `photo-${idx}-${ph.key}`,
          key: ph.key,
          uri: ph.url,
          status: 'uploaded',
        })),
      });
    }
  }, [profile, hasUserEdited]);

  const updateField = <K extends keyof ProfileFormData>(key: K, value: ProfileFormData[K]) => {
    setHasUserEdited(true);
    setFormData((prev) => ({ ...prev, [key]: value }));
    if (fieldErrors[key]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  // Quản lý ảnh
  const handleStartAddPhoto = () => {
    // Chặn trước khi mở picker nếu đã đạt giới hạn MAX_PROFILE_PHOTOS
    if (formData.photos.length >= MAX_PROFILE_PHOTOS) {
      setGeneralError(PROFILE_COPY.errors.tooManyPhotos(MAX_PROFILE_PHOTOS));
      return;
    }
    setPhotoPickerModalVisible(true);
  };

  const handlePickPhoto = async (source: 'library' | 'camera') => {
    // Chặn trước khi mở picker
    if (formData.photos.length >= MAX_PROFILE_PHOTOS) {
      setGeneralError(PROFILE_COPY.errors.tooManyPhotos(MAX_PROFILE_PHOTOS));
      setPhotoPickerModalVisible(false);
      return;
    }

    setPhotoPickerModalVisible(false);
    let picked: PickedImageResult | null = null;
    try {
      if (source === 'library') {
        picked = await pickImageFromLibrary();
      } else {
        picked = await takePhotoWithCamera();
      }
    } catch {
      Alert.alert(PROFILE_COPY.photos.title, PROFILE_COPY.photos.permissionDenied);
      return;
    }

    if (!picked) return;

    const tempId = `photo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const newPhotoItem: FormPhotoItem = {
      id: tempId,
      key: '',
      uri: picked.uri,
      status: 'uploading',
    };

    setHasUserEdited(true);
    setFormData((prev) => ({
      ...prev,
      photos: [...prev.photos, newPhotoItem],
    }));

    await uploadPhotoItem(tempId, picked);
  };

  const uploadPhotoItem = async (photoId: string, image: PickedImageResult) => {
    try {
      const result = await processAndUploadPhoto(image, client);
      setFormData((prev) => ({
        ...prev,
        photos: prev.photos.map((p) =>
          p.id === photoId
            ? { ...p, key: result.key, uri: result.uri, status: 'uploaded', error: undefined }
            : p,
        ),
      }));
      if (fieldErrors.photos) {
        setFieldErrors((prev) => {
          const next = { ...prev };
          delete next.photos;
          return next;
        });
      }
    } catch {
      setFormData((prev) => ({
        ...prev,
        photos: prev.photos.map((p) =>
          p.id === photoId ? { ...p, status: 'failed', error: PROFILE_COPY.errors.uploadFailed } : p,
        ),
      }));
    }
  };

  const handleRetryPhoto = async (photo: FormPhotoItem) => {
    setFormData((prev) => ({
      ...prev,
      photos: prev.photos.map((p) =>
        p.id === photo.id ? { ...p, status: 'uploading', error: undefined } : p,
      ),
    }));
    await uploadPhotoItem(photo.id, { uri: photo.uri });
  };

  const handleDeletePhoto = (photoId: string) => {
    setHasUserEdited(true);
    setFormData((prev) => ({
      ...prev,
      photos: prev.photos.filter((p) => p.id !== photoId),
    }));
  };

  const handleSetMainPhoto = (photoIndex: number) => {
    if (photoIndex === 0) return;
    setHasUserEdited(true);
    setFormData((prev) => {
      const nextPhotos = [...prev.photos];
      const target = nextPhotos[photoIndex];
      if (!target) return prev;
      nextPhotos.splice(photoIndex, 1);
      nextPhotos.unshift(target);
      return { ...prev, photos: nextPhotos };
    });
  };

  // Quản lý ngày sinh
  const handleDateChange = (event: DateTimePickerEvent, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      setShowDatePicker(false);
    }
    if (event.type === 'dismissed') {
      setShowDatePicker(false);
      return;
    }
    if (selectedDate) {
      const yyyy = selectedDate.getFullYear();
      const mm = String(selectedDate.getMonth() + 1).padStart(2, '0');
      const dd = String(selectedDate.getDate()).padStart(2, '0');
      const isoDate = `${yyyy}-${mm}-${dd}`;
      updateField('birthDate', isoDate);
    }
  };

  // Quản lý sở thích
  const handleToggleSuggestedInterest = (interest: string) => {
    setHasUserEdited(true);
    setFormData((prev) => {
      const exists = prev.interests.includes(interest);
      if (exists) {
        return { ...prev, interests: prev.interests.filter((i) => i !== interest) };
      }
      if (prev.interests.length >= PROFILE_INTERESTS_MAX) {
        setGeneralError(PROFILE_COPY.errors.tooManyInterests(PROFILE_INTERESTS_MAX));
        return prev;
      }
      return { ...prev, interests: [...prev.interests, interest] };
    });
  };

  const handleAddCustomInterest = () => {
    const trimmed = customInterest.trim();
    if (!trimmed) return;
    if (formData.interests.includes(trimmed)) {
      setGeneralError(PROFILE_COPY.errors.interestAlreadyExists);
      return;
    }
    if (formData.interests.length >= PROFILE_INTERESTS_MAX) {
      setGeneralError(PROFILE_COPY.errors.tooManyInterests(PROFILE_INTERESTS_MAX));
      return;
    }
    setHasUserEdited(true);
    setFormData((prev) => ({ ...prev, interests: [...prev.interests, trimmed] }));
    setCustomInterest('');
  };

  const handleRemoveInterest = (interest: string) => {
    setHasUserEdited(true);
    setFormData((prev) => ({
      ...prev,
      interests: prev.interests.filter((i) => i !== interest),
    }));
  };

  // Lưu hoặc nộp form
  const handleSave = async (submit: boolean) => {
    setGeneralError(null);
    const newFieldErrors: Record<string, string> = {};

    // 1. Kiểm tra tuổi
    if (formData.birthDate) {
      const age = calculateAge(formData.birthDate);
      if (age === null) {
        newFieldErrors.birthDate = PROFILE_COPY.errors.birthDateInvalid;
      } else if (age < MIN_AGE) {
        newFieldErrors.birthDate = PROFILE_COPY.errors.ageUnderMin(MIN_AGE);
      }
    } else if (submit) {
      newFieldErrors.birthDate = PROFILE_COPY.errors.birthDateRequired;
    }

    // 2. Kiểm tra các trường bắt buộc khi submit: true
    if (submit) {
      if (!formData.fullName.trim()) {
        newFieldErrors.fullName = PROFILE_COPY.errors.fullNameRequired;
      }
      if (!formData.gender) {
        newFieldErrors.gender = PROFILE_COPY.errors.genderRequired;
      }
      if (!formData.currentCity.trim()) {
        newFieldErrors.currentCity = PROFILE_COPY.errors.currentCityRequired;
      }
      if (!formData.education) {
        newFieldErrors.education = PROFILE_COPY.errors.educationRequired;
      }
      if (!formData.occupation.trim()) {
        newFieldErrors.occupation = PROFILE_COPY.errors.occupationRequired;
      }
      if (!formData.religion) {
        newFieldErrors.religion = PROFILE_COPY.errors.religionRequired;
      }
      if (!formData.childrenPlan) {
        newFieldErrors.childrenPlan = PROFILE_COPY.errors.childrenPlanRequired;
      }
      const uploadedPhotos = formData.photos.filter((p) => p.status === 'uploaded');
      if (uploadedPhotos.length === 0) {
        newFieldErrors.photos = PROFILE_COPY.errors.photoRequired;
      }
    }

    // 3. Chuẩn hoá payload và validate bằng updateProfileBodySchema
    const uploadedPhotos = formData.photos
      .filter((p) => p.status === 'uploaded' && Boolean(p.key))
      .map((p) => p.key);

    const payload: UpdateProfileBody = {
      fullName: formData.fullName.trim() || null,
      birthDate: formData.birthDate.trim() || null,
      gender: (formData.gender as Gender) || null,
      hometown: formData.hometown.trim() || null,
      currentCity: formData.currentCity.trim() || null,
      education: (formData.education as EducationLevel) || null,
      occupation: formData.occupation.trim() || null,
      religion: (formData.religion as ProfileReligion) || null,
      childrenPlan: (formData.childrenPlan as ProfileChildrenPlan) || null,
      bio: formData.bio.trim() || null,
      interests: formData.interests.length > 0 ? formData.interests : [],
      incomeRange: (formData.incomeRange as IncomeRange) || null,
      housing: (formData.housing as HousingType) || null,
      assets: formData.assets.trim() || null,
      photos: uploadedPhotos,
      submit,
    };

    const schemaResult = updateProfileBodySchema.safeParse(payload);
    if (!schemaResult.success) {
      for (const issue of schemaResult.error.issues) {
        const pathKey = issue.path[0];
        if (typeof pathKey === 'string' && !newFieldErrors[pathKey]) {
          newFieldErrors[pathKey] = issue.message;
        }
      }
    }

    // Nếu có lỗi client-side -> dừng lại và hiển thị lỗi dưới đúng trường
    if (Object.keys(newFieldErrors).length > 0) {
      setFieldErrors(newFieldErrors);
      return;
    }

    try {
      await saveProfileMutation.mutateAsync(payload);
      if (!submit) {
        setDraftSavedFeedback(true);
        setTimeout(() => setDraftSavedFeedback(false), 2000);
      }
    } catch (err: unknown) {
      if (isApiError(err)) {
        if (err.code === 'VALIDATION_FAILED' && err.fieldErrors && err.fieldErrors.length > 0) {
          const serverErrors: Record<string, string> = {};
          for (const fe of err.fieldErrors) {
            serverErrors[fe.path] = fe.message;
          }
          setFieldErrors((prev) => ({ ...prev, ...serverErrors }));
          return;
        }
        const info = messageFor(err);
        setGeneralError(info.title);
      } else {
        const info = messageFor({ code: 'NETWORK_ERROR' });
        setGeneralError(info.title);
      }
    }
  };

  const calculatedAge = formData.birthDate ? calculateAge(formData.birthDate) : null;
  const isSaving = saveProfileMutation.isPending;
  const mainPhoto = formData.photos[0];
  const secondaryPhotos = formData.photos.slice(1);

  if (isProfileLoading && !hasUserEdited) {
    return (
      <View className="flex-1 items-center justify-center bg-surface p-space-md gap-space-sm">
        <ActivityIndicator size="large" />
        <Text variant="title-md" className="font-semibold text-primary">
          {PROFILE_COPY.header.brandName}
        </Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView behavior="padding" className="flex-1 bg-surface">
      {/* Header */}
      <View className="bg-surface/90 pt-safe border-b border-outline-variant/30 px-gutter pb-space-xs z-10">
        <View className="h-14 flex-row items-center justify-between">
          <View className="flex-row items-center gap-space-xs">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={PROFILE_COPY.header.backA11y}
              onPress={() => router.back()}
              className="w-10 h-10 items-center justify-center rounded-full active:bg-surface-container"
            >
              <Text variant="title-md" className="text-on-surface">
                ‹
              </Text>
            </Pressable>
            <View className="w-7 h-7 rounded-lg bg-primary-container items-center justify-center">
              <Text variant="label-sm" className="text-on-primary font-bold">
                TG
              </Text>
            </View>
            <Text variant="title-md" className="font-semibold text-on-surface">
              {PROFILE_COPY.header.title}
            </Text>
          </View>
          <Button
            variant="ghost"
            size="md"
            loading={isSaving && !saveProfileMutation.variables?.submit}
            disabled={isSaving}
            onPress={() => handleSave(false)}
          >
            {draftSavedFeedback ? PROFILE_COPY.header.savedDraft : PROFILE_COPY.header.saveDraft}
          </Button>
        </View>
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ flexGrow: 1, paddingBottom: 40 }}
        className="flex-1 px-margin"
      >
        <View className="py-space-md gap-space-lg">
          {/* Progress / Stepper */}
          <View className="gap-space-xs">
            <Text variant="label-sm" className="text-primary font-bold tracking-wider uppercase">
              {PROFILE_COPY.header.stepNumber}
            </Text>
            <Text variant="headline-sm" className="font-bold text-on-surface">
              {PROFILE_COPY.header.screenTitle}
            </Text>
            <Stepper
              steps={[
                { label: PROFILE_COPY.stepper[0]!.label, state: 'current' },
                { label: PROFILE_COPY.stepper[1]!.label, state: 'todo' },
                { label: PROFILE_COPY.stepper[2]!.label, state: 'todo' },
              ]}
              className="mt-space-xs"
            />
          </View>

          {/* Intro Card */}
          <View className="bg-surface-container-lowest p-space-md rounded-xl gap-space-xs border-l-4 border-l-primary border border-outline-variant/30 shadow-sm">
            <Text variant="title-md" className="font-semibold text-on-surface">
              {PROFILE_COPY.introCard.title}
            </Text>
            <Text variant="body-sm" className="text-secondary leading-relaxed">
              {PROFILE_COPY.introCard.description}
            </Text>
          </View>

          {/* General Error Banner */}
          {generalError ? (
            <View className="p-space-md rounded-xl bg-error-container/30 border border-error/50">
              <Text variant="body-sm" className="text-error font-medium">
                {generalError}
              </Text>
            </View>
          ) : null}

          {/* SECTION 1: HÌNH ẢNH CHÂN DUNG */}
          <View className="gap-space-sm">
            <View className="flex-row items-center justify-between">
              <Text variant="title-md" className="font-bold text-on-surface">
                {PROFILE_COPY.photos.title}
              </Text>
              <Text variant="label-sm" className="text-secondary font-medium">
                {PROFILE_COPY.photos.maxPhotos}
              </Text>
            </View>

            <View className="bg-surface-container-lowest p-space-md rounded-xl gap-space-md border border-outline-variant/30 shadow-sm">
              {/* Ảnh đại diện chính (Ảnh thứ nhất) */}
              <View className="flex-col sm:flex-row items-center gap-space-md">
                {mainPhoto ? (
                  <View
                    testID="profile-main-photo"
                    className="relative w-28 h-28 rounded-2xl overflow-hidden bg-surface-container shadow-sm"
                  >
                    <Image source={{ uri: mainPhoto.uri }} className="w-full h-full object-cover" />
                    {mainPhoto.status === 'uploading' ? (
                      <View className="absolute inset-0 bg-on-surface/40 items-center justify-center">
                        <ActivityIndicator size="small" color="#ffffff" />
                        <Text variant="label-sm" className="text-on-primary mt-1">
                          {PROFILE_COPY.photos.uploading}
                        </Text>
                      </View>
                    ) : mainPhoto.status === 'failed' ? (
                      <View className="absolute inset-0 bg-error/70 items-center justify-center p-1">
                        <Pressable
                          accessibilityRole="button"
                          onPress={() => handleRetryPhoto(mainPhoto)}
                          className="bg-surface-container-lowest px-2 py-1 rounded"
                        >
                          <Text variant="label-sm" className="text-error font-semibold">
                            {PROFILE_COPY.photos.retryUpload}
                          </Text>
                        </Pressable>
                      </View>
                    ) : (
                      <View className="absolute bottom-1 right-1 bg-primary rounded-full p-1 shadow-sm">
                        <Text variant="label-sm" className="text-on-primary text-[10px]">
                          ✓
                        </Text>
                      </View>
                    )}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={PROFILE_COPY.photos.deletePhotoA11y}
                      onPress={() => handleDeletePhoto(mainPhoto.id)}
                      className="absolute top-1 right-1 w-6 h-6 rounded-full bg-surface-container-lowest/80 items-center justify-center shadow-sm"
                    >
                      <Text variant="label-sm" className="text-on-surface font-bold text-[12px]">
                        ✕
                      </Text>
                    </Pressable>
                  </View>
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={PROFILE_COPY.photos.mainPhotoTitle}
                    onPress={handleStartAddPhoto}
                    className="w-28 h-28 rounded-2xl border-2 border-dashed border-outline-variant items-center justify-center bg-surface-container-low active:bg-surface-container"
                  >
                    <Text variant="title-md" className="text-primary font-bold">
                      +
                    </Text>
                    <Text variant="label-sm" className="text-primary font-medium mt-1">
                      {PROFILE_COPY.photos.addPhoto}
                    </Text>
                  </Pressable>
                )}

                <View className="flex-1 gap-1">
                  <Text variant="label-md" className="font-semibold text-on-surface">
                    {PROFILE_COPY.photos.mainPhotoTitle}
                  </Text>
                  <Text variant="body-sm" className="text-secondary leading-snug">
                    {PROFILE_COPY.photos.mainPhotoHint}
                  </Text>
                  <Text variant="label-sm" className="text-primary font-medium mt-1">
                    ✓ {PROFILE_COPY.photos.trustBadge}
                  </Text>
                </View>
              </View>

              {/* Các ảnh phụ */}
              <View className="gap-space-xs pt-space-xs border-t border-outline-variant/20">
                <Text variant="label-md" className="font-semibold text-on-surface">
                  {PROFILE_COPY.photos.secondaryPhotosTitle}
                </Text>

                <View className="flex-row flex-wrap gap-space-sm pt-space-xs">
                  {secondaryPhotos.map((photo, index) => {
                    const actualIndex = index + 1;
                    return (
                      <View
                        key={photo.id}
                        className="w-20 h-20 rounded-lg overflow-hidden bg-surface-container relative shadow-sm"
                      >
                        <Image source={{ uri: photo.uri }} className="w-full h-full object-cover" />
                        {photo.status === 'uploading' ? (
                          <View className="absolute inset-0 bg-on-surface/40 items-center justify-center">
                            <ActivityIndicator size="small" color="#ffffff" />
                          </View>
                        ) : photo.status === 'failed' ? (
                          <View className="absolute inset-0 bg-error/70 items-center justify-center p-1">
                            <Pressable
                              accessibilityRole="button"
                              onPress={() => handleRetryPhoto(photo)}
                              className="bg-surface-container-lowest px-1 py-0.5 rounded"
                            >
                              <Text variant="label-sm" className="text-error text-[10px] font-semibold">
                                {PROFILE_COPY.photos.retryUpload}
                              </Text>
                            </Pressable>
                          </View>
                        ) : null}

                        {/* Nút đặt làm ảnh đại diện */}
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={PROFILE_COPY.photos.setAsMainPhoto}
                          onPress={() => handleSetMainPhoto(actualIndex)}
                          className="absolute bottom-1 left-1 bg-surface-container-lowest/90 px-1 py-0.5 rounded"
                        >
                          <Text variant="label-sm" className="text-[10px] text-primary font-medium">
                            Đại diện
                          </Text>
                        </Pressable>

                        {/* Nút xoá ảnh */}
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={PROFILE_COPY.photos.deletePhotoA11y}
                          onPress={() => handleDeletePhoto(photo.id)}
                          className="absolute top-1 right-1 w-5 h-5 rounded-full bg-surface-container-lowest/80 items-center justify-center shadow-sm"
                        >
                          <Text variant="label-sm" className="text-on-surface text-[10px] font-bold">
                            ✕
                          </Text>
                        </Pressable>
                      </View>
                    );
                  })}

                  {/* Nút Thêm ảnh */}
                  {formData.photos.length < MAX_PROFILE_PHOTOS ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={PROFILE_COPY.photos.addPhoto}
                      onPress={handleStartAddPhoto}
                      className="w-20 h-20 rounded-lg bg-surface-container-low border border-dashed border-outline-variant items-center justify-center active:bg-surface-container"
                    >
                      <Text variant="title-md" className="text-primary font-bold">
                        +
                      </Text>
                      <Text variant="label-sm" className="text-secondary mt-0.5">
                        {PROFILE_COPY.photos.addPhoto}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>

              {fieldErrors.photos ? (
                <Text variant="body-sm" className="text-error">
                  {fieldErrors.photos}
                </Text>
              ) : null}
            </View>
          </View>

          {/* Modal chọn nguồn ảnh (Thư viện / Máy ảnh) */}
          {photoPickerModalVisible ? (
            <View
              className="bg-surface-container-lowest p-space-md rounded-xl border border-primary/40 shadow-md gap-space-sm"
              accessibilityRole="alert"
            >
              <Text variant="title-md" className="font-semibold text-on-surface">
                {PROFILE_COPY.photos.chooseSourceTitle}
              </Text>
              <View className="flex-row gap-space-sm">
                <Button
                  variant="primary"
                  size="md"
                  className="flex-1"
                  accessibilityLabel={PROFILE_COPY.photos.fromLibrary}
                  onPress={() => handlePickPhoto('library')}
                >
                  {PROFILE_COPY.photos.fromLibrary}
                </Button>
                <Button
                  variant="secondary"
                  size="md"
                  className="flex-1"
                  accessibilityLabel={PROFILE_COPY.photos.fromCamera}
                  onPress={() => handlePickPhoto('camera')}
                >
                  {PROFILE_COPY.photos.fromCamera}
                </Button>
              </View>
              <Button variant="ghost" size="md" onPress={() => setPhotoPickerModalVisible(false)}>
                {PROFILE_COPY.photos.cancel}
              </Button>
            </View>
          ) : null}

          {/* SECTION 2: THÔNG TIN CÁ NHÂN CƠ BẢN */}
          <View className="gap-space-sm">
            <Text variant="title-md" className="font-bold text-on-surface">
              {PROFILE_COPY.personalInfo.sectionTitle}
            </Text>

            <View className="bg-surface-container-lowest p-space-md rounded-xl gap-space-md border border-outline-variant/30 shadow-sm">
              {/* Họ và tên */}
              <TextField
                testID="profile-full-name"
                label={PROFILE_COPY.personalInfo.fullNameLabel}
                placeholder={PROFILE_COPY.personalInfo.fullNamePlaceholder}
                value={formData.fullName}
                onChangeText={(val) => updateField('fullName', val)}
                error={fieldErrors.fullName}
                disabled={isSaving}
              />

              {/* Ngày sinh */}
              <View className="gap-space-xs">
                <View className="flex-row items-center justify-between">
                  <Text variant="label-md" className="font-semibold text-on-surface">
                    {PROFILE_COPY.personalInfo.birthDateLabel}
                  </Text>
                  {calculatedAge !== null ? (
                    <Badge tone={calculatedAge < MIN_AGE ? 'danger' : 'primary'}>
                      {PROFILE_COPY.personalInfo.ageBadge(calculatedAge)}
                    </Badge>
                  ) : null}
                </View>

                <View className="flex-row items-center gap-space-sm">
                  <View className="flex-1">
                    <TextInput
                      testID="profile-birth-date"
                      value={formData.birthDate}
                      onChangeText={(val) => updateField('birthDate', val)}
                      placeholder={PROFILE_COPY.personalInfo.birthDatePlaceholder}
                      placeholderTextColor="#565e74"
                      editable={!isSaving}
                      className={`min-h-[44px] px-space-md py-space-xs rounded-md bg-surface-container-lowest text-on-surface text-body-md border ${
                        fieldErrors.birthDate ? 'border-error' : 'border-outline-variant'
                      }`.trim()}
                      accessibilityLabel={PROFILE_COPY.personalInfo.birthDateLabel}
                    />
                  </View>
                  <Button
                    variant="secondary"
                    size="md"
                    accessibilityLabel={PROFILE_COPY.personalInfo.selectBirthDate}
                    onPress={() => setShowDatePicker(true)}
                  >
                    {PROFILE_COPY.personalInfo.selectBirthDate}
                  </Button>
                </View>

                {showDatePicker ? (
                  <DateTimePicker
                    testID="birth-date-picker"
                    value={
                      formData.birthDate && !isNaN(Date.parse(formData.birthDate))
                        ? new Date(formData.birthDate)
                        : new Date(2000, 0, 1)
                    }
                    mode="date"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    maximumDate={new Date()}
                    onChange={handleDateChange}
                  />
                ) : null}

                {fieldErrors.birthDate ? (
                  <Text variant="body-sm" className="text-error">
                    {fieldErrors.birthDate}
                  </Text>
                ) : null}
              </View>

              {/* Giới tính */}
              <View className="gap-space-xs">
                <Text variant="label-md" className="font-semibold text-on-surface">
                  {PROFILE_COPY.personalInfo.genderLabel}
                </Text>
                <View className="flex-row gap-space-sm">
                  {GENDERS.map((g) => {
                    const isSelected = formData.gender === g;
                    const label =
                      g === 'male'
                        ? PROFILE_COPY.personalInfo.genderMale
                        : PROFILE_COPY.personalInfo.genderFemale;
                    return (
                      <Pressable
                        key={g}
                        testID={`profile-gender-${g}`}
                        accessibilityRole="button"
                        accessibilityLabel={label}
                        onPress={() => updateField('gender', g)}
                        className={`flex-1 min-h-[44px] items-center justify-center rounded-xl transition-all ${
                          isSelected
                            ? 'bg-primary text-on-primary'
                            : 'bg-surface-container-low text-secondary'
                        }`}
                      >
                        <Text
                          variant="label-md"
                          className={isSelected ? 'text-on-primary font-bold' : 'text-secondary'}
                        >
                          {label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                {fieldErrors.gender ? (
                  <Text variant="body-sm" className="text-error">
                    {fieldErrors.gender}
                  </Text>
                ) : null}
              </View>

              {/* Quê quán */}
              <TextField
                testID="profile-hometown"
                label={PROFILE_COPY.personalInfo.hometownLabel}
                placeholder={PROFILE_COPY.personalInfo.hometownPlaceholder}
                value={formData.hometown}
                onChangeText={(val) => updateField('hometown', val)}
                error={fieldErrors.hometown}
                disabled={isSaving}
              />

              {/* Nơi sống hiện tại */}
              <TextField
                testID="profile-current-city"
                label={PROFILE_COPY.personalInfo.currentCityLabel}
                placeholder={PROFILE_COPY.personalInfo.currentCityPlaceholder}
                value={formData.currentCity}
                onChangeText={(val) => updateField('currentCity', val)}
                error={fieldErrors.currentCity}
                disabled={isSaving}
              />

              {/* Trình độ học vấn */}
              <View className="gap-space-xs">
                <Text variant="label-md" className="font-semibold text-on-surface">
                  {PROFILE_COPY.personalInfo.educationLabel}
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  {EDUCATION_LEVELS.map((level) => {
                    const isSelected = formData.education === level;
                    const label = PROFILE_COPY.educationOptions[level];
                    return (
                      <Pressable
                        key={level}
                        testID={`profile-education-${level}`}
                        accessibilityRole="button"
                        accessibilityLabel={label}
                        onPress={() => updateField('education', level)}
                        className={`px-3 py-1.5 rounded-full border ${
                          isSelected
                            ? 'bg-primary border-primary'
                            : 'bg-surface-container-low border-outline-variant/40'
                        }`}
                      >
                        <Text
                          variant="label-sm"
                          className={isSelected ? 'text-on-primary font-semibold' : 'text-on-surface'}
                        >
                          {label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                {fieldErrors.education ? (
                  <Text variant="body-sm" className="text-error">
                    {fieldErrors.education}
                  </Text>
                ) : null}
              </View>

              {/* Nghề nghiệp / Chức vụ */}
              <TextField
                testID="profile-occupation"
                label={PROFILE_COPY.personalInfo.occupationLabel}
                placeholder={PROFILE_COPY.personalInfo.occupationPlaceholder}
                value={formData.occupation}
                onChangeText={(val) => updateField('occupation', val)}
                error={fieldErrors.occupation}
                disabled={isSaving}
              />

              {/* Tôn giáo */}
              <View className="gap-space-xs">
                <Text variant="label-md" className="font-semibold text-on-surface">
                  {PROFILE_COPY.personalInfo.religionLabel}
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  {PROFILE_RELIGIONS.map((r) => {
                    const isSelected = formData.religion === r;
                    const label = PROFILE_COPY.religionOptions[r];
                    return (
                      <Pressable
                        key={r}
                        testID={`profile-religion-${r}`}
                        accessibilityRole="button"
                        accessibilityLabel={label}
                        onPress={() => updateField('religion', r)}
                        className={`px-3 py-1.5 rounded-full border ${
                          isSelected
                            ? 'bg-primary border-primary'
                            : 'bg-surface-container-low border-outline-variant/40'
                        }`}
                      >
                        <Text
                          variant="label-sm"
                          className={isSelected ? 'text-on-primary font-semibold' : 'text-on-surface'}
                        >
                          {label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                {fieldErrors.religion ? (
                  <Text variant="body-sm" className="text-error">
                    {fieldErrors.religion}
                  </Text>
                ) : null}
              </View>

              {/* Kế hoạch con cái */}
              <View className="gap-space-xs">
                <Text variant="label-md" className="font-semibold text-on-surface">
                  {PROFILE_COPY.personalInfo.childrenPlanLabel}
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  {PROFILE_CHILDREN_PLANS.map((cp) => {
                    const isSelected = formData.childrenPlan === cp;
                    const label = PROFILE_COPY.childrenPlanOptions[cp];
                    return (
                      <Pressable
                        key={cp}
                        testID={`profile-children-${cp}`}
                        accessibilityRole="button"
                        accessibilityLabel={label}
                        onPress={() => updateField('childrenPlan', cp)}
                        className={`px-3 py-1.5 rounded-full border ${
                          isSelected
                            ? 'bg-primary border-primary'
                            : 'bg-surface-container-low border-outline-variant/40'
                        }`}
                      >
                        <Text
                          variant="label-sm"
                          className={isSelected ? 'text-on-primary font-semibold' : 'text-on-surface'}
                        >
                          {label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                {fieldErrors.childrenPlan ? (
                  <Text variant="body-sm" className="text-error">
                    {fieldErrors.childrenPlan}
                  </Text>
                ) : null}
              </View>
            </View>
          </View>

          {/* SECTION 3: GIỚI THIỆU & QUAN NIỆM CUỘC SỐNG */}
          <View className="gap-space-sm">
            <Text variant="title-md" className="font-bold text-on-surface">
              {PROFILE_COPY.lifestyleInfo.sectionTitle}
            </Text>

            <View className="bg-surface-container-lowest p-space-md rounded-xl gap-space-md border border-outline-variant/30 shadow-sm">
              {/* Đoạn tự bạch */}
              <View className="gap-space-xs">
                <View className="flex-row items-center justify-between">
                  <Text variant="label-md" className="font-semibold text-on-surface">
                    {PROFILE_COPY.lifestyleInfo.bioLabel}
                  </Text>
                  <Text variant="label-sm" className="text-secondary">
                    {PROFILE_COPY.lifestyleInfo.bioCounter(formData.bio.length)}
                  </Text>
                </View>
                <TextInput
                  multiline
                  numberOfLines={4}
                  maxLength={PROFILE_BIO_MAX_LENGTH}
                  value={formData.bio}
                  onChangeText={(val) => updateField('bio', val)}
                  placeholder={PROFILE_COPY.lifestyleInfo.bioPlaceholder}
                  placeholderTextColor="#565e74"
                  editable={!isSaving}
                  className={`min-h-[96px] p-space-md rounded-xl bg-surface-container-low text-on-surface text-body-md border ${
                    fieldErrors.bio ? 'border-error' : 'border-outline-variant/40'
                  }`.trim()}
                  accessibilityLabel={PROFILE_COPY.lifestyleInfo.bioLabel}
                />
                <Text variant="body-sm" className="text-secondary leading-snug">
                  {PROFILE_COPY.lifestyleInfo.bioHint}
                </Text>
                {fieldErrors.bio ? (
                  <Text variant="body-sm" className="text-error">
                    {fieldErrors.bio}
                  </Text>
                ) : null}
              </View>

              {/* Sở thích & Phong cách sống */}
              <View className="gap-space-xs pt-space-xs">
                <View className="flex-row items-center justify-between">
                  <Text variant="label-md" className="font-semibold text-on-surface">
                    {PROFILE_COPY.lifestyleInfo.interestsLabel}
                  </Text>
                  <Text variant="label-sm" className="text-secondary">
                    {formData.interests.length}/{PROFILE_INTERESTS_MAX}
                  </Text>
                </View>

                {/* Các sở thích gợi ý */}
                <View className="flex-row flex-wrap gap-2">
                  {PROFILE_COPY.suggestedInterests.map((item) => {
                    const isSelected = formData.interests.includes(item);
                    return (
                      <Pressable
                        key={item}
                        accessibilityRole="button"
                        accessibilityLabel={item}
                        onPress={() => handleToggleSuggestedInterest(item)}
                        className={`px-3 py-1.5 rounded-full border ${
                          isSelected
                            ? 'bg-primary-container border-primary text-on-primary'
                            : 'bg-surface-container-high border-outline-variant/30 text-on-surface'
                        }`}
                      >
                        <Text
                          variant="label-sm"
                          className={isSelected ? 'text-on-primary font-semibold' : 'text-on-surface'}
                        >
                          {item}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                {/* Danh sách các thẻ đã thêm ngoài gợi ý */}
                {formData.interests.some(
                  (i) =>
                    !PROFILE_COPY.suggestedInterests.includes(
                      i as (typeof PROFILE_COPY.suggestedInterests)[number],
                    ),
                ) ? (
                  <View className="flex-row flex-wrap gap-2 mt-2">
                    {formData.interests
                      .filter(
                        (i) =>
                          !PROFILE_COPY.suggestedInterests.includes(
                            i as (typeof PROFILE_COPY.suggestedInterests)[number],
                          ),
                      )
                      .map((ci) => (
                        <View
                          key={ci}
                          className="px-3 py-1.5 rounded-full bg-primary-fixed border border-primary/40 flex-row items-center gap-1.5"
                        >
                          <Text variant="label-sm" className="text-on-primary-fixed font-medium">
                            {ci}
                          </Text>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Xoá ${ci}`}
                            onPress={() => handleRemoveInterest(ci)}
                          >
                            <Text variant="label-sm" className="text-on-primary-fixed font-bold">
                              ✕
                            </Text>
                          </Pressable>
                        </View>
                      ))}
                  </View>
                ) : null}

                {/* Nhập sở thích tuỳ biến */}
                <View className="flex-row items-center gap-2 mt-2">
                  <View className="flex-1">
                    <TextInput
                      value={customInterest}
                      onChangeText={setCustomInterest}
                      placeholder={PROFILE_COPY.lifestyleInfo.customInterestPlaceholder}
                      placeholderTextColor="#565e74"
                      editable={!isSaving}
                      className="min-h-[40px] px-space-md py-1 rounded-full bg-surface-container-lowest text-on-surface text-body-sm border border-outline-variant/40"
                    />
                  </View>
                  <Button
                    variant="secondary"
                    size="md"
                    onPress={handleAddCustomInterest}
                    disabled={!customInterest.trim() || isSaving}
                  >
                    {PROFILE_COPY.lifestyleInfo.addInterestButton}
                  </Button>
                </View>

                {fieldErrors.interests ? (
                  <Text variant="body-sm" className="text-error">
                    {fieldErrors.interests}
                  </Text>
                ) : null}
              </View>
            </View>
          </View>

          {/* SECTION 4: THÔNG TIN BẢO MẬT & CƯ TRÚ (NHẠY CẢM) */}
          <View className="gap-space-sm">
            <View className="flex-row items-center justify-between">
              <Text variant="title-md" className="font-bold text-on-surface">
                {PROFILE_COPY.confidentialInfo.sectionTitle}
              </Text>
              <Badge tone="neutral">{PROFILE_COPY.confidentialInfo.optionalBadge}</Badge>
            </View>

            <View className="bg-surface-container-lowest p-space-md rounded-xl gap-space-md border border-outline-variant/30 shadow-sm">
              {/* Thu nhập cá nhân */}
              <View className="gap-space-xs">
                <View className="flex-row items-center justify-between">
                  <Text variant="label-md" className="font-semibold text-on-surface">
                    {PROFILE_COPY.confidentialInfo.incomeLabel}
                  </Text>
                  <Text variant="label-sm" className="text-secondary italic">
                    {PROFILE_COPY.confidentialInfo.confidentialNotice}
                  </Text>
                </View>
                <View className="flex-row flex-wrap gap-2">
                  {INCOME_RANGES.map((range) => {
                    const isSelected = formData.incomeRange === range;
                    const label = PROFILE_COPY.incomeOptions[range];
                    return (
                      <Pressable
                        key={range}
                        accessibilityRole="button"
                        accessibilityLabel={label}
                        onPress={() => updateField('incomeRange', range)}
                        className={`px-3 py-1.5 rounded-full border ${
                          isSelected
                            ? 'bg-primary border-primary'
                            : 'bg-surface-container-low border-outline-variant/40'
                        }`}
                      >
                        <Text
                          variant="label-sm"
                          className={isSelected ? 'text-on-primary font-semibold' : 'text-on-surface'}
                        >
                          {label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                {fieldErrors.incomeRange ? (
                  <Text variant="body-sm" className="text-error">
                    {fieldErrors.incomeRange}
                  </Text>
                ) : null}
              </View>

              {/* Loại hình nhà ở */}
              <View className="gap-space-xs">
                <View className="flex-row items-center justify-between">
                  <Text variant="label-md" className="font-semibold text-on-surface">
                    {PROFILE_COPY.confidentialInfo.housingLabel}
                  </Text>
                  <Text variant="label-sm" className="text-secondary italic">
                    {PROFILE_COPY.confidentialInfo.confidentialNotice}
                  </Text>
                </View>
                <View className="flex-row flex-wrap gap-2">
                  {HOUSING_TYPES.map((h) => {
                    const isSelected = formData.housing === h;
                    const label = PROFILE_COPY.housingOptions[h];
                    return (
                      <Pressable
                        key={h}
                        accessibilityRole="button"
                        accessibilityLabel={label}
                        onPress={() => updateField('housing', h)}
                        className={`px-3 py-1.5 rounded-full border ${
                          isSelected
                            ? 'bg-primary border-primary'
                            : 'bg-surface-container-low border-outline-variant/40'
                        }`}
                      >
                        <Text
                          variant="label-sm"
                          className={isSelected ? 'text-on-primary font-semibold' : 'text-on-surface'}
                        >
                          {label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                {fieldErrors.housing ? (
                  <Text variant="body-sm" className="text-error">
                    {fieldErrors.housing}
                  </Text>
                ) : null}
              </View>

              {/* Tài sản & Đầu tư */}
              <TextField
                label={PROFILE_COPY.confidentialInfo.assetsLabel}
                placeholder={PROFILE_COPY.confidentialInfo.assetsPlaceholder}
                hint={PROFILE_COPY.confidentialInfo.confidentialNotice}
                value={formData.assets}
                onChangeText={(val) => updateField('assets', val)}
                error={fieldErrors.assets}
                disabled={isSaving}
              />

              <Text variant="body-sm" className="text-secondary italic pt-1">
                🔒 {PROFILE_COPY.confidentialInfo.privacyFooter}
              </Text>
            </View>
          </View>

          {/* Privilege Card */}
          <View className="bg-surface-container-low p-space-md rounded-xl gap-space-sm border border-outline-variant/30">
            <Text variant="title-md" className="font-semibold text-primary">
              ⭐ {PROFILE_COPY.privilegeCard.title}
            </Text>
            <Text variant="body-sm" className="text-on-surface">
              ✓ {PROFILE_COPY.privilegeCard.benefit1}
            </Text>
            <Text variant="body-sm" className="text-on-surface">
              ✓ {PROFILE_COPY.privilegeCard.benefit2}
            </Text>
            <Text variant="body-sm" className="text-secondary leading-snug">
              ℹ {PROFILE_COPY.privilegeCard.safetyNotice}
            </Text>
          </View>

          {/* Action Footer */}
          <View className="gap-space-sm pt-space-xs">
            <Button
              testID="profile-submit"
              variant="primary"
              size="lg"
              fullWidth
              loading={isSaving && Boolean(saveProfileMutation.variables?.submit)}
              disabled={isSaving}
              onPress={() => handleSave(true)}
            >
              {PROFILE_COPY.footer.submitButton}
            </Button>
            <Text variant="body-sm" className="text-secondary text-center">
              🛡 {PROFILE_COPY.footer.legalNotice}
            </Text>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
