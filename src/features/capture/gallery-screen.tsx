import { ManualPhotoAction } from './manual-action';
import { useCallback, useRef } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { Button } from '@/components/button';
import { LoadingState } from '@/components/feedback';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { choosePhoto, nativePhotosAvailable, recoverPicker } from './photo-native';
import { usePhotoSession, usePhotoState } from './photo-provider';

export function GalleryScreen() {
  const session = usePhotoSession();
  const state = usePhotoState(session);
  const active = useRef(false);
  // Check Android's recovered result before offering a new picker. No automatic picker launch.
  useFocusEffect(
    useCallback(() => {
      let focused = true;
      active.current = true;
      // Defer until Strict Mode's effect reconnect completes; pending Android results are consumed once.
      queueMicrotask(() => {
        if (!focused) return;
        void session.acquire('gallery', recoverPicker).then((success) => {
          if (success && focused) router.replace('/scans/preview');
        });
      });
      return () => {
        focused = false;
        active.current = false;
        session.cancelPending('gallery');
      };
    }, [session]),
  );
  async function choose() {
    const success = await session.acquire('gallery', choosePhoto);
    if (success && active.current) router.replace('/scans/preview');
  }
  return (
    <Screen>
      <Text variant="title" accessibilityRole="header">
        Choose an ingredient photo
      </Text>
      <Text tone="textSecondary">
        Select one JPEG, PNG, or still WebP photo. Your original stays unchanged, and no photo
        leaves this device.
      </Text>
      {!nativePhotosAvailable ? (
        <Text>
          Photo selection is available in the Android and iOS app. You can enter ingredients
          manually here.
        </Text>
      ) : null}
      {state.busy ? <LoadingState label="Waiting for your photo" /> : null}
      {state.error ? <Text accessibilityRole="alert">{state.error}</Text> : null}
      <Button
        label="Choose photo"
        disabled={state.busy || !nativePhotosAvailable}
        onPress={() => {
          void choose();
        }}
      />
      {state.photo ? (
        <Button
          label="Back to preview"
          variant="secondary"
          disabled={state.busy}
          onPress={() => router.replace('/scans/preview')}
        />
      ) : null}
      <Button
        label="Camera"
        variant="secondary"
        onPress={() => {
          session.discard();
          router.replace('/scans/camera');
        }}
      />
      <ManualPhotoAction />
    </Screen>
  );
}
