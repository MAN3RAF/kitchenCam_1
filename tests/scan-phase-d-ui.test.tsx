import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppState, Linking, type AppStateStatus } from 'react-native';
import { Camera } from 'expo-camera';
import { router } from 'expo-router';
import { CameraScreen } from '@/features/capture/camera-screen';
import { GalleryScreen } from '@/features/capture/gallery-screen';
import { PreviewScreen } from '@/features/capture/preview-screen';
import { PhotoSession, type PhotoFiles } from '@/features/capture/photo-session';
import { usePhotoSession } from '@/features/capture/photo-provider';
import { choosePhoto, recoverPicker } from '@/features/capture/photo-native';

let mockCapture = jest.fn();
jest.mock('expo-camera', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const RN = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Camera: { getCameraPermissionsAsync: jest.fn(), requestCameraPermissionsAsync: jest.fn() },
    CameraView: React.forwardRef(function MockCamera(props: object, ref) {
      React.useImperativeHandle(ref, () => ({
        takePictureAsync: mockCapture,
        getAvailablePictureSizesAsync: async () => ['1920x1080', '8000x6000'],
      }));
      return <RN.View {...props} testID="native-camera" />;
    }),
  };
});
jest.mock('expo-image', () => {
  const RN = jest.requireActual<typeof import('react-native')>('react-native');
  return { Image: (props: object) => <RN.View {...props} testID="photo" /> };
});
jest.mock('expo-router', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return {
    router: { replace: jest.fn(), push: jest.fn() },
    useFocusEffect: (callback: () => void) => React.useEffect(callback, [callback]),
  };
});
jest.mock('@/components/screen', () => ({
  Screen: ({ children }: { children: ReactNode }) => children,
}));
jest.mock('@/features/capture/photo-provider', () => ({
  ...jest.requireActual('@/features/capture/photo-provider'),
  usePhotoSession: jest.fn(),
}));
jest.mock('@/features/capture/photo-native', () => ({
  nativePhotosAvailable: true,
  nativeCameraAvailable: true,
  choosePhoto: jest.fn(),
  recoverPicker: jest.fn(),
}));
jest.mock('@/features/scans/scan-provider', () => ({ useScanSession: () => null }));
jest.mock('@/features/auth/auth-provider', () => ({ useAuth: () => ({ user: null }) }));

