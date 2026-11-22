import { useState } from 'react';
import { isApiError, messageFor } from '@tamgiao/api-client';
import { Badge, Button, Card, OtpInput, Text } from '@tamgiao/ui-mobile';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { MOBILE_ENV } from '../../env.js';
import { DATA_RIGHTS_COPY } from './copy.js';
import { useAccountDeletionFlow } from './use-account-deletion.js';
import { useDataExportFlow } from './use-data-export.js';

type DataRightsViewMode = 'main' | 'warning' | 'otp' | 'progress';

export function DataRightsScreen() {
  const router = useRouter();
  const [mode, setMode] = useState<DataRightsViewMode>('main');
  const [hasConfirmedCheckbox, setHasConfirmedCheckbox] = useState(false);
  const [otpCode, setOtpCode] = useState('');

  // Luồng xuất dữ liệu
  const { currentExport, isRequesting, requestExport } = useDataExportFlow();

  // Luồng xoá tài khoản
  const {
    deletionView,
    requestOtp,
    isRequestingOtp,
    requestOtpError,
    deleteAccount,
    isDeleting,
    deleteError,
  } = useAccountDeletionFlow();

  // Mở trình duyệt tải file dữ liệu
  const handleDownload = async (downloadUrl: string | null) => {
    if (!downloadUrl) return;
    const fullUrl =
      downloadUrl.startsWith('http://') || downloadUrl.startsWith('https://')
        ? downloadUrl
        : `${MOBILE_ENV.apiUrl}${downloadUrl.startsWith('/') ? '' : '/'}${downloadUrl}`;
    await WebBrowser.openBrowserAsync(fullUrl);
  };

  // Yêu cầu OTP và chuyển sang màn nhập OTP
  const handleProceedToOtp = async () => {
    if (!hasConfirmedCheckbox || isRequestingOtp) return;
    try {
      await requestOtp();
      setMode('otp');
    } catch {
      // lỗi yêu cầu OTP
    }
  };

  // Xác nhận xoá với mã OTP
  const handleConfirmDelete = async (code: string) => {
    if (code.length !== 6 || isDeleting) return;
    try {
      await deleteAccount(code);
      setMode('progress');
    } catch {
      // Khi lỗi, vẫn ở màn OTP (AC: OTP sai → thông điệp, vẫn ở màn OTP)
    }
  };

  // Lấy thông điệp lỗi thân thiện tiếng Việt
  const activeDeleteError = deleteError ?? requestOtpError;
  const deleteErrorMessage = activeDeleteError
    ? isApiError(activeDeleteError)
      ? messageFor({
          code: activeDeleteError.code,
          status: activeDeleteError.status,
          meta: activeDeleteError.meta,
        }).title
      : messageFor({ code: 'HTTP_5xx' }).title
    : null;

  return (
    <ScrollView className="flex-1 bg-surface px-margin pt-safe pb-safe">
      <View className="py-space-md gap-space-lg max-w-md mx-auto w-full">
        {/* Chế độ 1: Màn hình chính quyền dữ liệu (Xuất dữ liệu & Nút Xoá tài khoản) */}
        {mode === 'main' ? (
          <>
            <View className="flex-row items-center gap-space-sm pb-space-xs">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Quay lại"
                onPress={() => router.back()}
                className="p-space-xs rounded-full"
              >
                <Text variant="title-md" className="text-primary font-semibold">
                  {DATA_RIGHTS_COPY.backButton}
                </Text>
              </Pressable>
            </View>

            <View className="gap-space-xs">
              <Text variant="headline-sm" className="font-bold text-on-surface">
                {DATA_RIGHTS_COPY.headerTitle}
              </Text>
              <Text variant="body-md" className="text-secondary">
                {DATA_RIGHTS_COPY.legalNotice}
              </Text>
            </View>

            {/* Khối 1: Xuất dữ liệu cá nhân */}
            <Card className="gap-space-md">
              <View className="gap-space-xs">
                <Text variant="headline-sm" className="font-bold text-on-surface">
                  {DATA_RIGHTS_COPY.export.cardTitle}
                </Text>
                <Text variant="body-md" className="text-secondary">
                  {DATA_RIGHTS_COPY.export.description}
                </Text>
              </View>

              {!currentExport ? (
                <Button
                  variant="primary"
                  loading={isRequesting}
                  onPress={() => requestExport()}
                  accessibilityLabel={DATA_RIGHTS_COPY.export.requestButton}
                >
                  {DATA_RIGHTS_COPY.export.requestButton}
                </Button>
              ) : null}

              {/* Trạng thái PENDING: đang dựng file */}
              {currentExport?.status === 'PENDING' ? (
                <View className="bg-surface-container-low p-space-md rounded-lg gap-space-sm items-center">
                  <ActivityIndicator size="small" />
                  <Text variant="title-md" className="font-semibold text-on-surface text-center">
                    {DATA_RIGHTS_COPY.export.pendingTitle}
                  </Text>
                  <Text variant="body-sm" className="text-secondary text-center">
                    {DATA_RIGHTS_COPY.export.pendingDesc}
                  </Text>
                </View>
              ) : null}

              {/* Trạng thái READY: sẵn sàng tải về */}
              {currentExport?.status === 'READY' ? (
                <View className="bg-secondary-container/20 border border-secondary-container p-space-md rounded-lg gap-space-sm">
                  <Badge tone="success" className="self-start">
                    {DATA_RIGHTS_COPY.export.readyTitle}
                  </Badge>
                  <Text variant="body-sm" className="text-on-surface">
                    {DATA_RIGHTS_COPY.export.readyDesc}
                  </Text>
                  <Text variant="body-sm" className="text-secondary font-medium">
                    {DATA_RIGHTS_COPY.export.expiryNotice}
                  </Text>
                  <Button
                    variant="primary"
                    onPress={() => handleDownload(currentExport.downloadUrl)}
                    accessibilityLabel={DATA_RIGHTS_COPY.export.downloadButton}
                  >
                    {DATA_RIGHTS_COPY.export.downloadButton}
                  </Button>
                </View>
              ) : null}

              {/* Trạng thái EXPIRED: đã hết hạn */}
              {currentExport?.status === 'EXPIRED' ? (
                <View className="bg-surface-container-low p-space-md rounded-lg gap-space-sm">
                  <Text variant="title-md" className="font-semibold text-error">
                    {DATA_RIGHTS_COPY.export.expiredTitle}
                  </Text>
                  <Text variant="body-sm" className="text-secondary">
                    {DATA_RIGHTS_COPY.export.expiredDesc}
                  </Text>
                  <Button
                    variant="secondary"
                    loading={isRequesting}
                    onPress={() => requestExport()}
                    accessibilityLabel={DATA_RIGHTS_COPY.export.retryButton}
                  >
                    {DATA_RIGHTS_COPY.export.retryButton}
                  </Button>
                </View>
              ) : null}
            </Card>

            {/* Khối 2: Xoá tài khoản */}
            <Card className="gap-space-md border-error/30">
              <View className="gap-space-xs">
                <Text variant="headline-sm" className="font-bold text-error">
                  {DATA_RIGHTS_COPY.deleteAccount.cardTitle}
                </Text>
                <Text variant="body-md" className="text-secondary">
                  {DATA_RIGHTS_COPY.deleteAccount.cardDesc}
                </Text>
              </View>

              <Button
                variant="danger"
                onPress={() => setMode('warning')}
                accessibilityLabel={DATA_RIGHTS_COPY.deleteAccount.startDeletionButton}
              >
                {DATA_RIGHTS_COPY.deleteAccount.startDeletionButton}
              </Button>
            </Card>
          </>
        ) : null}

        {/* Chế độ 2: Cảnh báo hệ quả xoá tài khoản (có câu không hoàn phí xác thực) */}
        {mode === 'warning' ? (
          <>
            <View className="flex-row items-center gap-space-sm pb-space-xs">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Quay lại"
                onPress={() => setMode('main')}
                className="p-space-xs rounded-full"
              >
                <Text variant="title-md" className="text-primary font-semibold">
                  {DATA_RIGHTS_COPY.backButton}
                </Text>
              </Pressable>
            </View>

            <View className="gap-space-xs">
              <Text variant="headline-sm" className="font-bold text-error">
                {DATA_RIGHTS_COPY.deleteAccount.warningHeader}
              </Text>
              <Text variant="body-md" className="text-secondary">
                {DATA_RIGHTS_COPY.deleteAccount.warningSubheader}
              </Text>
            </View>

            <Card className="gap-space-md border-error/40 bg-error-container/10">
              <View className="gap-space-sm">
                {DATA_RIGHTS_COPY.deleteAccount.consequences.map((item, idx) => (
                  <View key={idx} className="flex-row gap-space-xs items-start">
                    <Text variant="body-md" className="text-error font-bold">
                      •
                    </Text>
                    <Text variant="body-md" className="flex-1 text-on-surface">
                      {item}
                    </Text>
                  </View>
                ))}
              </View>

              <View className="p-space-sm bg-surface-container rounded-lg">
                <Text variant="body-sm" className="font-semibold text-error">
                  {DATA_RIGHTS_COPY.deleteAccount.noRefundNotice}
                </Text>
              </View>

              {/* Checkbox xác nhận */}
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: hasConfirmedCheckbox }}
                accessibilityLabel={DATA_RIGHTS_COPY.deleteAccount.confirmCheckbox}
                onPress={() => setHasConfirmedCheckbox(!hasConfirmedCheckbox)}
                className="flex-row items-start gap-space-sm pt-space-xs"
              >
                <View
                  className={`w-6 h-6 rounded border items-center justify-center mt-0.5 ${
                    hasConfirmedCheckbox ? 'bg-primary border-primary' : 'border-outline bg-surface'
                  }`}
                >
                  {hasConfirmedCheckbox ? (
                    <Text variant="label-sm" className="text-on-primary font-bold">
                      ✓
                    </Text>
                  ) : null}
                </View>
                <Text variant="body-md" className="flex-1 text-on-surface font-medium">
                  {DATA_RIGHTS_COPY.deleteAccount.confirmCheckbox}
                </Text>
              </Pressable>
            </Card>

            <View className="gap-space-sm pt-space-xs">
              <Button
                variant="danger"
                disabled={!hasConfirmedCheckbox || isRequestingOtp}
                loading={isRequestingOtp}
                onPress={handleProceedToOtp}
                accessibilityLabel={DATA_RIGHTS_COPY.deleteAccount.proceedToOtpButton}
              >
                {DATA_RIGHTS_COPY.deleteAccount.proceedToOtpButton}
              </Button>
              <Button
                variant="ghost"
                onPress={() => setMode('main')}
                accessibilityLabel={DATA_RIGHTS_COPY.deleteAccount.cancelButton}
              >
                {DATA_RIGHTS_COPY.deleteAccount.cancelButton}
              </Button>
            </View>
          </>
        ) : null}

        {/* Chế độ 3: Nhập OTP xác thực xoá */}
        {mode === 'otp' ? (
          <>
            <View className="flex-row items-center gap-space-sm pb-space-xs">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Quay lại"
                onPress={() => setMode('warning')}
                className="p-space-xs rounded-full"
              >
                <Text variant="title-md" className="text-primary font-semibold">
                  {DATA_RIGHTS_COPY.deleteAccount.backToWarning}
                </Text>
              </Pressable>
            </View>

            <View className="gap-space-xs">
              <Text variant="headline-sm" className="font-bold text-on-surface">
                {DATA_RIGHTS_COPY.deleteAccount.otpHeader}
              </Text>
              <Text variant="body-md" className="text-secondary">
                {DATA_RIGHTS_COPY.deleteAccount.otpSubheader}
              </Text>
            </View>

            <View className="items-center gap-space-md py-space-sm">
              <OtpInput
                autoFocus
                disabled={isDeleting}
                accessibilityLabel={DATA_RIGHTS_COPY.deleteAccount.otpInputLabel}
                onComplete={(code) => {
                  setOtpCode(code);
                  void handleConfirmDelete(code);
                }}
              />

              {deleteErrorMessage ? (
                <View
                  accessibilityRole="alert"
                  className="bg-error-container/30 border border-error p-space-sm rounded-lg w-full"
                >
                  <Text variant="body-sm" className="text-error text-center font-medium">
                    {deleteErrorMessage}
                  </Text>
                </View>
              ) : null}

              <Button
                variant="danger"
                fullWidth
                disabled={otpCode.length !== 6 || isDeleting}
                loading={isDeleting}
                onPress={() => handleConfirmDelete(otpCode)}
                accessibilityLabel={DATA_RIGHTS_COPY.deleteAccount.confirmDeleteButton}
              >
                {DATA_RIGHTS_COPY.deleteAccount.confirmDeleteButton}
              </Button>
            </View>
          </>
        ) : null}

        {/* Chế độ 4: Tiến độ xoá tài khoản */}
        {mode === 'progress' ? (
          <>
            <View className="gap-space-xs pt-space-md">
              <Text variant="headline-sm" className="font-bold text-on-surface">
                {DATA_RIGHTS_COPY.deleteAccount.progressHeader}
              </Text>
              <Text variant="body-md" className="text-secondary">
                {DATA_RIGHTS_COPY.deleteAccount.progressSubheader}
              </Text>
            </View>

            <Card className="gap-space-md">
              <View className="flex-row items-center justify-between pb-space-xs">
                <Text variant="title-md" className="font-bold text-on-surface">
                  Trạng thái
                </Text>
                <Badge tone={deletionView?.status === 'COMPLETED' ? 'success' : 'warning'}>
                  {deletionView?.status === 'COMPLETED'
                    ? DATA_RIGHTS_COPY.deleteAccount.statusCompleted
                    : DATA_RIGHTS_COPY.deleteAccount.statusProcessing}
                </Badge>
              </View>

              {/* Các bước xử lý của từng module */}
              <View className="divide-y divide-surface-container">
                {deletionView?.steps?.map((step) => (
                  <View key={step.module} className="py-space-sm flex-row items-center justify-between">
                    <Text variant="body-md" className="font-medium text-on-surface">
                      {step.module}
                    </Text>
                    <Badge tone={step.done ? 'success' : 'neutral'}>
                      {step.done
                        ? DATA_RIGHTS_COPY.deleteAccount.stepDone
                        : DATA_RIGHTS_COPY.deleteAccount.stepPending}
                    </Badge>
                  </View>
                ))}
              </View>

              <View className="p-space-sm bg-surface-container rounded-lg mt-space-xs">
                <Text variant="body-sm" className="text-secondary text-center">
                  {DATA_RIGHTS_COPY.deleteAccount.sessionRevokedNote}
                </Text>
              </View>
            </Card>

            <View className="pt-space-md">
              <Button
                variant="primary"
                fullWidth
                onPress={() => router.replace('/(auth)/phone')}
                accessibilityLabel={DATA_RIGHTS_COPY.deleteAccount.returnToLoginButton}
              >
                {DATA_RIGHTS_COPY.deleteAccount.returnToLoginButton}
              </Button>
            </View>
          </>
        ) : null}
      </View>
    </ScrollView>
  );
}
