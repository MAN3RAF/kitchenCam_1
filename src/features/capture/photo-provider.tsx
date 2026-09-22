import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  useSyncExternalStore,
  type PropsWithChildren,
} from 'react';
import { AppState } from 'react-native';
import { usePathname } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { useAuth } from '@/features/auth/auth-provider';
import { PhotoSession } from './photo-session';
import { activatePhotoCache, photoFiles, retryPhotoCleanup } from './photo-native';

const PhotoContext = createContext<PhotoSession | null>(null);
export function PhotoProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  return <PhotoScope key={user?.id ?? 'local'}>{children}</PhotoScope>;
}
function PhotoScope({ children }: PropsWithChildren) {
  const path = usePathname();
  const [session] = useState(() => new PhotoSession(photoFiles, randomUUID));
  const attached = useRef<PhotoSession | null>(null);
  useEffect(() => {
    attached.current = session;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') retryPhotoCleanup();
    });
    activatePhotoCache();
    return () => {
      attached.current = null;
      subscription.remove();
      // React Strict Mode reconnect does not abandon a live route.
      queueMicrotask(() => {
        if (attached.current !== session) session.discard();
      });
    };
  }, [session]);
  useEffect(() => {
    if (!['/scans/camera', '/scans/gallery', '/scans/preview'].includes(path)) session.discard();
  }, [path, session]);
  return <PhotoContext.Provider value={session}>{children}</PhotoContext.Provider>;
}
export function usePhotoSession() {
  const session = useContext(PhotoContext);
  if (!session) throw new Error('Photo session is unavailable.');
  return session;
}
export function usePhotoState(session: PhotoSession) {
  return useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);
}
