import { Platform } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { isDevice } from 'expo-device';
import { PhotoError, type PhotoFiles, type PhotoInput } from './photo-session';

export const nativePhotosAvailable = Platform.OS === 'android' || Platform.OS === 'ios';
// expo-camera deliberately generates a sample image in the iOS simulator.
export const nativeCameraAvailable = nativePhotosAvailable && isDevice;
const supportedTypes = ['image/jpeg', 'image/png', 'image/webp'];
const pendingDeletes = new Set<string>();
let initialized = false;

function folder() {
  return new Directory(Paths.cache, 'kitchencam-photos');
}
function deleteFile(uri: string) {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
    pendingDeletes.delete(uri);
  } catch {
    pendingDeletes.add(uri);
  }
}
export function retryPhotoCleanup() {
  if (!nativePhotosAvailable) return;
  for (const uri of pendingDeletes) deleteFile(uri);
}
export function activatePhotoCache() {
  if (!nativePhotosAvailable) return;
  try {
    initialize();
  } catch {
    /* Preparation will show a safe error if storage stays unavailable. */
  }
}
function initialize() {
  const directory = folder();
  directory.create({ intermediates: true, idempotent: true });
  if (!initialized) {
    // Only our private copies, never arbitrary cache files or gallery originals.
    for (const entry of directory.list()) if (entry instanceof File) deleteFile(entry.uri);
    const cameraCache = new Directory(Paths.cache, 'Camera');
    if (cameraCache.exists) {
      for (const entry of cameraCache.list()) if (entry instanceof File) deleteFile(entry.uri);
    }
    initialized = true;
  }
  retryPhotoCleanup();
  return directory;
}
function localInput(input: PhotoInput) {
  if (!/^(file|content):\/\//.test(input.uri)) throw new PhotoError('UNREADABLE');
  if (input.type && input.type !== 'image') throw new PhotoError('UNSUPPORTED');
  if (![input.width, input.height].every((value) => Number.isSafeInteger(value) && value > 0))
    throw new PhotoError('UNREADABLE');
  const extension = input.uri.split(/[?#]/)[0]?.split('.').pop()?.toLowerCase();
  const mime =
    input.mimeType ??
    (
      { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' } as Record<
        string,
        string
      >
    )[extension ?? ''];
  if (!mime || !supportedTypes.includes(mime)) throw new PhotoError('UNSUPPORTED');
  return mime;
}
function checkFile(file: File, mimeType?: string) {
  if (!file.exists || file.size <= 0) throw new PhotoError('UNREADABLE');
  const handle = file.open();
  try {
    const header = handle.readBytes(16);
    if (header.length < 12) throw new PhotoError('UNREADABLE');
    const valid =
      (mimeType === 'image/jpeg' &&
        header[0] === 0xff &&
        header[1] === 0xd8 &&
        header[2] === 0xff) ||
      (mimeType === 'image/png' &&
        header[0] === 0x89 &&
        header[1] === 0x50 &&
        header[2] === 0x4e &&
        header[3] === 0x47 &&
        header[4] === 0x0d &&
        header[5] === 0x0a &&
        header[6] === 0x1a &&
        header[7] === 0x0a) ||
      (mimeType === 'image/webp' &&
        header[0] === 0x52 &&
        header[1] === 0x49 &&
        header[2] === 0x46 &&
        header[3] === 0x46 &&
        header[8] === 0x57 &&
        header[9] === 0x45 &&
        header[10] === 0x42 &&
        header[11] === 0x50);
    if (!valid) throw new PhotoError('UNSUPPORTED');
  } finally {
    handle.close();
  }
}

export const photoFiles: PhotoFiles = {
  async prepare(input, source, revision) {
    if (!nativePhotosAvailable) throw new PhotoError('UNAVAILABLE');
    const mimeType = localInput(input);
    const directory = initialize();
    const target = new File(directory, `${revision}.${mimeType.split('/')[1]}`);
    try {
      // Copy bytes only. This is not normalization, compression, or sanitization.
      await new File(input.uri).copy(target);
      checkFile(target, mimeType);
      return {
        revision,
        uri: target.uri,
        source,
        width: input.width,
        height: input.height,
        mimeType,
        size: target.size,
        selectedAt: new Date().toISOString(),
      };
    } catch (error) {
      deleteFile(target.uri);
      throw error instanceof PhotoError ? error : new PhotoError('UNREADABLE');
    }
  },
  async readable(photo) {
    checkFile(new File(photo.uri), photo.mimeType);
  },
  async remove(photo) {
    const file = new File(photo.uri);
    if (file.parentDirectory.uri === folder().uri) deleteFile(file.uri);
  },
  async releaseInput(input, source) {
    // Expo-generated temporary results only; content/provider/gallery originals are never deleted.
    if (!input.uri.startsWith('file://')) return;
    const file = new File(input.uri);
    const sdkDirectory = new Directory(Paths.cache, source === 'camera' ? 'Camera' : 'ImagePicker');
    if (file.parentDirectory.uri === sdkDirectory.uri) deleteFile(file.uri);
  },
};

function pickerInput(
  result: ImagePicker.ImagePickerResult | ImagePicker.ImagePickerErrorResult | null,
): PhotoInput | null {
  if (!result) return null;
  if ('code' in result) throw new PhotoError('UNAVAILABLE');
  if (result.canceled) return null;
  if (result.assets.length !== 1) throw new PhotoError('UNSUPPORTED');
  const asset = result.assets[0]!;
  return {
    uri: asset.uri,
    width: asset.width,
    height: asset.height,
    mimeType: asset.mimeType,
    type: asset.type ?? undefined,
  };
}
export async function choosePhoto(): Promise<PhotoInput | null> {
  if (!nativePhotosAvailable) throw new PhotoError('UNAVAILABLE');
  return pickerInput(
    await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: false,
      allowsEditing: false,
      quality: 1,
      base64: false,
      exif: false,
      legacy: false,
      preferredAssetRepresentationMode:
        ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
    }),
  );
}
export async function recoverPicker(): Promise<PhotoInput | null> {
  if (Platform.OS !== 'android') return null;
  return pickerInput(await ImagePicker.getPendingResultAsync());
}
