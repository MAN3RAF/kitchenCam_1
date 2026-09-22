import { CameraAccessController, captureSize } from '@/features/capture/camera-access';
import {
  PhotoSession,
  PhotoError,
  type PhotoFiles,
  type PhotoInput,
  type LocalPhoto,
} from '@/features/capture/photo-session';

const input: PhotoInput = {
  uri: 'file:///fixture.jpg',
  width: 400,
  height: 600,
  mimeType: 'image/jpeg',
};
test('camera requests a supported bounded still resolution without image resizing', () => {
  expect(captureSize(['Photo', '8000x6000', '4000x3000', '1920x1080'])).toBe('4000x3000');
  expect(captureSize(['Photo', 'High', '8000x6000'])).toBeNull();
});
const descriptor = (revision: string): LocalPhoto => ({
  ...input,
  mimeType: 'image/jpeg',
  revision,
  source: 'camera',
  size: 100,
  selectedAt: '2026-09-22T00:00:00Z',
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { resolve, reject, promise };
}
let files: jest.Mocked<PhotoFiles>;
let session: PhotoSession;
beforeEach(() => {
  let id = 0;
  files = {
    prepare: jest.fn(async (_input, source, revision) => ({ ...descriptor(revision), source })),
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
  session = new PhotoSession(files, () => String(++id));
});
test('local session does not invoke media or permissions until explicitly selected', () => {
  expect(session.snapshot().photo).toBeNull();
  expect(files.prepare).not.toHaveBeenCalled();
});
test.each(['camera', 'gallery'] as const)(
  '%s produces a file descriptor, preserving provenance and no image body',
  async (source) => {
    expect(await session.acquire(source, async () => input)).toBe(true);
    expect(session.snapshot().photo).toEqual({ ...descriptor('1'), source });
    expect(files.releaseInput).toHaveBeenCalledWith(input, source);
  },
);
test('rapid duplicate captures invoke native capture once', async () => {
  const pending = deferred<PhotoInput>();
  const capture = jest.fn(() => pending.promise);
  const first = session.acquire('camera', capture);
  expect(await session.acquire('camera', capture)).toBe(false);
  pending.resolve(input);
  await first;
  expect(capture).toHaveBeenCalledTimes(1);
});
test('blur or background fences a late capture and cleans only its input', async () => {
  const pending = deferred<PhotoInput>();
  const first = session.acquire('camera', () => pending.promise);
  session.cancelPending('camera');
  const anotherCapture = jest.fn(async () => input);
  expect(await session.acquire('camera', anotherCapture)).toBe(false);
  expect(anotherCapture).not.toHaveBeenCalled();
  pending.resolve(input);
  expect(await first).toBe(false);
  expect(session.snapshot().photo).toBeNull();
  expect(files.prepare).not.toHaveBeenCalled();
  expect(files.releaseInput).toHaveBeenCalledWith(input, 'camera');
});
test('late preparation cannot replace newer photo and cleans obsolete copy', async () => {
  const pending = deferred<LocalPhoto>();
  files.prepare.mockReturnValueOnce(pending.promise);
  const old = session.acquire('camera', async () => input);
  await Promise.resolve();
  session.discard();
  await session.acquire('gallery', async () => input);
  pending.resolve(descriptor('1'));
  expect(await old).toBe(false);
  expect(session.snapshot().photo?.revision).toBe('2');
  expect(files.remove).toHaveBeenCalledWith(descriptor('1'));
});
test('picker cancellation keeps previous preview and active file', async () => {
  await session.acquire('camera', async () => input);
  expect(await session.acquire('gallery', async () => null)).toBe(false);
  expect(session.snapshot().photo?.revision).toBe('1');
  expect(files.remove).not.toHaveBeenCalled();
});
test('replacing a photo cleans the old owned copy, never the active copy', async () => {
  await session.acquire('camera', async () => input);
  await session.acquire('gallery', async () => input);
  expect(files.remove).toHaveBeenCalledTimes(1);
  expect(files.remove).toHaveBeenCalledWith(descriptor('1'));
});
test('abandon/manual/retake removes descriptor and fences late rejection', async () => {
  await session.acquire('camera', async () => input);
  const pending = deferred<PhotoInput>();
  const second = session.acquire('gallery', () => pending.promise);
  session.discard();
  pending.reject(new Error('private native details'));
  await second;
  expect(session.snapshot()).toEqual({ photo: null, busy: false, error: null, accepted: false });
  expect(files.remove).toHaveBeenCalledWith(descriptor('1'));
});
test('failed preparation cleans native temporary input and shows only safe copy', async () => {
  files.prepare.mockRejectedValue(new PhotoError('UNSUPPORTED'));
  await session.acquire('gallery', async () => input);
  expect(session.snapshot().error).toMatch(/JPEG/);
  expect(files.releaseInput).toHaveBeenCalledWith(input, 'gallery');
});
test('Use Photo checks readability, stores acceptance, and leaves active photo intact', async () => {
  await session.acquire('camera', async () => input);
  expect(await session.validate('1', true)).toBe(true);
  expect(session.snapshot().accepted).toBe(true);
  expect(files.readable).toHaveBeenCalledWith(descriptor('1'));
  expect(files.remove).not.toHaveBeenCalled();
});
test('disappeared local file clears preview with safe error', async () => {
  await session.acquire('camera', async () => input);
  files.readable.mockRejectedValue(new Error('private URI'));
  expect(await session.validate('1', true)).toBe(false);
  expect(session.snapshot().photo).toBeNull();
  expect(session.snapshot().error).toBe(new PhotoError('UNREADABLE').message);
  expect(session.snapshot().busy).toBe(false);
});
test('stale image events and validation cannot accept or remove a newer photo', async () => {
  await session.acquire('camera', async () => input);
  const pending = deferred<void>();
  files.readable.mockReturnValue(pending.promise);
  const validation = session.validate('1', true);
  session.discard();
  await session.acquire('gallery', async () => input);
  pending.resolve();
  expect(await validation).toBe(false);
  session.failPreview('1');
  expect(session.snapshot().photo?.revision).toBe('2');
  expect(session.snapshot().accepted).toBe(false);
});
test('camera blur does not cancel a subsequent preview validation', async () => {
  await session.acquire('camera', async () => input);
  const promise = session.validate('1', true);
  session.cancelPending('camera');
  expect(await promise).toBe(true);
});
test.each([
  [{ granted: false, canAskAgain: true, status: 'undetermined' }, 'request'],
  [{ granted: false, canAskAgain: true, status: 'denied' }, 'denied'],
  [{ granted: false, canAskAgain: false, status: 'denied' }, 'settings'],
  [{ granted: true, canAskAgain: true, status: 'granted' }, 'granted'],
] as const)('permission read distinguishes %s without prompting', async (permission, expected) => {
  const api = { get: jest.fn(async () => permission), request: jest.fn(async () => permission) };
  const access = new CameraAccessController(api);
  await access.check();
  expect(access.snapshot()).toBe(expected);
  expect(api.request).not.toHaveBeenCalled();
  await access.check(true);
  expect(api.request).toHaveBeenCalledTimes(1);
});
test('permission revocation after resume replaces prior grant', async () => {
  const api = {
    get: jest
      .fn()
      .mockResolvedValueOnce({ granted: true })
      .mockResolvedValueOnce({ granted: false, canAskAgain: false }),
    request: jest.fn(),
  };
  const access = new CameraAccessController(api);
  await access.check();
  access.suspend();
  await access.check();
  expect(access.snapshot()).toBe('settings');
});
test('late permission response after blur cannot reactivate camera', async () => {
  const pending = deferred<{ granted: boolean; canAskAgain: boolean; status: string }>();
  const access = new CameraAccessController({
    get: () => pending.promise,
    request: () => pending.promise,
  });
  const request = access.check();
  access.suspend();
  pending.resolve({ granted: true, canAskAgain: true, status: 'granted' });
  await request;
  expect(access.snapshot()).toBe('checking');
});
test('permission API failure is a safe unavailable state', async () => {
  const access = new CameraAccessController({
    get: async () => {
      throw new Error('native');
    },
    request: jest.fn(),
  });
  await access.check();
  expect(access.snapshot()).toBe('unavailable');
});
