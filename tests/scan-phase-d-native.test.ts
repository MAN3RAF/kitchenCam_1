import { Platform } from 'react-native';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import {
  activatePhotoCache,
  choosePhoto,
  photoFiles,
  recoverPicker,
  retryPhotoCleanup,
} from '@/features/capture/photo-native';
import type { LocalPhoto } from '@/features/capture/photo-session';

jest.mock('expo-device', () => ({ isDevice: true }));
const mockFiles = new Map<string, number>();
const mockDeleted: string[] = [];
let mockUnreadable = false;
let mockDeleteFails = false;
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
    get exists() {
      return [...mockFiles.keys()].some((uri) => uri.startsWith(`${this.uri}/`));
    }
    list() {
      return [...mockFiles.keys()]
        .filter((uri) => uri.startsWith(`${this.uri}/`))
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
      return mockFiles.get(this.uri) ?? 0;
    }
    async copy(target: File) {
      if (!this.exists) throw new Error('private path');
      await Promise.resolve();
      mockFiles.set(target.uri, this.size);
    }
    open() {
      return {
        readBytes: () => {
          if (mockUnreadable) throw new Error('private path');
          return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        },
        close: jest.fn(),
      };
    }
    delete() {
      if (mockDeleteFails) throw new Error('temporarily locked');
      mockDeleted.push(this.uri);
      mockFiles.delete(this.uri);
    }
  }
  return { File, Directory, Paths: { cache: new Directory('file:///cache') } };
});
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(),
  getPendingResultAsync: jest.fn(),
  UIImagePickerPreferredAssetRepresentationMode: { Current: 'current' },
}));
const input = {
  uri: 'content://photos/original',
  width: 800,
  height: 600,
  mimeType: 'image/jpeg',
  type: 'image' as const,
};
const asset = {
  ...input,
  fileSize: 100,
  base64: 'must-not-be-copied',
  exif: { private: 'must-not-be-copied' },
};
beforeEach(() => {
  mockFiles.clear();
  mockFiles.set(input.uri, 100);
  mockDeleted.length = 0;
  mockUnreadable = false;
  mockDeleteFails = false;
  jest
    .mocked(ImagePicker.launchImageLibraryAsync)
    .mockResolvedValue({ canceled: false, assets: [asset] });
});
test('system picker requests one image without edits, EXIF, base64 or broad permission', async () => {
  expect(await choosePhoto()).toEqual(input);
  expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith({
    mediaTypes: ['images'],
    allowsMultipleSelection: false,
    allowsEditing: false,
    quality: 1,
    base64: false,
    exif: false,
    legacy: false,
    preferredAssetRepresentationMode: 'current',
  });
});
test('picker cancellation returns no asset', async () => {
  jest
    .mocked(ImagePicker.launchImageLibraryAsync)
    .mockResolvedValue({ canceled: true, assets: null });
  expect(await choosePhoto()).toBeNull();
});
test('Android pending picker recovery projects only the minimal descriptor input', async () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  jest
    .mocked(ImagePicker.getPendingResultAsync)
    .mockResolvedValue({ canceled: false, assets: [asset] });
  expect(await recoverPicker()).toEqual(input);
  expect(ImagePicker.launchImageLibraryAsync).not.toHaveBeenCalled();
});
test('Android pending picker errors are mapped safely', async () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  jest
    .mocked(ImagePicker.getPendingResultAsync)
    .mockResolvedValue({ code: 'internal', message: 'private file' });
  await expect(recoverPicker()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
});
test('first activation removes obsolete app captures/copies but preserves pending picker assets', () => {
  mockFiles.set('file:///cache/kitchencam-photos/old.jpeg', 100);
  mockFiles.set('file:///cache/Camera/old.jpg', 100);
  mockFiles.set('file:///cache/ImagePicker/pending.jpg', 100);
  activatePhotoCache();
  expect(mockDeleted).toEqual([
    'file:///cache/kitchencam-photos/old.jpeg',
    'file:///cache/Camera/old.jpg',
  ]);
  expect(mockFiles.has('file:///cache/ImagePicker/pending.jpg')).toBe(true);
});
test('provider asset is copied byte-for-byte and its original is never deleted', async () => {
  const photo = await photoFiles.prepare(input, 'gallery', 'one');
  expect(photo.uri).toBe('file:///cache/kitchencam-photos/one.jpeg');
  expect(photo.size).toBe(100);
  expect(photo.source).toBe('gallery');
  await photoFiles.releaseInput(input, 'gallery');
  await photoFiles.remove(photo);
  expect(mockFiles.get(input.uri)).toBe(100);
  expect(mockDeleted).toEqual([photo.uri]);
});
test('a MIME hint cannot admit bytes with a different image signature', async () => {
  const originalOpen = File.prototype.open;
  File.prototype.open = function () {
    return {
      readBytes: () => new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0]),
      writeBytes: jest.fn(),
      offset: 0,
      size: 12,
      close: jest.fn(),
    };
  };
  try {
    await expect(photoFiles.prepare(input, 'gallery', 'wrong-signature')).rejects.toMatchObject({
      code: 'UNSUPPORTED',
    });
  } finally {
    File.prototype.open = originalOpen;
  }
});
test('original file gallery asset outside SDK cache is also never removed', async () => {
  const original = { ...input, uri: 'file:///photos/Original.jpg' };
  mockFiles.set(original.uri, 100);
  await photoFiles.releaseInput(original, 'gallery');
  await photoFiles.remove({ uri: original.uri } as LocalPhoto);
  expect(mockDeleted).toEqual([]);
});
test.each(['camera', 'gallery'] as const)(
  'known %s SDK temporary copy is removed after import or stale completion',
  async (source) => {
    const native = {
      ...input,
      uri: `file:///cache/${source === 'camera' ? 'Camera' : 'ImagePicker'}/generated.jpg`,
    };
    mockFiles.set(native.uri, 100);
    await photoFiles.releaseInput(native, source);
    expect(mockDeleted).toEqual([native.uri]);
  },
);
test.each(['image/heic', 'image/gif', 'image/svg+xml', 'video/mp4'])(
  'unsupported %s input is rejected before copying',
  async (mimeType) => {
    await expect(
      photoFiles.prepare({ ...input, mimeType }, 'gallery', 'one'),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    expect(mockFiles.size).toBe(1);
  },
);
test('non-image and remote/base64 results are rejected safely', async () => {
  await expect(
    photoFiles.prepare({ ...input, type: 'video' }, 'gallery', 'one'),
  ).rejects.toMatchObject({ code: 'UNSUPPORTED' });
  for (const uri of ['https://example.invalid/photo.jpg', 'data:image/jpeg;base64,AAAA']) {
    await expect(photoFiles.prepare({ ...input, uri }, 'gallery', 'one')).rejects.toMatchObject({
      code: 'UNREADABLE',
    });
  }
});
test('inaccessible or empty input never creates a usable descriptor', async () => {
  mockFiles.delete(input.uri);
  await expect(photoFiles.prepare(input, 'gallery', 'one')).rejects.toMatchObject({
    code: 'UNREADABLE',
  });
  mockFiles.set(input.uri, 0);
  await expect(photoFiles.prepare(input, 'gallery', 'two')).rejects.toMatchObject({
    code: 'UNREADABLE',
  });
});
test('failed readability removes the incomplete owned copy', async () => {
  mockUnreadable = true;
  await expect(photoFiles.prepare(input, 'gallery', 'one')).rejects.toMatchObject({
    code: 'UNREADABLE',
  });
  expect(mockDeleted).toEqual(['file:///cache/kitchencam-photos/one.jpeg']);
});
test('cleanup retries a locked owned file without touching the live replacement', async () => {
  const first = await photoFiles.prepare(input, 'gallery', 'one');
  const second = await photoFiles.prepare(input, 'gallery', 'two');
  mockDeleteFails = true;
  await photoFiles.remove(first);
  mockDeleteFails = false;
  retryPhotoCleanup();
  expect(new File(first.uri).exists).toBe(false);
  expect(new File(second.uri).exists).toBe(true);
});
