import { PhotoSession, type LocalPhoto, type PhotoFiles } from '@/features/capture/photo-session';
import {
  PreparationError,
  type PhotoPreparation,
  type PreparedPhoto,
} from '@/features/capture/preparation-policy';

const input = { uri: 'file:///fixture.jpg', width: 800, height: 600, mimeType: 'image/jpeg' };
const output = (source: LocalPhoto, revision: string): PreparedPhoto => ({
  uri: `file:///prepared/${revision}.jpg`,
  width: 800,
  height: 600,
  size: 100,
  mimeType: 'image/jpeg',
  revision,
  sourceRevision: source.revision,
  appOwned: true,
});
let files: jest.Mocked<PhotoFiles>;
let preparation: jest.Mocked<PhotoPreparation>;
let session: PhotoSession;
beforeEach(() => {
  let id = 0;
  files = {
    prepare: jest.fn(async (asset, source, revision) => ({
      ...asset,
      mimeType: 'image/jpeg',
      source,
      revision,
      size: 100,
      selectedAt: 'fixture',
    })),
    readable: jest.fn<Promise<void>, Parameters<PhotoFiles['readable']>>().mockResolvedValue(),
    remove: jest.fn<Promise<void>, Parameters<PhotoFiles['remove']>>().mockResolvedValue(),
    releaseInput: jest
      .fn<Promise<void>, Parameters<PhotoFiles['releaseInput']>>()
      .mockResolvedValue(),
  };
  preparation = {
    admit: jest.fn<Promise<void>, Parameters<PhotoPreparation['admit']>>().mockResolvedValue(),
    prepare: jest.fn<Promise<PreparedPhoto>, Parameters<PhotoPreparation['prepare']>>(
      async (source, id) => output(source, id),
    ),
    remove: jest.fn<Promise<void>, Parameters<PhotoPreparation['remove']>>().mockResolvedValue(),
  };
  session = new PhotoSession(files, () => String(++id), preparation);
});
async function select() {
  await session.acquire('gallery', async () => input);
  return session.snapshot().photo!;
}
function stall() {
  let finish!: () => void;
  preparation.prepare.mockImplementationOnce(
    (source, id) =>
      new Promise((resolve) => {
        finish = () => resolve(output(source, id));
      }),
  );
  return () => finish();
}
test('duplicate Use Photo and already prepared source produce one job', async () => {
  const source = await select(),
    finish = stall();
  const pending = session.preparePhoto(source.revision);
  expect(session.snapshot()).toMatchObject({ busy: true, preparing: true, prepared: null });
  expect(await session.preparePhoto(source.revision)).toBe(false);
  finish();
  expect(await pending).toBe(true);
  expect(await session.preparePhoto(source.revision)).toBe(true);
  expect(preparation.prepare).toHaveBeenCalledTimes(1);
  expect(session.snapshot().prepared?.sourceRevision).toBe(source.revision);
});
test('replacement during preparation fences output and defers source deletion until native completion', async () => {
  const old = await select(),
    finish = stall();
  const pending = session.preparePhoto(old.revision);
  const next = await select();
  expect(files.remove).not.toHaveBeenCalledWith(old);
  finish();
  expect(await pending).toBe(false);
  expect(files.remove).toHaveBeenCalledWith(old);
  expect(files.remove).not.toHaveBeenCalledWith(next);
  expect(preparation.remove).toHaveBeenCalledWith(output(old, '2'));
  expect(session.snapshot()).toMatchObject({ photo: next, prepared: null, busy: false });
});
test.each(['retake', 'manual', 'route-exit', 'account-change', 'unmount'])(
  '%s discard cannot resurrect state after native completion',
  async () => {
    const photo = await select(),
      finish = stall();
    const pending = session.preparePhoto(photo.revision);
    session.discard();
    expect(files.remove).not.toHaveBeenCalledWith(photo);
    finish();
    expect(await pending).toBe(false);
    expect(session.snapshot()).toEqual({
      photo: null,
      prepared: null,
      preparing: false,
      busy: false,
      error: null,
    });
    expect(preparation.remove).toHaveBeenCalledTimes(1);
    expect(files.remove).toHaveBeenCalledTimes(1);
  },
);
test('Choose Another or blur cancels work but preserves source for picker cancellation', async () => {
  const photo = await select(),
    finish = stall();
  const pending = session.preparePhoto(photo.revision);
  session.cancelPreparation();
  await session.acquire('gallery', async () => null);
  finish();
  expect(await pending).toBe(false);
  expect(session.snapshot().photo).toBe(photo);
  expect(files.remove).not.toHaveBeenCalled();
  expect(preparation.remove).toHaveBeenCalledTimes(1);
});
test('successful prepared artifact survives validation and is cleaned on actual replacement', async () => {
  const photo = await select();
  await session.preparePhoto(photo.revision);
  const prepared = session.snapshot().prepared;
  await session.validate(photo.revision);
  await session.acquire('gallery', async () => null);
  expect(preparation.remove).not.toHaveBeenCalled();
  await select();
  expect(preparation.remove).toHaveBeenCalledWith(prepared);
});
test('stale completion cannot delete current output in another account scope', async () => {
  const old = await select(),
    finish = stall();
  const pending = session.preparePhoto(old.revision);
  session.discard();
  const nextSession = new PhotoSession(files, () => 'new-account', preparation);
  await nextSession.acquire('gallery', async () => input);
  await nextSession.preparePhoto('new-account');
  const current = nextSession.snapshot().prepared;
  finish();
  await pending;
  expect(preparation.remove).not.toHaveBeenCalledWith(current);
  expect(nextSession.snapshot().prepared).toBe(current);
});
test('safe errors preserve recoverable source and allow explicit retry', async () => {
  const photo = await select();
  preparation.prepare.mockRejectedValueOnce(new PreparationError('OUTPUT_TOO_LARGE'));
  expect(await session.preparePhoto(photo.revision)).toBe(false);
  expect(session.snapshot()).toMatchObject({
    photo,
    prepared: null,
    busy: false,
    preparing: false,
    error: expect.stringMatching(/still too large/),
  });
  expect(await session.preparePhoto(photo.revision)).toBe(true);
});
test('mismatched preparation revision cannot become current', async () => {
  const photo = await select();
  preparation.prepare.mockResolvedValueOnce(output(photo, 'wrong'));
  expect(await session.preparePhoto(photo.revision)).toBe(false);
  expect(session.snapshot().prepared).toBeNull();
  expect(preparation.remove).toHaveBeenCalledTimes(1);
});
test('raw decoder errors never appear in session state', async () => {
  const photo = await select();
  preparation.prepare.mockRejectedValueOnce(
    new Error('file:///private-filename.jpg decoder details'),
  );
  await session.preparePhoto(photo.revision);
  expect(session.snapshot().error).toBe(new PreparationError('INVALID').message);
});
test('revision generation failure is safe and releases preparation for retry', async () => {
  const uuid = jest
    .fn()
    .mockReturnValueOnce('source')
    .mockImplementationOnce(() => {
      throw new Error('private native crypto details');
    })
    .mockReturnValue('retry');
  session = new PhotoSession(files, uuid, preparation);
  const photo = await select();
  await expect(session.preparePhoto(photo.revision)).resolves.toBe(false);
  expect(session.snapshot()).toMatchObject({
    photo,
    busy: false,
    preparing: false,
    prepared: null,
    error: new PreparationError('INVALID').message,
  });
  expect(preparation.prepare).not.toHaveBeenCalled();
  expect(await session.preparePhoto(photo.revision)).toBe(true);
});
test('pre-decode source admission failure removes unsafe preview and returns safe message', async () => {
  const photo = await select();
  preparation.admit.mockRejectedValueOnce(new PreparationError('PIXEL_LIMIT'));
  expect(await session.validate(photo.revision)).toBe(false);
  expect(session.snapshot().photo).toBeNull();
  expect(session.snapshot().error).toMatch(/12 megapixels/);
  expect(files.remove).toHaveBeenCalledWith(photo);
});
