import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { CameraAcquisitionController } from './camera-acquisition';
import { traceCameraAcquisition } from './camera-diagnostics';
import type { CameraAccessController } from './camera-access';
import type { PhotoSession } from './photo-session';

export function useCameraAcquisition(
  access: CameraAccessController,
  session: PhotoSession,
  supported: boolean,
) {
  const acquisition = useMemo(() => new CameraAcquisitionController(traceCameraAcquisition), []);
  const state = useSyncExternalStore(
    acquisition.subscribe,
    acquisition.snapshot,
    acquisition.snapshot,
  );
  useFocusEffect(
    useCallback(() => {
      let foreground = false;
      const syncPermission = () => {
        if (foreground && supported && access.snapshot() === 'granted') acquisition.start();
        else {
          acquisition.suspend();
          session.cancelPending('camera');
        }
      };
      const unsubscribe = access.subscribe(syncPermission);
      const update = () => {
        const active = AppState.currentState === 'active';
        if (active === foreground) return;
        foreground = active;
        acquisition.suspend();
        session.cancelPending('camera');
        if (!active) access.suspend();
        else if (supported) void access.check();
        else access.unavailable();
      };
      update();
      const subscription = AppState.addEventListener('change', update);
      return () => {
        foreground = false;
        unsubscribe();
        subscription.remove();
        acquisition.suspend();
        session.cancelPending('camera');
        access.suspend();
      };
    }, [access, acquisition, session, supported]),
  );
  useEffect(() => {
    if (state.phase === 'mounting') acquisition.mounted(state.generation);
    if (state.phase !== 'releasing') return;
    // This effect runs after a commit with NO CameraView. Yield a JS task so native
    // teardown can run before mounting a replacement; no warm-up sleep or polling.
    // Expo exposes no native camera-release acknowledgement.
    const task = setTimeout(() => acquisition.retryAfterUnmount(state.generation), 0);
    return () => clearTimeout(task);
  }, [acquisition, state.generation, state.phase]);
  return { acquisition, state };
}
