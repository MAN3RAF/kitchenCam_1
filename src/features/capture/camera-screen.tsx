import { ManualPhotoAction } from './manual-action';
import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Linking, Platform, StyleSheet } from 'react-native';
import { Camera, CameraView } from 'expo-camera';
import { router } from 'expo-router';
import { Button } from '@/components/button';
import { ErrorState, LoadingState } from '@/components/feedback';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { CameraAccessController } from './camera-access';
import { nativeCameraAvailable } from './photo-native';
import { useCameraAcquisition } from './use-camera-acquisition';
import { usePhotoSession, usePhotoState } from './photo-provider';

export function CameraScreen() {
  const session = usePhotoSession();
  const photo = usePhotoState(session);
  const access = useMemo(
    () =>
      new CameraAccessController({
        get: Camera.getCameraPermissionsAsync,
        request: Camera.requestCameraPermissionsAsync,
      }),
    [],
  );
  const permission = useSyncExternalStore(access.subscribe, access.snapshot, access.snapshot);
  const camera = useRef<CameraView>(null);
  const [settingsError, setSettingsError] = useState(false);
  const { acquisition, state } = useCameraAcquisition(access, session, nativeCameraAvailable);
  const { generation } = state;
  const enabled = ['mounting', 'initializing', 'selecting-size', 'configuring', 'ready'].includes(
    state.phase,
  );
  const ready = state.phase === 'ready';
  async function capture() {
    const view = camera.current;
    if (!view || !acquisition.isReady(generation) || access.snapshot() !== 'granted') return;
    const success = await session.acquire('camera', async () => {
      const result = await view.takePictureAsync({
        base64: false,
        exif: false,
        skipProcessing: true,
      });
      return {
        uri: result.uri,
        width: result.width,
        height: result.height,
        mimeType: 'image/jpeg',
      };
    });
    if (success && acquisition.isReady(generation)) {
      acquisition.suspend();
      router.replace('/scans/preview');
    }
  }
  return (
    <Screen>
      <Text variant="title" accessibilityRole="header">
        Photograph your ingredients
      </Text>
      <Text tone="textSecondary">
        Camera access lets you take a still photo. Your photo stays on this device. Recognition
        isn’t available yet.
      </Text>
      {enabled ? (
        <>
          <CameraView
            key={generation}
            ref={camera}
            style={styles.camera}
            facing="back"
            pictureSize={state.pictureSize}
            onCameraReady={() => {
              const view = camera.current;
              if (Platform.OS === 'android') {
                if (!view) return;
                void acquisition.readyWithSize(generation, state.pictureSize, () =>
                  view.getAvailablePictureSizesAsync(),
                );
              } else acquisition.ready(generation);
            }}
            onMountError={() => {
              if (acquisition.fail(generation, 'mount-error')) session.cancelPending('camera');
            }}
            accessible={false}
          />
          {!ready ? <LoadingState label="Opening camera" /> : null}
          <Button
            label={photo.busy ? 'Taking photo…' : 'Take photo'}
            accessibilityLabel="Take photo"
            accessibilityState={{ busy: photo.busy }}
            disabled={!ready || photo.busy}
            onPress={() => {
              void capture();
            }}
          />
        </>
      ) : state.phase === 'releasing' ? (
        <LoadingState label="Reopening camera" />
      ) : permission === 'checking' ? (
        <LoadingState label="Checking camera access" />
      ) : state.phase === 'failed' || permission === 'unavailable' ? (
        <ErrorState
          title="Camera unavailable"
          message="Use the photo library or enter ingredients manually. Camera capture requires the Android or iOS app and working camera hardware."
          retry={
            nativeCameraAvailable
              ? () => {
                  void access.check();
                }
              : undefined
          }
        />
      ) : (
        <>
          <Text>
            {permission === 'settings'
              ? 'Camera access is turned off. You can allow it in your device settings.'
              : permission === 'denied'
                ? 'Camera access was declined. You can try again, choose a photo, or enter ingredients manually.'
                : 'Allow camera access when you’re ready to take a photo.'}
          </Text>
          {permission === 'settings' ? (
            <Button
              label="Open Settings"
              onPress={() => {
                void Linking.openSettings().catch(() => setSettingsError(true));
              }}
            />
          ) : (
            <Button
              label={
                permission === 'denied' ? 'Try camera permission again' : 'Allow camera access'
              }
              onPress={() => {
                void access.check(true);
              }}
            />
          )}
          {settingsError ? (
            <Text accessibilityRole="alert">Open your device settings to allow camera access.</Text>
          ) : null}
        </>
      )}
      {photo.error ? <Text accessibilityRole="alert">{photo.error}</Text> : null}
      <Button
        label="Photo Library"
        variant="secondary"
        onPress={() => router.replace('/scans/gallery')}
      />
      <ManualPhotoAction />
    </Screen>
  );
}
const styles = StyleSheet.create({ camera: { width: '100%', aspectRatio: 3 / 4, maxHeight: 480 } });
