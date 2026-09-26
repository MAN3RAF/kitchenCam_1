import {
  createPhotoPreparation,
  type PreparationStorage,
} from '@/features/capture/photo-preparation';
import type { NativePixelRenderer } from '@/features/capture/preparation-native-module';
import type { LocalPhoto } from '@/features/capture/photo-session';
import { preparationLimits } from '@/features/capture/preparation-policy';
import {
  concat,
  exif,
  jpeg,
  png,
  reader,
  segment,
  textBytes,
  webp,
} from './fixtures/phase-e-images';

const source: LocalPhoto = {
  uri: 'file:///source',
  revision: 'source-1',
  source: 'gallery',
  width: 1,
  height: 1,
  size: 1,
  mimeType: 'image/jpeg',
  selectedAt: 'fixture',
};
let files: Map<string, Uint8Array>;
let storage: PreparationStorage;
let native: jest.Mocked<NativePixelRenderer>;
let service: ReturnType<typeof createPhotoPreparation>;
beforeEach(() => {
  files = new Map([[source.uri, jpeg(4000, 3000)]]);
  storage = {
    ownsSource: (uri) => uri === source.uri,
    target: (revision, temporary) => `file:///${revision}${temporary ? '-encoded' : ''}.jpg`,
    inspect: (uri, inspect) => {
      const data = files.get(uri);
      if (!data) throw new Error('private path');
      return inspect(reader(data));
    },
    stripMetadata: (uri, target, ranges) => {
      const data = files.get(uri)!;
      let at = 0;
      const parts = ranges.map((range) => {
        const part = data.slice(at, range.start);
        at = range.end;
        return part;
      });
      files.set(target, concat(...parts, data.slice(at)));
    },
    remove: jest.fn(async (uri) => {
      files.delete(uri);
    }),
  };
  native = {
    render: jest.fn(async (r) => {
      files.set(r.target, jpeg(r.outputWidth, r.outputHeight));
    }),
    verify: jest.fn(async (_uri, width, height) => ({ width, height })),
  };
  service = createPhotoPreparation(storage, () => native);
});
test.each([
  ['image/jpeg', jpeg()],
  ['image/png', png()],
  ['image/webp', webp()],
] as const)(
  'prepares %s using encoded dimensions, not descriptor hints',
  async (mimeType, data) => {
    files.set(source.uri, data);
    const result = await service.prepare({ ...source, mimeType }, 'one', () => true);
    expect(result).toEqual({
      uri: 'file:///one.jpg',
      width: 800,
      height: 600,
      mimeType: 'image/jpeg',
      size: jpeg().length,
      revision: 'one',
      sourceRevision: 'source-1',
      appOwned: true,
    });
    expect(native.render).toHaveBeenCalledTimes(1);
    expect(native.render.mock.calls[0]![0]).toMatchObject({
      quality: 0.8,
      width: 800,
      height: 600,
    });
    expect(files.has('file:///one-encoded.jpg')).toBe(false);
    expect(files.has(source.uri)).toBe(true);
  },
);
test('source limit admission also gates preview', async () => {
  files.set(source.uri, jpeg(6000, 4000));
  await expect(service.admit(source)).rejects.toThrow(/12 megapixels/);
  expect(native.render).not.toHaveBeenCalled();
});
test.each(['missing', 'unreadable', 'unowned', 'mismatch', 'malformed'])(
  '%s source cannot reach native decode',
  async (failure) => {
    if (failure === 'missing') files.delete(source.uri);
    if (failure === 'unreadable')
      storage.inspect = () => {
        throw new Error('private source');
      };
    if (failure === 'unowned') storage.ownsSource = () => false;
    if (failure === 'mismatch') files.set(source.uri, png());
    if (failure === 'malformed') files.set(source.uri, new Uint8Array(12));
    await expect(service.prepare(source, 'one', () => true)).rejects.toThrow();
    expect(native.render).not.toHaveBeenCalled();
  },
);
test('native decoder failures are safe and remove partial intermediates', async () => {
  native.render.mockImplementation(async (r) => {
    files.set(r.target, new Uint8Array(1));
    throw new Error('private decoder info');
  });
  await expect(service.prepare(source, 'one', () => true)).rejects.toThrow(
    'This photo can’t be prepared.',
  );
  expect([...files.keys()]).toEqual([source.uri]);
});
function oversized() {
  const image = jpeg(2048, 1536);
  return concat(image.slice(0, -2), new Uint8Array(preparationLimits.outputBytes), image.slice(-2));
}
test('oversize first pass retries at 0.7 with unchanged dimensions', async () => {
  native.render.mockImplementationOnce(async (r) => {
    files.set(r.target, oversized());
  });
  await service.prepare(source, 'one', () => true);
  expect(native.render.mock.calls.map(([r]) => r.quality)).toEqual([0.8, 0.7]);
  expect(
    native.render.mock.calls.every(([r]) => r.outputWidth === 2048 && r.outputHeight === 1536),
  ).toBe(true);
});
test('three oversize attempts terminate without degrading below 0.6', async () => {
  native.render.mockImplementation(async (r) => {
    files.set(r.target, oversized());
  });
  await expect(service.prepare(source, 'one', () => true)).rejects.toMatchObject({
    code: 'OUTPUT_TOO_LARGE',
  });
  expect(native.render.mock.calls.map(([r]) => r.quality)).toEqual([0.8, 0.7, 0.6]);
  expect([...files.keys()]).toEqual([source.uri]);
});
test.each(['signature', 'dimensions', 'missing', 'decode', 'returned-dimensions'])(
  'actual output %s failure rejects success and cleans output',
  async (failure) => {
    if (failure === 'signature')
      native.render.mockImplementation(async (r) => {
        files.set(r.target, png());
      });
    if (failure === 'dimensions')
      native.render.mockImplementation(async (r) => {
        files.set(r.target, jpeg(1200, 800));
      });
    if (failure === 'missing') native.render.mockResolvedValue(undefined);
    if (failure === 'decode') native.verify.mockRejectedValue(new Error('private decoder'));
    if (failure === 'returned-dimensions') native.verify.mockResolvedValue({ width: 0, height: 0 });
    await expect(service.prepare(source, 'one', () => true)).rejects.toThrow();
    expect([...files.keys()]).toEqual([source.uri]);
  },
);
test('final output strips every encoder APP/COM segment and orientation dependency', async () => {
  const metadata = concat(
    segment(225, exif(6)),
    segment(225, textBytes('XMP fixture')),
    segment(226, textBytes('ICC fixture')),
    segment(237, textBytes('IPTC fixture')),
    segment(254, textBytes('comment fixture')),
  );
  native.render.mockImplementation(async (r) => {
    files.set(r.target, jpeg(r.outputWidth, r.outputHeight, metadata));
  });
  const output = await service.prepare(source, 'one', () => true);
  expect(files.get(output.uri)).toEqual(jpeg(2048, 1536));
  expect(native.verify).toHaveBeenCalledWith(output.uri, 2048, 1536);
});
test('rotated source sends one pixel transform, not an additional orientation operation', async () => {
  files.set(source.uri, jpeg(4000, 3000, segment(225, exif(6))));
  const output = await service.prepare(source, 'one', () => true);
  expect(output).toMatchObject({ width: 1536, height: 2048 });
  expect(native.render.mock.calls[0]![0]).toMatchObject({
    matrix: [0, 1, -1, 0, 1, 0],
    width: 4000,
    height: 3000,
  });
});
test('late native completion is removed and prevents concurrent decodes', async () => {
  let finish!: () => void;
  native.render.mockImplementationOnce(
    (r) =>
      new Promise((resolve) => {
        finish = () => {
          files.set(r.target, jpeg(r.outputWidth, r.outputHeight));
          resolve();
        };
      }),
  );
  let current = true;
  const pending = service.prepare(source, 'one', () => current);
  await expect(service.prepare(source, 'two', () => true)).rejects.toMatchObject({ code: 'BUSY' });
  current = false;
  finish();
  await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
  expect([...files.keys()]).toEqual([source.uri]);
  await expect(service.prepare(source, 'two', () => true)).resolves.toMatchObject({
    revision: 'two',
  });
});
test('cancellation during verification removes final output', async () => {
  let current = true;
  native.verify.mockImplementation(async (_uri, width, height) => {
    current = false;
    return { width, height };
  });
  await expect(service.prepare(source, 'one', () => current)).rejects.toMatchObject({
    code: 'CANCELLED',
  });
  expect([...files.keys()]).toEqual([source.uri]);
});

test('failed cleanup cannot leave the global preparation lock stuck', async () => {
  native.render.mockRejectedValueOnce(new Error('decoder failed'));
  jest.mocked(storage.remove).mockRejectedValueOnce(new Error('temporarily locked'));
  await expect(service.prepare(source, 'one', () => true)).rejects.toMatchObject({
    code: 'INVALID',
  });
  await expect(service.prepare(source, 'two', () => true)).resolves.toMatchObject({
    revision: 'two',
  });
});
