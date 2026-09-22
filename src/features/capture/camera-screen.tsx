import { ManualPhotoAction } from './manual-action';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AppState, Linking, StyleSheet } from 'react-native';
import { Camera, CameraView } from 'expo-camera';
import { router, useFocusEffect } from 'expo-router';
import { Button } from '@/components/button';
import { ErrorState, LoadingState } from '@/components/feedback';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { CameraAccessController, captureSize } from './camera-access';
import { nativeCameraAvailable } from './photo-native';
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
  const active = useRef(false);
  const [foreground, setForeground] = useState(false);
  const [ready, setReady] = useState(false);
  const [pictureSize, setPictureSize] = useState<string | null>(null);
  const currentSize = useRef<string | null>(null);
  const epoch = useRef(0);
  const [mountId, setMountId] = useState(0);
  const [settingsError, setSettingsError] = useState(false);
  useFocusEffect(
    useCallback(() => {
      const update = () => {
        setMountId(++epoch.current);
        active.current = AppState.currentState === 'active';
        setForeground(active.current);
        setReady(false);
        currentSize.current = null;
        setPictureSize(null);
        session.cancelPending('camera');
        if (active.current && nativeCameraAvailable) void access.check();
        else if (!nativeCameraAvailable) access.unavailable();
        else access.suspend();
      };
      update();
      const subscription = AppState.addEventListener('change', update);
      return () => {
        epoch.current++;
        active.current = false;
        setForeground(false);
        setReady(false);
        session.cancelPending('camera');
        access.suspend();
        subscription.remove();
      };
    }, [access, session]),
  );
  const enabled = foreground && permission === 'granted';
  useEffect(() => {
    if (!enabled || ready) return;
    const timer = setTimeout(() => access.unavailable(), 15000);
    return () => clearTimeout(timer);
  }, [access, enabled, ready]);
  function currentMount() {
    return (
      active.current &&
      epoch.current === mountId &&
      currentSize.current === pictureSize &&
      access.snapshot() === 'granted'
    );
  }
  async function cameraReady() {
    if (!currentMount()) return;
    if (pictureSize) {
      setReady(true);
      return;
    }
    try {
      const sizes = await camera.current?.getAvailablePictureSizesAsync();
      if (!currentMount()) return;
      const size = captureSize(sizes ?? []);
      if (!size) {
        access.unavailable();
        return;
      }
      currentSize.current = size;
      setPictureSize(size);
    } catch {
      if (currentMount()) access.unavailable();
    }
  }
  async function capture() {
    const view = camera.current;
    if (!view || !active.current || !ready || permission !== 'granted') return;
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
    if (success && active.current) router.replace('/scans/preview');
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
            key={`${mountId}-${pictureSize ?? 'size-check'}`}
            ref={camera}
            style={styles.camera}
            facing="back"
            mode="picture"
            flash="off"
            enableTorch={false}
            pictureSize={pictureSize ?? undefined}
            mute
            onCameraReady={() => {
              void cameraReady();
            }}
            onMountError={() => {
              if (currentMount()) {
                setReady(false);
                session.cancelPending('camera');
                access.unavailable();
              }
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
      ) : permission === 'checking' ? (
        <LoadingState label="Checking camera access" />
      ) : permission === 'unavailable' ? (
        <ErrorState
          title="Camera unavailable"
          message="Use the photo library or enter ingredients manually. Camera capture requires the Android or iOS app and working camera hardware."
          retry={
            nativeCameraAvailable
              ? () => {
                  setMountId(++epoch.current);
                  currentSize.current = null;
                  setPictureSize(null);
                  setReady(false);
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
