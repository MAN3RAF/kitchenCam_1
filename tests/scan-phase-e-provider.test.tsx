import { StrictMode } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { usePathname } from 'expo-router';
import { Button } from '@/components/button';
import { Text } from '@/components/text';
import { useAuth } from '@/features/auth/auth-provider';
import { PhotoProvider, usePhotoSession, usePhotoState } from '@/features/capture/photo-provider';
import { photoFiles } from '@/features/capture/photo-native';
import { photoPreparation } from '@/features/capture/preparation-files';
import type { PreparedPhoto } from '@/features/capture/preparation-policy';

jest.mock('expo-router', () => ({ usePathname: jest.fn() }));
jest.mock('expo-crypto', () => ({
  randomUUID: () => jest.requireActual<typeof import('node:crypto')>('node:crypto').randomUUID(),
}));
jest.mock('@/features/auth/auth-provider', () => ({ useAuth: jest.fn() }));
jest.mock('@/features/capture/photo-native', () => ({
  activatePhotoCache: jest.fn(),
  retryPhotoCleanup: jest.fn(),
  photoFiles: {
    prepare: jest.fn(),
    remove: jest.fn(),
    releaseInput: jest.fn(),
    readable: jest.fn(),
  },
}));
jest.mock('@/features/capture/preparation-files', () => ({
  activatePreparationCache: jest.fn(),
  photoPreparation: { prepare: jest.fn(), remove: jest.fn(), admit: jest.fn() },
}));
const input = { uri: 'file:///working.jpg', width: 800, height: 600, mimeType: 'image/jpeg' };
function Probe() {
  const session = usePhotoSession();
  const state = usePhotoState(session);
  return (
    <>
      <Text>
        {state.prepared
          ? 'Prepared'
          : state.preparing
            ? 'Preparing'
            : state.photo
              ? 'Source'
              : 'Empty'}
      </Text>
      <Button
        label="Select"
        onPress={() => {
          void session.acquire('gallery', async () => input);
        }}
      />
      <Button
        label="Prepare"
        onPress={() => {
          if (state.photo) void session.preparePhoto(state.photo.revision);
        }}
      />
    </>
  );
}
function Tree() {
  return (
    <StrictMode>
      <PhotoProvider>
        <Probe />
      </PhotoProvider>
    </StrictMode>
  );
}
let finish: () => void;
let output: PreparedPhoto;
let change: (state: AppStateStatus) => void;
beforeEach(() => {
  jest.mocked(usePathname).mockReturnValue('/scans/preview');
  jest.mocked(useAuth).mockReturnValue({ user: null } as ReturnType<typeof useAuth>);
  AppState.currentState = 'active';
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    change = listener;
    return { remove: jest.fn() };
  });
  jest.mocked(photoFiles.prepare).mockImplementation(async (asset, source, revision) => ({
    ...asset,
    mimeType: 'image/jpeg',
    source,
    revision,
    size: 50,
    selectedAt: 'fixture',
  }));
  jest.mocked(photoFiles.remove).mockResolvedValue();
  jest.mocked(photoFiles.releaseInput).mockResolvedValue();
  jest.mocked(photoPreparation.remove).mockResolvedValue();
  jest.mocked(photoPreparation.prepare).mockImplementation(
    (source, revision) =>
      new Promise((resolve) => {
        output = {
          uri: `file:///prepared/${revision}.jpg`,
          width: 800,
          height: 600,
          size: 50,
          mimeType: 'image/jpeg',
          revision,
          sourceRevision: source.revision,
          appOwned: true,
        };
        finish = () => resolve(output);
      }),
  );
});
async function start() {
  const view = await render(<Tree />);
  await fireEvent.press(screen.getByRole('button', { name: 'Select' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Prepare' }));
  expect(screen.getByText('Preparing')).toBeOnTheScreen();
  return view;
}
test.each(['route', 'account', 'unmount'])(
  'provider %s change fences native completion and cleans after it settles',
  async (event) => {
    const view = await start();
    if (event === 'route') {
      jest.mocked(usePathname).mockReturnValue('/scans/manual');
      await view.rerender(<Tree />);
    } else if (event === 'account') {
      jest
        .mocked(useAuth)
        .mockReturnValue({ user: { id: 'next-owner' } } as ReturnType<typeof useAuth>);
      await view.rerender(<Tree />);
    } else await view.unmount();
    expect(photoFiles.remove).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(photoPreparation.remove).toHaveBeenCalledWith(output);
    expect(photoFiles.remove).toHaveBeenCalledTimes(1);
    if (event !== 'unmount') expect(screen.getByText('Empty')).toBeOnTheScreen();
  },
);
test('background cancellation preserves the source and removes late output', async () => {
  await start();
  await act(async () => {
    AppState.currentState = 'background';
    change('background');
  });
  expect(screen.getByText('Source')).toBeOnTheScreen();
  await act(async () => finish());
  expect(photoFiles.remove).not.toHaveBeenCalled();
  expect(photoPreparation.remove).toHaveBeenCalledWith(output);
});
test('Strict Mode reconnect and photo-route transitions preserve current prepared output', async () => {
  const view = await start();
  await act(async () => finish());
  jest.mocked(usePathname).mockReturnValue('/scans/gallery');
  await view.rerender(<Tree />);
  expect(screen.getByText('Prepared')).toBeOnTheScreen();
  expect(photoPreparation.remove).not.toHaveBeenCalled();
  await view.unmount();
  expect(photoPreparation.remove).toHaveBeenCalledWith(output);
  expect(photoFiles.remove).toHaveBeenCalledTimes(1);
});
