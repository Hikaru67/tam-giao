import { useRef, useState } from 'react';
import { Button, Card, Text } from '@tamgiao/ui-mobile';
import { colors } from '@tamgiao/ui-tokens';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImageManipulator from 'expo-image-manipulator';
import { ActivityIndicator, Linking, View } from 'react-native';
import { KYC_MAX_IMAGE_SIDE, KYC_JPEG_COMPRESSION } from './constants.js';
import { KYC_COPY } from './copy.js';
import { deleteTempPhoto } from './temp-photo.js';
import { KYC_SLOT_CONFIG, type KycSlot } from './types.js';

export interface KycCameraProps {
  slot: KycSlot;
  /** Trả uri ảnh ĐÃ resize (ảnh gốc đã bị xoá). */
  onCaptured: (uri: string) => void;
  onCancel: () => void;
}

export function KycCamera({ slot, onCaptured, onCancel }: KycCameraProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!permission) {
    return (
      <View className="flex-1 items-center justify-center bg-surface">
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View className="flex-1 items-center justify-center p-space-md bg-surface gap-space-md">
        <Card className="gap-space-sm p-space-md bg-surface-container-low w-full">
          <Text variant="title-md" className="font-bold text-on-surface text-center">
            {KYC_COPY.camera.permissionTitle}
          </Text>
          <Text variant="body-sm" className="text-secondary text-center">
            {KYC_COPY.camera.permissionBody}
          </Text>
        </Card>
        {permission.canAskAgain ? (
          <Button
            testID="kyc-camera-grant"
            variant="primary"
            size="lg"
            fullWidth
            onPress={() => void requestPermission()}
          >
            {KYC_COPY.camera.permissionGrant}
          </Button>
        ) : (
          <Button
            testID="kyc-camera-open-settings"
            variant="primary"
            size="lg"
            fullWidth
            onPress={() => void Linking.openSettings()}
          >
            {KYC_COPY.camera.permissionOpenSettings}
          </Button>
        )}
        <Button testID="kyc-camera-cancel" variant="ghost" size="md" fullWidth onPress={onCancel}>
          {KYC_COPY.actions.cancel}
        </Button>
      </View>
    );
  }

  const handleShutter = async () => {
    if (isProcessing) return;
    setError(null);
    setIsProcessing(true);
    let photoUri: string | null = null;
    try {
      const photo = await cameraRef.current?.takePictureAsync({ quality: 1, exif: false });
      if (!photo?.uri) {
        setIsProcessing(false);
        return;
      }
      photoUri = photo.uri;
      const actions: ImageManipulator.Action[] = [];
      const { width, height } = photo;
      if (width && height) {
        if (width >= height && width > KYC_MAX_IMAGE_SIDE) {
          actions.push({ resize: { width: KYC_MAX_IMAGE_SIDE } });
        } else if (height > width && height > KYC_MAX_IMAGE_SIDE) {
          actions.push({ resize: { height: KYC_MAX_IMAGE_SIDE } });
        }
      }
      const resized = await ImageManipulator.manipulateAsync(photo.uri, actions, {
        compress: KYC_JPEG_COMPRESSION,
        format: ImageManipulator.SaveFormat.JPEG,
      });
      onCaptured(resized.uri);
    } catch {
      setError(KYC_COPY.camera.processError);
    } finally {
      if (photoUri) {
        deleteTempPhoto(photoUri);
      }
      setIsProcessing(false);
    }
  };

  return (
    <View className="flex-1 bg-inverse-surface">
      <CameraView ref={cameraRef} facing={KYC_SLOT_CONFIG[slot].facing} style={{ flex: 1 }} />
      <View className="absolute inset-0 justify-between p-space-md pointer-events-box-none">
        {/* Khung hướng dẫn phía trên */}
        <View className="pt-safe items-center">
          <View className="bg-inverse-surface/60 px-space-md py-space-xs rounded-full">
            <Text variant="label-md" className="text-inverse-on-surface text-center font-semibold">
              {KYC_COPY.camera.frameHint[slot]}
            </Text>
          </View>
          {error ? (
            <View className="mt-space-sm bg-error-container/90 px-space-md py-space-xs rounded-lg">
              <Text variant="body-sm" className="text-on-error-container text-center">
                {error}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Nút điều khiển phía dưới */}
        <View className="pb-safe flex-row items-center justify-around gap-space-md">
          <Button
            testID="kyc-camera-cancel"
            variant="ghost"
            size="md"
            onPress={onCancel}
            disabled={isProcessing}
            className="bg-inverse-surface/40"
          >
            {KYC_COPY.actions.cancel}
          </Button>
          <Button
            testID="kyc-camera-shutter"
            variant="primary"
            size="lg"
            loading={isProcessing}
            disabled={isProcessing}
            onPress={() => void handleShutter()}
          >
            {KYC_COPY.actions.shutter}
          </Button>
        </View>
      </View>
    </View>
  );
}