const input = { uri: 'file:///local-fixture.jpg', width: 400, height: 800, mimeType: 'image/jpeg' };
let session: PhotoSession;
let files: jest.Mocked<PhotoFiles>;
let appChange: (state: AppStateStatus) => void;
beforeEach(() => {
  let revision = 0;
  files = {
    prepare: jest.fn(async (asset, source, id) => ({
      ...asset,
      mimeType: 'image/jpeg',
      revision: id,
      source,
      size: 32,
      selectedAt: '2026-09-22T00:00:00Z',
    })),
    readable: jest
      .fn<ReturnType<PhotoFiles['readable']>, Parameters<PhotoFiles['readable']>>()
      .mockResolvedValue(undefined),
    remove: jest
      .fn<ReturnType<PhotoFiles['remove']>, Parameters<PhotoFiles['remove']>>()
      .mockResolvedValue(undefined),
    releaseInput: jest
      .fn<ReturnType<PhotoFiles['releaseInput']>, Parameters<PhotoFiles['releaseInput']>>()
      .mockResolvedValue(undefined),
  };
  session = new PhotoSession(files, () => String(++revision));
  jest.mocked(usePhotoSession).mockReturnValue(session);
  AppState.currentState = 'active';
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    appChange = listener;
    return { remove: jest.fn() };
  });
  jest.mocked(Camera.getCameraPermissionsAsync).mockResolvedValue({
    granted: false,
    canAskAgain: true,
    status: 'undetermined',
    expires: 'never',
  } as Awaited<ReturnType<typeof Camera.getCameraPermissionsAsync>>);
  jest.mocked(Camera.requestCameraPermissionsAsync).mockResolvedValue({
    granted: true,
    canAskAgain: true,
    status: 'granted',
    expires: 'never',
  } as Awaited<ReturnType<typeof Camera.getCameraPermissionsAsync>>);
  jest.mocked(recoverPicker).mockResolvedValue(null);
  jest.mocked(choosePhoto).mockResolvedValue(input);
  mockCapture = jest.fn(async () => input);
});
async function press(label: string) {
  await fireEvent.press(screen.getByRole('button', { name: label }));
}
async function grant() {
  await screen.findByRole('button', { name: 'Allow camera access' });
  await press('Allow camera access');
  await fireEvent(screen.getByTestId('native-camera'), 'cameraReady');
  expect(screen.getByTestId('native-camera')).toHaveProp('pictureSize', '1920x1080');
  await fireEvent(screen.getByTestId('native-camera'), 'cameraReady');
}
test('camera purpose precedes explicit permission and successful still capture opens preview without params', async () => {
  await render(<CameraScreen />);
  await screen.findByRole('button', { name: 'Allow camera access' });
  expect(Camera.requestCameraPermissionsAsync).not.toHaveBeenCalled();
  expect(screen.getByText(/Camera access lets you take a still photo/)).toBeOnTheScreen();
  await grant();
  await press('Take photo');
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/scans/preview'));
  expect(mockCapture).toHaveBeenCalledWith({ base64: false, exif: false, skipProcessing: true });
  expect(session.snapshot().photo?.source).toBe('camera');
});
test('denied camera retains gallery/manual escape and allows another request', async () => {
  jest.mocked(Camera.requestCameraPermissionsAsync).mockResolvedValue({
    granted: false,
    canAskAgain: true,
    status: 'denied',
    expires: 'never',
  } as Awaited<ReturnType<typeof Camera.getCameraPermissionsAsync>>);
  await render(<CameraScreen />);
  await screen.findByRole('button', { name: 'Allow camera access' });
  await press('Allow camera access');
  expect(screen.getByRole('button', { name: 'Try camera permission again' })).toBeEnabled();
  await press('Photo Library');
  expect(router.replace).toHaveBeenCalledWith('/scans/gallery');
  await press('Enter Ingredients Manually');
  expect(router.replace).toHaveBeenCalledWith('/scans/manual');
});
test('permanent denial offers settings and no repeated permission prompt', async () => {
  jest.mocked(Camera.getCameraPermissionsAsync).mockResolvedValue({
    granted: false,
    canAskAgain: false,
    status: 'denied',
    expires: 'never',
  } as Awaited<ReturnType<typeof Camera.getCameraPermissionsAsync>>);
  const settings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
  await render(<CameraScreen />);
  await screen.findByRole('button', { name: 'Open Settings' });
  await press('Open Settings');
  expect(settings).toHaveBeenCalledTimes(1);
  expect(Camera.requestCameraPermissionsAsync).not.toHaveBeenCalled();
});
test('background unmounts camera and revoked permission on resume prevents reactivation', async () => {
  await render(<CameraScreen />);
  await grant();
  await act(async () => {
    AppState.currentState = 'background';
    appChange('background');
  });
  expect(screen.queryByTestId('native-camera')).toBeNull();
  jest.mocked(Camera.getCameraPermissionsAsync).mockResolvedValue({
    granted: false,
    canAskAgain: false,
    status: 'denied',
    expires: 'never',
  } as Awaited<ReturnType<typeof Camera.getCameraPermissionsAsync>>);
  await act(async () => {
    AppState.currentState = 'active';
    appChange('active');
  });
  expect(await screen.findByRole('button', { name: 'Open Settings' })).toBeOnTheScreen();
  expect(screen.queryByTestId('native-camera')).toBeNull();
});
test('unavailable hardware removes capture controls and offers alternatives', async () => {
  await render(<CameraScreen />);
  await grant();
  await fireEvent(screen.getByTestId('native-camera'), 'mountError', {
    message: 'private internal error',
  });
  expect(screen.getByText('Camera unavailable')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Take photo' })).toBeNull();
  expect(screen.queryByText('private internal error')).toBeNull();
});
test('unmounted capture cannot navigate later and repeated taps call native once', async () => {
  let resolve!: (value: typeof input) => void;
  mockCapture.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const view = await render(<CameraScreen />);
  await grant();
  await press('Take photo');
  await press('Take photo');
  expect(mockCapture).toHaveBeenCalledTimes(1);
  await view.unmount();
  await act(async () => resolve(input));
  expect(router.replace).not.toHaveBeenCalled();
  expect(session.snapshot().photo).toBeNull();
});
test('gallery explicit choice selects one local photo and opens preview', async () => {
  await render(<GalleryScreen />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Choose photo' })).toBeEnabled());
  expect(choosePhoto).not.toHaveBeenCalled();
  await press('Choose photo');
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/scans/preview'));
  expect(session.snapshot().photo?.source).toBe('gallery');
});
test('Android recovered picker selection opens preview without launching a second picker', async () => {
  jest.mocked(recoverPicker).mockResolvedValue(input);
  await render(<GalleryScreen />);
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/scans/preview'));
  expect(choosePhoto).not.toHaveBeenCalled();
});
test('picker cancellation leaves a usable gallery screen', async () => {
  jest.mocked(choosePhoto).mockResolvedValue(null);
  await render(<GalleryScreen />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Choose photo' })).toBeEnabled());
  await press('Choose photo');
  expect(router.replace).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Choose photo' })).toBeEnabled();
});
test('preview preserves aspect ratio and Use Photo shows honest local-only boundary', async () => {
  await session.acquire('gallery', async () => input);
  await render(<PreviewScreen />);
  expect(screen.getByTestId('photo')).toHaveProp('contentFit', 'contain');
  expect(screen.getByTestId('photo')).toHaveProp('source', { uri: input.uri });
  expect(screen.getByRole('button', { name: 'Use Photo' })).toBeDisabled();
  await fireEvent(screen.getByTestId('photo'), 'load');
  await press('Use Photo');
  expect(await screen.findByText(/Photo selected. Photo preparation/)).toBeOnTheScreen();
  expect(files.remove).not.toHaveBeenCalled();
  expect(router.replace).not.toHaveBeenCalled();
});
test.each([
  ['Retake', '/scans/camera', true],
  ['Choose Another', '/scans/gallery', false],
  ['Enter Ingredients Manually', '/scans/manual', true],
] as const)(
  'preview %s navigates safely with appropriate file lifetime',
  async (label, route, removes) => {
    await session.acquire('camera', async () => input);
    await render(<PreviewScreen />);
    await press(label);
    expect(router.replace).toHaveBeenCalledWith(route);
    expect(files.remove.mock.calls.length > 0).toBe(removes);
  },
);
test('a removed local file and a direct preview reload both offer safe recovery', async () => {
  await session.acquire('camera', async () => input);
  files.readable.mockRejectedValue(new Error('private file URI'));
  const view = await render(<PreviewScreen />);
  expect(await screen.findByText(/This photo can’t be opened/)).toBeOnTheScreen();
  expect(screen.queryByTestId('photo')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Use Photo' })).toBeNull();
  await view.unmount();
  await render(<PreviewScreen />);
  expect(screen.getByRole('button', { name: 'Retake' })).toBeEnabled();
});
