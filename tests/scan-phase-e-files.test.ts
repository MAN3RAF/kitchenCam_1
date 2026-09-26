import type * as PreparationFiles from '@/features/capture/preparation-files';
import { inspectImage } from '@/features/capture/image-inspection';
import { concat, exif, jpeg, segment, textBytes } from './fixtures/phase-e-images';

const mockFiles = new Map<string, Uint8Array>();
const mockClosed = jest.fn();
const mockReads = jest.fn();
const mockWrites = jest.fn();
let mockLocked: string | null = null;
let mockUnreadable = false;
jest.mock('expo-file-system', () => {
  const path = (...parts: (string | { uri: string })[]) =>
    parts
      .map((part) => (typeof part === 'string' ? part : part.uri))
      .join('/')
      .replace(/\/$/, '');
  class Directory {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = path(...parts);
    }
    create() {}
    list() {
      return [...mockFiles.keys()]
        .filter((uri) => new File(uri).parentDirectory.uri === this.uri)
        .map((uri) => new File(uri));
    }
  }
  class File {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = path(...parts);
    }
    get parentDirectory() {
      return new Directory(this.uri.slice(0, this.uri.lastIndexOf('/')));
    }
    get exists() {
      return mockFiles.has(this.uri);
    }
    get size() {
      return mockFiles.get(this.uri)?.length ?? 0;
    }
    create() {
      if (this.exists) throw new Error('exists');
      mockFiles.set(this.uri, new Uint8Array(0));
    }
    delete() {
      if (mockLocked === this.uri) throw new Error('locked');
      mockFiles.delete(this.uri);
    }
    open(mode?: string) {
      if (mockUnreadable) throw new Error('private path');
      const uri = this.uri;
      return {
        offset: 0,
        readBytes(length: number) {
          mockReads(length);
          const result = mockFiles.get(uri)!.slice(this.offset, this.offset + length);
          this.offset += result.length;
          return result;
        },
        writeBytes(data: Uint8Array) {
          if (mode === 'read') throw new Error('read only');
          mockWrites(data.length);
          const previous = mockFiles.get(uri)!;
          const next = new Uint8Array(Math.max(previous.length, this.offset + data.length));
          next.set(previous);
          next.set(data, this.offset);
          this.offset += data.length;
          mockFiles.set(uri, next);
        },
        close: mockClosed,
      };
    }
  }
  return {
    Directory,
    File,
    FileMode: { ReadOnly: 'read' },
    Paths: { cache: new Directory('file:///cache') },
  };
});
jest.mock('@/features/capture/preparation-native-module', () => ({ pixelRenderer: jest.fn() }));

let adapter: typeof PreparationFiles;
const folder = 'file:///cache/kitchencam-prepared';
const original = 'file:///gallery/original.jpg';
beforeEach(() => {
  mockFiles.clear();
  mockLocked = null;
  mockUnreadable = false;
  jest.isolateModules(() => {
    adapter = jest.requireActual<typeof PreparationFiles>('@/features/capture/preparation-files');
  });
});

test('activation sweeps only obsolete prepared files, once per process', () => {
  mockFiles.set(`${folder}/old.jpg`, jpeg());
  mockFiles.set(original, jpeg());
  mockFiles.set('file:///cache/kitchencam-photos/active.jpeg', jpeg());
  adapter.activatePreparationCache();
  expect(mockFiles.has(`${folder}/old.jpg`)).toBe(false);
  mockFiles.set(`${folder}/current.jpg`, jpeg());
  adapter.activatePreparationCache();
  expect(mockFiles.size).toBe(3);
  expect(mockFiles.has(original)).toBe(true);
});

test('failed deletion retries without touching the active output or gallery original', async () => {
  adapter.activatePreparationCache();
  mockFiles.set(`${folder}/obsolete.jpg`, jpeg());
  mockFiles.set(`${folder}/current.jpg`, jpeg());
  mockFiles.set(original, jpeg());
  mockLocked = `${folder}/obsolete.jpg`;
  await adapter.preparationStorage.remove(mockLocked);
  await adapter.preparationStorage.remove(original);
  expect(mockFiles.size).toBe(3);
  mockLocked = null;
  adapter.activatePreparationCache();
  await adapter.preparationStorage.remove(`${folder}/obsolete.jpg`);
  expect([...mockFiles.keys()]).toEqual([`${folder}/current.jpg`, original]);
});

test('actual filesystem stripper removes APP/COM while preserving bounded entropy bytes', () => {
  adapter.activatePreparationCache();
  const encoded = adapter.preparationStorage.target('one', true);
  const output = adapter.preparationStorage.target('one', false);
  const metadata = concat(
    segment(225, exif(6)),
    segment(225, textBytes('XMP')),
    segment(226, textBytes('ICC')),
    segment(237, textBytes('IPTC')),
    segment(254, textBytes('comment')),
  );
  const clean = jpeg(800, 600);
  const pixels = new Uint8Array(70000).fill(20);
  const expected = concat(clean.slice(0, -2), pixels, clean.slice(-2));
  const source = jpeg(800, 600, metadata);
  mockFiles.set(encoded, concat(source.slice(0, -2), pixels, source.slice(-2)));
  const info = adapter.preparationStorage.inspect(encoded, inspectImage);
  adapter.preparationStorage.stripMetadata(encoded, output, info.metadata);
  expect(mockFiles.get(output)).toEqual(expected);
  expect(adapter.preparationStorage.inspect(output, inspectImage)).toMatchObject({
    orientation: 1,
    metadata: [],
  });
  expect(Math.max(...mockReads.mock.calls.map(([size]: [number]) => size))).toBeLessThanOrEqual(
    65536,
  );
  expect(Math.max(...mockWrites.mock.calls.map(([size]: [number]) => size))).toBeLessThanOrEqual(
    16384,
  );
  expect(mockClosed).toHaveBeenCalledTimes(4);
});

test('unreadable and missing files map to safe errors', () => {
  expect(() => adapter.preparationStorage.inspect(original, inspectImage)).toThrow(
    /can’t be opened/,
  );
  mockFiles.set(original, jpeg());
  mockUnreadable = true;
  expect(() => adapter.preparationStorage.inspect(original, inspectImage)).toThrow(
    /can’t be opened/,
  );
});

test('inspection closes handles even when parsing fails', () => {
  mockFiles.set(original, new Uint8Array(20));
  expect(() => adapter.preparationStorage.inspect(original, inspectImage)).toThrow();
  expect(mockClosed).toHaveBeenCalledTimes(1);
});

test('target names and stripping cannot overwrite an existing output or user original', () => {
  adapter.activatePreparationCache();
  mockFiles.set(`${folder}/current.jpg`, jpeg());
  mockFiles.set(original, jpeg());
  expect(() => adapter.preparationStorage.target('../escape', false)).toThrow();
  expect(() => adapter.preparationStorage.target('current', false)).toThrow();
  expect(() =>
    adapter.preparationStorage.stripMetadata(`${folder}/current.jpg`, original, []),
  ).toThrow();
  expect(mockFiles.get(original)).toEqual(jpeg());
  expect(adapter.preparationStorage.ownsSource(original)).toBe(false);
  expect(adapter.preparationStorage.ownsSource('file:///cache/kitchencam-photos/source.jpeg')).toBe(
    true,
  );
});
