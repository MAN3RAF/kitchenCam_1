import { ManualPhotoAction } from './manual-action';
import { useCallback, useRef, useState } from 'react';
import { AppState, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { Button } from '@/components/button';
import { LoadingState } from '@/components/feedback';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { usePhotoSession, usePhotoState } from './photo-provider';

export function PreviewScreen() {
  const session = usePhotoSession();
  const state = usePhotoState(session);
  const photo = state.photo;
  const active = useRef(false);
  const [loaded, setLoaded] = useState<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      active.current = true;
      const validate = () => {
        const current = session.snapshot().photo;
        if (AppState.currentState === 'active' && current) void session.validate(current.revision);
      };
      validate();
      const subscription = AppState.addEventListener('change', validate);
      return () => {
        active.current = false;
        subscription.remove();
      };
    }, [session]),
  );
  return (
    <Screen>
      <Text variant="title" accessibilityRole="header">
        Your photo
      </Text>
      {photo ? (
        <>
          {loaded !== photo.revision ? <LoadingState label="Opening your photo" /> : null}
          <Image
            key={photo.revision}
            source={{ uri: photo.uri }}
            contentFit="contain"
            cachePolicy="none"
            transition={0}
            accessibilityLabel="Selected ingredient photo"
            accessible
            style={styles.photo}
            onLoad={() => {
              if (active.current && session.snapshot().photo?.revision === photo.revision)
                setLoaded(photo.revision);
            }}
            onError={() => {
              if (active.current) session.failPreview(photo.revision);
            }}
          />
          <Text tone="textSecondary">
            {photo.source === 'camera'
              ? 'Taken with your camera.'
              : 'Selected from your photo library.'}{' '}
            Kept only on this device for this session.
          </Text>
          {state.accepted ? (
            <Text accessibilityRole="alert">
              Photo selected. Photo preparation and recognition aren’t available yet. Enter your
              ingredients manually to continue.
            </Text>
          ) : null}
          <Button
            label={state.busy ? 'Checking photo…' : 'Use Photo'}
            accessibilityLabel="Use Photo"
            disabled={state.busy || loaded !== photo.revision || state.accepted}
            accessibilityState={{ busy: state.busy }}
            onPress={() => {
              void session.validate(photo.revision, true);
            }}
          />
        </>
      ) : (
        <Text>No photo is available. Retake it or choose another photo.</Text>
      )}
      {state.error ? <Text accessibilityRole="alert">{state.error}</Text> : null}
      <Button
        label="Retake"
        variant="secondary"
        onPress={() => {
          session.discard();
          router.replace('/scans/camera');
        }}
      />
      <Button
        label="Choose Another"
        variant="secondary"
        onPress={() => router.replace('/scans/gallery')}
      />
      <ManualPhotoAction />
    </Screen>
  );
}
const styles = StyleSheet.create({ photo: { width: '100%', height: 360 } });
