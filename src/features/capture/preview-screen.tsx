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
  const [admitted, setAdmitted] = useState<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      active.current = true;
      let focused = true;
      let checkedRevision: string | null = null;
      const validate = () => {
        const current = session.snapshot().photo;
        if (
          focused &&
          AppState.currentState === 'active' &&
          current &&
          checkedRevision !== current.revision &&
          !session.snapshot().busy
        ) {
          checkedRevision = current.revision;
          void session.validate(current.revision).then((valid) => {
            if (focused && valid && session.snapshot().photo === current)
              setAdmitted(current.revision);
          });
        }
      };
      // Acquisition can finish after focus; also admit replacements on this mounted route.
      const unsubscribe = session.subscribe(validate);
      validate();
      const subscription = AppState.addEventListener('change', () => {
        checkedRevision = null;
        validate();
      });
      return () => {
        focused = false;
        active.current = false;
        unsubscribe();
        session.cancelPreparation();
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
          {admitted === photo.revision ? (
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
          ) : null}
          <Text tone="textSecondary">
            {photo.source === 'camera'
              ? 'Taken with your camera.'
              : 'Selected from your photo library.'}{' '}
            Kept only on this device for this session.
          </Text>
          {state.preparing ? <LoadingState label="Preparing photo…" /> : null}
          {state.prepared ? (
            <Text accessibilityRole="alert">
              Photo prepared on this device. Upload and recognition aren’t available yet. Enter your
              ingredients manually to continue.
            </Text>
          ) : null}
          <Button
            label={
              state.preparing ? 'Preparing photo…' : state.busy ? 'Checking photo…' : 'Use Photo'
            }
            accessibilityLabel="Use Photo"
            disabled={state.busy || loaded !== photo.revision || !!state.prepared}
            accessibilityState={{ busy: state.busy }}
            onPress={() => {
              void session.preparePhoto(photo.revision);
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
        onPress={() => {
          session.cancelPreparation();
          router.replace('/scans/gallery');
        }}
      />
      <ManualPhotoAction />
    </Screen>
  );
}
const styles = StyleSheet.create({ photo: { width: '100%', height: 360 } });
