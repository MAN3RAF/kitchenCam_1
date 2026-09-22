import { StrictMode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { usePathname } from 'expo-router';
import { Button } from '@/components/button';
import { Text } from '@/components/text';
import { useAuth } from '@/features/auth/auth-provider';
import { PhotoProvider, usePhotoSession, usePhotoState } from '@/features/capture/photo-provider';
import { photoFiles } from '@/features/capture/photo-native';
import type { PhotoFiles } from '@/features/capture/photo-session';

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
const input = { uri: 'file:///fixture.jpg', width: 1, height: 1, mimeType: 'image/jpeg' };
function Probe() {
  const session = usePhotoSession();
  const state = usePhotoState(session);
  return (
    <>
      <Text>{state.photo ? 'Photo in memory' : 'Empty session'}</Text>
      <Button
        label="Select fixture"
        onPress={() => {
          void session.acquire('gallery', async () => input);
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
beforeEach(() => {
  jest.mocked(usePathname).mockReturnValue('/scans/gallery');
  jest.mocked(useAuth).mockReturnValue({ user: null } as ReturnType<typeof useAuth>);
  const files = jest.mocked(photoFiles);
  files.prepare.mockImplementation(async (asset, source, revision) => ({
    ...asset,
    source,
    revision,
    mimeType: 'image/jpeg',
    size: 1,
    selectedAt: new Date().toISOString(),
  }));
  files.remove.mockResolvedValue();
  files.releaseInput.mockResolvedValue();
  files.readable.mockResolvedValue();
});
test('Strict Mode and camera/preview transitions retain an active file until leaving photo routes', async () => {
  const view = await render(<Tree />);
  await fireEvent.press(screen.getByRole('button', { name: 'Select fixture' }));
  expect(await screen.findByText('Photo in memory')).toBeOnTheScreen();
  jest.mocked(usePathname).mockReturnValue('/scans/preview');
  await view.rerender(<Tree />);
  expect(screen.getByText('Photo in memory')).toBeOnTheScreen();
  expect(photoFiles.remove).not.toHaveBeenCalled();
  jest.mocked(usePathname).mockReturnValue('/scans/manual');
  await view.rerender(<Tree />);
  expect(screen.getByText('Empty session')).toBeOnTheScreen();
  expect(photoFiles.remove).toHaveBeenCalledTimes(1);
});
test('unmount abandons and cleans the active app-owned copy', async () => {
  const view = await render(<Tree />);
  await fireEvent.press(screen.getByRole('button', { name: 'Select fixture' }));
  await view.unmount();
  await act(async () => {
    await Promise.resolve();
  });
  expect(photoFiles.remove).toHaveBeenCalledTimes(1);
});
test('identity change fences late import while same-ID session refresh retains local photo', async () => {
  let resolve!: (value: Awaited<ReturnType<PhotoFiles['prepare']>>) => void;
  jest.mocked(photoFiles.prepare).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const view = await render(<Tree />);
  await fireEvent.press(screen.getByRole('button', { name: 'Select fixture' }));
  const user = { id: 'fixture-owner' } as NonNullable<ReturnType<typeof useAuth>['user']>;
  jest.mocked(useAuth).mockReturnValue({ user } as ReturnType<typeof useAuth>);
  await view.rerender(<Tree />);
  await act(async () =>
    resolve({
      ...input,
      source: 'gallery',
      revision: 'stale',
      size: 1,
      selectedAt: '2026-09-22T00:00:00Z',
    }),
  );
  expect(screen.getByText('Empty session')).toBeOnTheScreen();
  expect(photoFiles.remove).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole('button', { name: 'Select fixture' }));
  jest
    .mocked(useAuth)
    .mockReturnValue({ user: { ...user, is_anonymous: false } } as ReturnType<typeof useAuth>);
  await view.rerender(<Tree />);
  expect(screen.getByText('Photo in memory')).toBeOnTheScreen();
});
