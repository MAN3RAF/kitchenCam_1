import { Directory, File, FileMode, Paths } from 'expo-file-system';
import { bytes, type ImageReader } from './image-reader';
import { createPhotoPreparation, type PreparationStorage } from './photo-preparation';
import { pixelRenderer } from './preparation-native-module';
import { PreparationError } from './preparation-policy';

const pendingDeletes = new Set<string>();
let initialized = false;
const directory = () => new Directory(Paths.cache, 'kitchencam-prepared');
function owned(uri: string) {
  return uri.startsWith('file://') && new File(uri).parentDirectory.uri === directory().uri;
}
function remove(uri: string) {
  if (!owned(uri)) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
    pendingDeletes.delete(uri);
  } catch {
    pendingDeletes.add(uri);
  }
}
export function activatePreparationCache() {
  try {
    const folder = directory();
    folder.create({ intermediates: true, idempotent: true });
    if (!initialized) {
      const obsolete = folder.list();
      initialized = true;
      for (const entry of obsolete) if (entry instanceof File) remove(entry.uri);
    }
    for (const uri of pendingDeletes) remove(uri);
  } catch {
    /* Next activation retries; actual preparation maps storage failures safely. */
  }
}
export const preparationStorage: PreparationStorage = {
  ownsSource: (uri) =>
    uri.startsWith('file://') &&
    new File(uri).parentDirectory.uri === new Directory(Paths.cache, 'kitchencam-photos').uri,
  target(revision, intermediate) {
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(revision)) throw new PreparationError('INVALID');
    activatePreparationCache();
    if (!initialized) throw new PreparationError('UNREADABLE');
    const file = new File(directory(), `${revision}${intermediate ? '-encoded' : ''}.jpg`);
    if (file.exists) throw new PreparationError('INVALID');
    return file.uri;
  },
  inspect(uri, read) {
    const file = new File(uri);
    if (!file.exists || file.size <= 0) throw new PreparationError('UNREADABLE');
    try {
      const handle = file.open(FileMode.ReadOnly);
      try {
        const reader: ImageReader = {
          size: file.size,
          read: (offset, length) => {
            handle.offset = offset;
            return handle.readBytes(length);
          },
        };
        return read(reader);
      } finally {
        handle.close();
      }
    } catch (error) {
      throw error instanceof PreparationError ? error : new PreparationError('UNREADABLE');
    }
  },
  stripMetadata(source, target, metadata) {
    if (!owned(source) || !owned(target)) throw new PreparationError('INVALID');
    const file = new File(target);
    file.create({ overwrite: false });
    const output = file.open();
    try {
      preparationStorage.inspect(source, (reader) => {
        let cursor = 0;
        for (const range of [...metadata, { start: reader.size, end: reader.size }]) {
          while (cursor < range.start) {
            const part = bytes(reader, cursor, Math.min(16384, range.start - cursor));
            output.writeBytes(part);
            cursor += part.length;
          }
          cursor = range.end;
        }
      });
    } finally {
      output.close();
    }
  },
  async remove(uri) {
    remove(uri);
  },
};
export const photoPreparation = createPhotoPreparation(preparationStorage, pixelRenderer);
