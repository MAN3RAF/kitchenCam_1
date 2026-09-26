import type { LocalPhoto } from './photo-session';
import { inspectImage, type ImageInfo } from './image-inspection';
import type { ImageReader } from './image-reader';
import type { NativePixelRenderer } from './preparation-native-module';
import {
  jpegQualities,
  orientationMatrix,
  preparedDimensions,
  preparationLimits,
  PreparationError,
  type PhotoPreparation,
  type PreparedPhoto,
} from './preparation-policy';

export interface PreparationStorage {
  ownsSource(uri: string): boolean;
  target(revision: string, intermediate: boolean): string;
  inspect<T>(uri: string, read: (reader: ImageReader) => T): T;
  stripMetadata(source: string, target: string, metadata: ImageInfo['metadata']): void;
  remove(uri: string): Promise<void>;
}

/** One native job globally; cancellation fences results but cannot kill an OS decoder. */
export function createPhotoPreparation(
  storage: PreparationStorage,
  native: () => NativePixelRenderer,
): PhotoPreparation {
  let running = false;
  const remove = async (uri: string) => {
    try {
      await storage.remove(uri);
    } catch {
      // Best effort; the app-owned cache is swept on the next process activation.
    }
  };
  return {
    async admit(source) {
      if (!storage.ownsSource(source.uri)) throw new PreparationError('UNREADABLE');
      preparedDimensions(
        storage.inspect(source.uri, (reader) => inspectImage(reader, source.mimeType)),
      );
    },
    async prepare(
      source: LocalPhoto,
      revision: string,
      current: () => boolean,
    ): Promise<PreparedPhoto> {
      if (running) throw new PreparationError('BUSY');
      running = true;
      let intermediate: string | undefined,
        output: string | undefined,
        retained = false;
      const checkCurrent = () => {
        if (!current()) throw new PreparationError('CANCELLED');
      };
      try {
        checkCurrent();
        if (!storage.ownsSource(source.uri)) throw new PreparationError('UNREADABLE');
        const info = storage.inspect(source.uri, (reader) => inspectImage(reader, source.mimeType));
        const dimensions = preparedDimensions(info, info.orientation);
        const renderer = native();
        intermediate = storage.target(revision, true);
        output = storage.target(revision, false);
        for (const quality of jpegQualities) {
          checkCurrent();
          await renderer.render({
            source: source.uri,
            target: intermediate,
            width: info.width,
            height: info.height,
            outputWidth: dimensions.width,
            outputHeight: dimensions.height,
            format: info.format,
            matrix: orientationMatrix(info.orientation),
            quality,
          });
          checkCurrent();
          const encoded = storage.inspect(intermediate, (reader) =>
            inspectImage(reader, 'image/jpeg'),
          );
          if (encoded.width !== dimensions.width || encoded.height !== dimensions.height)
            throw new PreparationError('INVALID');
          // Native pixels are freshly encoded first. Remove even encoder-created APP/COM
          // segments (ICC, EXIF, XMP, IPTC, thumbnails), then inspect and decode that file.
          storage.stripMetadata(intermediate, output, encoded.metadata);
          await storage.remove(intermediate);
          const size = storage.inspect(output, (reader) => reader.size);
          if (size > preparationLimits.outputBytes) {
            await storage.remove(output);
            continue;
          }
          const verified = storage.inspect(output, (reader) => inspectImage(reader, 'image/jpeg'));
          if (
            size <= 0 ||
            verified.metadata.length ||
            verified.orientation !== 1 ||
            verified.width !== dimensions.width ||
            verified.height !== dimensions.height
          )
            throw new PreparationError('INVALID');
          const decoded = await renderer.verify(output, dimensions.width, dimensions.height);
          if (decoded.width !== dimensions.width || decoded.height !== dimensions.height)
            throw new PreparationError('INVALID');
          checkCurrent();
          retained = true;
          return {
            ...dimensions,
            uri: output,
            size,
            mimeType: 'image/jpeg',
            revision,
            sourceRevision: source.revision,
            appOwned: true,
          };
        }
        throw new PreparationError('OUTPUT_TOO_LARGE');
      } catch (error) {
        throw error instanceof PreparationError ? error : new PreparationError('INVALID');
      } finally {
        if (intermediate) await remove(intermediate);
        if (output && !retained) await remove(output);
        running = false;
      }
    },
    remove: (photo) => storage.remove(photo.uri),
  };
}
