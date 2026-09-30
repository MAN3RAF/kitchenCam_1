import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppState, Linking, Platform, type AppStateStatus } from 'react-native';
import { Camera } from 'expo-camera';
import { router } from 'expo-router';
import { CameraScreen } from '@/features/capture/camera-screen';
import { GalleryScreen } from '@/features/capture/gallery-screen';
import { PreviewScreen } from '@/features/capture/preview-screen';
import { PhotoSession, type PhotoFiles } from '@/features/capture/photo-session';
import { usePhotoSession } from '@/features/capture/photo-provider';
import { choosePhoto, recoverPicker } from '@/features/capture/photo-native';
import { CAMERA_STARTUP_TIMEOUT_MS } from '@/features/capture/camera-acquisition';

let mockCapture = jest.fn();
let mockFocused = true;
let mockCameraMounts = 0;
let mockLiveCameras = 0;
let mockMaxLiveCameras = 0;
const mockPictureSizes = jest.fn();
jest.mock('expo-camera', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const RN = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Camera: { getCameraPermissionsAsync: jest.fn(), requestCameraPermissionsAsync: jest.fn() },
    CameraView: React.forwardRef(function MockCamera(props: object, ref) {
      React.useEffect(() => {
        mockCameraMounts++;
        mockLiveCameras++;
        mockMaxLiveCameras = Math.max(mockMaxLiveCameras, mockLiveCameras);
        return () => {
          mockLiveCameras--;
        };
      }, []);
      React.useImperativeHandle(ref, () => ({
        takePictureAsync: mockCapture,
        getAvailablePictureSizesAsync: mockPictureSizes,
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
    useFocusEffect: (callback: () => void) => {
      const focused = mockFocused;
      React.useEffect(() => (focused ? callback() : undefined), [callback, focused]);
    },
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
jest.mock('@/features/capture/preparation-files', () => ({ activatePreparationCache: jest.fn() }));
jest.mock('@/features/scans/scan-provider', () => ({ useScanSession: () => null }));
jest.mock('@/features/auth/auth-provider', () => ({ useAuth: () => ({ user: null }) }));

const input = { uri: 'file:///local-fixture.jpg', width: 400, height: 800, mimeType: 'image/jpeg' };
let session: PhotoSession;
let files: jest.Mocked<PhotoFiles>;
let appChange: (state: AppStateStatus) => void;
beforeEach(() => {
  mockFocused = true;
  mockCameraMounts = 0;
  mockLiveCameras = 0;
  mockMaxLiveCameras = 0;
  jest.spyOn(console, 'info').mockImplementation(() => {});
  mockPictureSizes.mockResolvedValue(['8000x6000', '4000x3000', '1920x1080']);
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
  session = new PhotoSession(files, () => String(++revision), {
    admit: async () => {},
    prepare: async (photo, id) => ({
      uri: 'file:///prepared.jpg',
      width: 400,
      height: 800,
      size: 32,
      mimeType: 'image/jpeg',
      revision: id,
      sourceRevision: photo.revision,
      appOwned: true,
    }),
    remove: async () => {},
  });
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
  await waitFor(() => expect(screen.getByTestId('native-camera')).toBeOnTheScreen());
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
  expect(await screen.findByText(/Photo prepared on this device/)).toBeOnTheScreen();
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

describe('physical camera acquisition lifecycle', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.mocked(Camera.getCameraPermissionsAsync).mockResolvedValue({
      granted: true,
      canAskAgain: true,
      status: 'granted',
      expires: 'never',
    } as Awaited<ReturnType<typeof Camera.getCameraPermissionsAsync>>);
  });
  afterEach(() => jest.useRealTimers());
  async function advance(ms: number) {
    await act(async () => jest.advanceTimersByTime(ms));
  }
  async function appState(state: AppStateStatus) {
    await act(async () => {
      AppState.currentState = state;
      appChange(state);
    });
  }
  test('iOS waits for its original ready event without Android size selection or remounting', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    await render(<CameraScreen />);
    expect(screen.getByRole('button', { name: 'Take photo' })).toBeDisabled();
    expect(mockCameraMounts).toBe(1);
    const view = screen.getByTestId('native-camera');
    expect(view).toHaveProp('facing', 'back');
    for (const prop of ['pictureSize', 'mode', 'flash', 'enableTorch', 'mute', 'active'])
      expect(view.props[prop]).toBeUndefined();
    await press('Take photo');
    expect(mockCapture).not.toHaveBeenCalled();
    await advance(CAMERA_STARTUP_TIMEOUT_MS - 1);
    expect(screen.getByRole('button', { name: 'Take photo' })).toBeDisabled();
    await fireEvent(view, 'cameraReady');
    expect(screen.getByRole('button', { name: 'Take photo' })).toBeEnabled();
    await advance(CAMERA_STARTUP_TIMEOUT_MS * 3);
    expect(mockCameraMounts).toBe(1);
    expect(mockPictureSizes).not.toHaveBeenCalled();
  });
  test('Android bounds native capture size without replacing the camera view or accepting stale readiness', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const view = await render(<CameraScreen />);
    const initialReady = screen.getByTestId('native-camera').props.onCameraReady;
    await fireEvent(screen.getByTestId('native-camera'), 'cameraReady');
    expect(mockPictureSizes).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('native-camera')).toHaveProp('pictureSize', '4000x3000');
    expect(mockCameraMounts).toBe(1);
    expect(screen.getByRole('button', { name: 'Take photo' })).toBeDisabled();
    await act(async () => initialReady());
    expect(screen.getByRole('button', { name: 'Take photo' })).toBeDisabled();
    await fireEvent(screen.getByTestId('native-camera'), 'cameraReady');
    expect(screen.getByRole('button', { name: 'Take photo' })).toBeEnabled();
    await press('Take photo');
    expect(router.replace).toHaveBeenLastCalledWith('/scans/preview');
    expect(mockLiveCameras).toBe(0);
    await view.rerender(<PreviewScreen />);
    expect(await screen.findByTestId('photo')).toBeOnTheScreen();
    await press('Retake');
    await view.rerender(<CameraScreen />);
    expect(screen.getByTestId('native-camera').props.pictureSize).toBeUndefined();
    await fireEvent(screen.getByTestId('native-camera'), 'cameraReady');
    await fireEvent(screen.getByTestId('native-camera'), 'cameraReady');
    expect(screen.getByRole('button', { name: 'Take photo' })).toBeEnabled();
    expect(mockCameraMounts).toBe(2);
    expect(mockMaxLiveCameras).toBe(1);
  });
  test('timeout commits an unmount, retries once, and ignores old ready and error callbacks', async () => {
    await render(<CameraScreen />);
    const old = screen.getByTestId('native-camera').props;
    await advance(CAMERA_STARTUP_TIMEOUT_MS);
    expect(screen.queryByTestId('native-camera')).toBeNull();
    expect(mockLiveCameras).toBe(0);
    expect(screen.getByText('Reopening camera')).toBeOnTheScreen();
    await act(async () => old.onCameraReady());
    expect(screen.queryByTestId('native-camera')).toBeNull();
    await advance(1);
    expect(mockCameraMounts).toBe(2);
    expect(screen.getByRole('button', { name: 'Take photo' })).toBeDisabled();
    await act(async () => {
      old.onCameraReady();
      old.onMountError({ message: 'late failure' });
    });
    expect(screen.getByRole('button', { name: 'Take photo' })).toBeDisabled();
    await fireEvent(screen.getByTestId('native-camera'), 'cameraReady');
    expect(screen.getByRole('button', { name: 'Take photo' })).toBeEnabled();
    await advance(CAMERA_STARTUP_TIMEOUT_MS * 3);
    expect(mockCameraMounts).toBe(2);
    expect(mockMaxLiveCameras).toBe(1);
  });
  test('two startup timeouts end in safe unavailable UI with no automatic loop', async () => {
    await render(<CameraScreen />);
    await advance(CAMERA_STARTUP_TIMEOUT_MS);
    await advance(1);
    await advance(CAMERA_STARTUP_TIMEOUT_MS);
    expect(screen.getByText('Camera unavailable')).toBeOnTheScreen();
    expect(screen.queryByTestId('native-camera')).toBeNull();
    expect(screen.getByRole('button', { name: 'Photo Library' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Enter Ingredients Manually' })).toBeEnabled();
    await advance(CAMERA_STARTUP_TIMEOUT_MS * 100);
    expect(mockCameraMounts).toBe(2);
  });
  test('route blur cancels startup and late callbacks; refocus starts unready', async () => {
    const view = await render(<CameraScreen />);
    const oldReady = screen.getByTestId('native-camera').props.onCameraReady;
    mockFocused = false;
    await view.rerender(<CameraScreen />);
    expect(screen.queryByTestId('native-camera')).toBeNull();
    await act(async () => oldReady());
    await advance(CAMERA_STARTUP_TIMEOUT_MS * 3);
    expect(mockCameraMounts).toBe(1);
    mockFocused = true;
    await view.rerender(<CameraScreen />);
    expect(mockCameraMounts).toBe(2);
    expect(screen.getByRole('button', { name: 'Take photo' })).toBeDisabled();
  });
  test('background during initialization cancels startup and resume requires fresh readiness', async () => {
    await render(<CameraScreen />);
    const oldReady = screen.getByTestId('native-camera').props.onCameraReady;
    await appState('background');
    expect(screen.queryByTestId('native-camera')).toBeNull();
    await advance(CAMERA_STARTUP_TIMEOUT_MS * 3);
    await appState('active');
    await act(async () => oldReady());
    expect(mockCameraMounts).toBe(2);
    expect(screen.getByRole('button', { name: 'Take photo' })).toBeDisabled();
    await fireEvent(screen.getByTestId('native-camera'), 'cameraReady');
    expect(screen.getByRole('button', { name: 'Take photo' })).toBeEnabled();
  });
  test('permission revoked in Settings during initialization prevents remount and stale readiness', async () => {
    await render(<CameraScreen />);
    const oldReady = screen.getByTestId('native-camera').props.onCameraReady;
    await appState('background');
    jest.mocked(Camera.getCameraPermissionsAsync).mockResolvedValue({
      granted: false,
      canAskAgain: false,
      status: 'denied',
      expires: 'never',
    } as Awaited<ReturnType<typeof Camera.getCameraPermissionsAsync>>);
    await appState('active');
    await act(async () => oldReady());
    await advance(CAMERA_STARTUP_TIMEOUT_MS * 3);
    expect(screen.queryByTestId('native-camera')).toBeNull();
    expect(screen.getByRole('button', { name: 'Open Settings' })).toBeEnabled();
    expect(mockCameraMounts).toBe(1);
  });
  test('background during retry release cancels the queued retry', async () => {
    await render(<CameraScreen />);
    await advance(CAMERA_STARTUP_TIMEOUT_MS);
    await appState('background');
    await advance(CAMERA_STARTUP_TIMEOUT_MS * 3);
    expect(screen.queryByTestId('native-camera')).toBeNull();
    expect(mockCameraMounts).toBe(1);
  });
  test('duplicate active notifications do not interrupt an opening camera', async () => {
    await render(<CameraScreen />);
    await appState('active');
    await appState('active');
    expect(mockCameraMounts).toBe(1);
    expect(Camera.getCameraPermissionsAsync).toHaveBeenCalledTimes(1);
  });
  test('capture → Preview → Retake releases the old view and acquires a fresh unready instance', async () => {
    const view = await render(<CameraScreen />);
    const oldReady = screen.getByTestId('native-camera').props.onCameraReady;
    const oldError = screen.getByTestId('native-camera').props.onMountError;
    await fireEvent(screen.getByTestId('native-camera'), 'cameraReady');
    await press('Take photo');
    expect(router.replace).toHaveBeenLastCalledWith('/scans/preview');
    expect(screen.queryByTestId('native-camera')).toBeNull();
    expect(mockLiveCameras).toBe(0);
    await view.rerender(<PreviewScreen />);
    await press('Retake');
    expect(router.replace).toHaveBeenLastCalledWith('/scans/camera');
    await view.rerender(<CameraScreen />);
    await act(async () => oldReady());
    expect(mockCameraMounts).toBe(2);
    expect(mockMaxLiveCameras).toBe(1);
    expect(screen.getByRole('button', { name: 'Take photo' })).toBeDisabled();
    await fireEvent(screen.getByTestId('native-camera'), 'cameraReady');
    expect(screen.getByRole('button', { name: 'Take photo' })).toBeEnabled();
    let finish!: (value: typeof input) => void;
    mockCapture.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await press('Take photo');
    await act(async () => oldError({ message: 'late error from replaced route' }));
    expect(session.snapshot().busy).toBe(true);
    await act(async () => finish(input));
    expect(router.replace).toHaveBeenLastCalledWith('/scans/preview');
    expect(session.snapshot().photo?.source).toBe('camera');
    expect(router.push).not.toHaveBeenCalled();
  });
});
