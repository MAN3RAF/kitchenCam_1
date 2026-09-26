import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { AppState } from 'react-native';
import { PreviewScreen } from '@/features/capture/preview-screen';
import { PhotoSession, type PhotoFiles } from '@/features/capture/photo-session';
import { usePhotoSession } from '@/features/capture/photo-provider';
import {
  PreparationError,
  type PhotoPreparation,
  type PreparedPhoto,
} from '@/features/capture/preparation-policy';

jest.mock('expo-router', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return {
    router: { replace: jest.fn() },
    useFocusEffect: (fn: () => void) => React.useEffect(fn, [fn]),
  };
});
jest.mock('expo-image', () => {
  const RN = jest.requireActual<typeof import('react-native')>('react-native');
  return { Image: (props: object) => <RN.View {...props} testID="photo" /> };
});
jest.mock('@/components/screen', () => ({
  Screen: ({ children }: { children: import('react').ReactNode }) => children,
}));
jest.mock('@/features/capture/photo-provider', () => ({
  ...jest.requireActual('@/features/capture/photo-provider'),
  usePhotoSession: jest.fn(),
}));
jest.mock('@/features/capture/preparation-files', () => ({ activatePreparationCache: jest.fn() }));
jest.mock('@/features/scans/scan-provider', () => ({ useScanSession: () => null }));
const input = { uri: 'file:///source.jpg', width: 800, height: 600, mimeType: 'image/jpeg' };
let session: PhotoSession;
let preparation: jest.Mocked<PhotoPreparation>;
beforeEach(async () => {
  AppState.currentState = 'active';
  let id = 0;
  const files: PhotoFiles = {
    prepare: async (asset, source, revision) => ({
      ...asset,
      mimeType: 'image/jpeg',
      source,
      revision,
      size: 100,
      selectedAt: 'fixture',
    }),
    readable: async () => {},
    remove: async () => {},
    releaseInput: async () => {},
  };
  preparation = {
    admit: jest.fn<Promise<void>, Parameters<PhotoPreparation['admit']>>().mockResolvedValue(),
    remove: jest.fn<Promise<void>, Parameters<PhotoPreparation['remove']>>().mockResolvedValue(),
    prepare: jest.fn<Promise<PreparedPhoto>, Parameters<PhotoPreparation['prepare']>>(
      async (source, revision) => ({
        uri: 'file:///prepared.jpg',
        width: 800,
        height: 600,
        size: 50,
        mimeType: 'image/jpeg',
        revision,
        sourceRevision: source.revision,
        appOwned: true,
      }),
    ),
  };
  session = new PhotoSession(files, () => String(++id), preparation);
  jest.mocked(usePhotoSession).mockReturnValue(session);
  await session.acquire('gallery', async () => input);
});
async function preview() {
  const view = await render(<PreviewScreen />);
  await fireEvent(await screen.findByTestId('photo'), 'load');
  return view;
}
test('pre-decode admission blocks preview image mounting', async () => {
  let finish!: () => void;
  preparation.admit.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render(<PreviewScreen />);
  expect(screen.queryByTestId('photo')).toBeNull();
  expect(screen.getByRole('button', { name: 'Use Photo' })).toBeDisabled();
  await act(async () => finish());
  expect(await screen.findByTestId('photo')).toBeOnTheScreen();
});
test.each(['SOURCE_TOO_LARGE', 'PIXEL_LIMIT', 'UNSUPPORTED', 'UNREADABLE'] as const)(
  '%s admission fails before preview decode with recovery actions',
  async (code) => {
    preparation.admit.mockRejectedValueOnce(new PreparationError(code));
    await render(<PreviewScreen />);
    expect(await screen.findByText(new PreparationError(code).message)).toBeOnTheScreen();
    expect(screen.queryByTestId('photo')).toBeNull();
    expect(screen.getByRole('button', { name: 'Choose Another' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Enter Ingredients Manually' })).toBeEnabled();
  },
);
test('Use Photo announces preparation, fences repeated taps and shows local success', async () => {
  let finish!: (photo: PreparedPhoto) => void;
  preparation.prepare.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await preview();
  await fireEvent.press(screen.getByRole('button', { name: 'Use Photo' }));
  expect(screen.getByRole('button', { name: 'Use Photo' })).toBeDisabled();
  expect(screen.getAllByText('Preparing photo…').length).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: 'Retake' })).toBeEnabled();
  await fireEvent.press(screen.getByRole('button', { name: 'Use Photo' }));
  expect(preparation.prepare).toHaveBeenCalledTimes(1);
  await act(async () =>
    finish({
      uri: 'file:///prepared.jpg',
      width: 800,
      height: 600,
      size: 50,
      mimeType: 'image/jpeg',
      revision: '2',
      sourceRevision: '1',
      appOwned: true,
    }),
  );
  expect(await screen.findByText(/Photo prepared on this device/)).toBeOnTheScreen();
  expect(router.replace).not.toHaveBeenCalled();
});
test.each(['INVALID', 'OUTPUT_TOO_LARGE', 'UNAVAILABLE'] as const)(
  '%s preparation keeps retry and manual recovery',
  async (code) => {
    preparation.prepare.mockRejectedValueOnce(new PreparationError(code));
    await preview();
    await fireEvent.press(screen.getByRole('button', { name: 'Use Photo' }));
    expect(await screen.findByText(new PreparationError(code).message)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Use Photo' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Enter Ingredients Manually' })).toBeEnabled();
  },
);
test.each(['Retake', 'Choose Another', 'Enter Ingredients Manually', 'unmount'])(
  '%s fences late preparation from preview',
  async (action) => {
    let finish!: (photo: PreparedPhoto) => void;
    preparation.prepare.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = await preview();
    await fireEvent.press(screen.getByRole('button', { name: 'Use Photo' }));
    if (action === 'unmount') await view.unmount();
    else await fireEvent.press(screen.getByRole('button', { name: action }));
    await act(async () =>
      finish({
        uri: 'file:///prepared.jpg',
        width: 800,
        height: 600,
        size: 50,
        mimeType: 'image/jpeg',
        revision: '2',
        sourceRevision: '1',
        appOwned: true,
      }),
    );
    expect(session.snapshot().prepared).toBeNull();
    expect(preparation.remove).toHaveBeenCalledTimes(1);
  },
);

test('a replacement on the mounted preview is admitted before displaying it', async () => {
  await preview();
  await act(async () => {
    await session.acquire('gallery', async () => ({ ...input, uri: 'file:///replacement.jpg' }));
  });
  expect(preparation.admit).toHaveBeenCalledTimes(2);
  expect(await screen.findByTestId('photo')).toHaveProp('source', {
    uri: 'file:///replacement.jpg',
  });
  expect(screen.getByRole('button', { name: 'Use Photo' })).toBeDisabled();
  await fireEvent(screen.getByTestId('photo'), 'load');
  expect(screen.getByRole('button', { name: 'Use Photo' })).toBeEnabled();
});

test('focus during acquisition admits the source after asynchronous input cleanup finishes', async () => {
  let finish!: () => void;
  session.discard();
  const pending = session.acquire(
    'gallery',
    () =>
      new Promise((resolve) => {
        finish = () => resolve(input);
      }),
  );
  await render(<PreviewScreen />);
  expect(screen.queryByTestId('photo')).toBeNull();
  await act(async () => {
    finish();
    await pending;
  });
  expect(await screen.findByTestId('photo')).toBeOnTheScreen();
  expect(preparation.admit).toHaveBeenCalledTimes(1);
});
