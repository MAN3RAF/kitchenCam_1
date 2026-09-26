import { inspectImage } from '@/features/capture/image-inspection';
import { exifOrientation } from '@/features/capture/image-reader';
import {
  orientationMatrix,
  preparedDimensions,
  preparationLimits,
} from '@/features/capture/preparation-policy';
import {
  concat,
  exif,
  jpeg,
  png,
  pngChunk,
  reader,
  segment,
  textBytes,
  webp,
  webpChunk,
} from './fixtures/phase-e-images';

test.each([
  ['jpeg', jpeg()],
  ['png', png()],
  ['webp', webp()],
  ['webp', webp(800, 600, undefined, true)],
] as const)('parses actual %s container dimensions', (format, data) => {
  expect(inspectImage(reader(data))).toMatchObject({
    format,
    width: 800,
    height: 600,
    orientation: 1,
  });
});
test('rejects above 25 MiB without reading bytes', () => {
  const read = jest.fn();
  expect(() => inspectImage({ size: preparationLimits.sourceBytes + 1, read })).toThrow(/25 MiB/);
  expect(read).not.toHaveBeenCalled();
});
test('short native reads fail safely', () => {
  expect(() => inspectImage({ size: 40, read: () => new Uint8Array(0) })).toThrow(
    /can’t be opened/,
  );
});
test.each([new Uint8Array(0), new Uint8Array(12), textBytes('GIF89a000000'), jpeg().slice(0, -1)])(
  'rejects missing, arbitrary, unsupported or truncated data',
  (data) => {
    expect(() => inspectImage(reader(data))).toThrow();
  },
);
test.each([
  ['image/png', jpeg()],
  ['image/jpeg', png()],
  ['image/jpeg', webp()],
] as const)('rejects misleading MIME %s', (hint, data) =>
  expect(() => inspectImage(reader(data), hint)).toThrow(/JPEG/),
);
test.each([jpeg(4001, 3000), png(4001, 3000), webp(4001, 3000)])(
  'rejects above 12 MP from encoded dimensions',
  (data) => {
    expect(() => inspectImage(reader(data))).toThrow(/12 megapixels/);
  },
);
test('12 MP boundary is admitted', () =>
  expect(inspectImage(reader(jpeg(4000, 3000))).width).toBe(4000));
test.each([
  [4000, 3000, 2048, 1536],
  [3000, 4000, 1536, 2048],
  [3000, 3000, 2048, 2048],
  [1200, 800, 1200, 800],
  [800, 1200, 800, 1200],
  [4032, 2268, 2048, 1152],
])(
  'resizes %sx%s without upscaling or stretching',
  (width, height, expectedWidth, expectedHeight) => {
    const result = preparedDimensions({ width, height });
    expect(result).toEqual({ width: expectedWidth, height: expectedHeight });
    expect(Math.abs(result.width / result.height - width / height)).toBeLessThan(0.005);
  },
);
test.each([
  [100, 100],
  [4000, 400],
  [0, 800],
  [800, NaN],
])('rejects invalid/minimum dimensions %s x %s', (width, height) => {
  expect(() => preparedDimensions({ width, height })).toThrow();
});
test.each([1, 2, 3, 4, 5, 6, 7, 8])(
  'orientation %s is parsed and applied once to dimensions',
  (orientation) => {
    const info = inspectImage(reader(jpeg(1200, 800, segment(225, exif(orientation)))));
    expect(info.orientation).toBe(orientation);
    expect(preparedDimensions(info, orientation)).toEqual(
      orientation >= 5 ? { width: 800, height: 1200 } : { width: 1200, height: 800 },
    );
  },
);
test.each([
  [1, [0, 0, 1, 0, 0, 1]],
  [2, [1, 0, 0, 0, 1, 1]],
  [3, [1, 1, 0, 1, 1, 0]],
  [4, [0, 1, 1, 1, 0, 0]],
  [5, [0, 0, 0, 1, 1, 0]],
  [6, [1, 0, 1, 1, 0, 0]],
  [7, [1, 1, 1, 0, 0, 1]],
  [8, [0, 1, 0, 0, 1, 1]],
])('orientation %s maps raw corners including mirrors', (orientation, expected) => {
  const [a, b, c, d, tx, ty] = orientationMatrix(orientation as number) as number[];
  const points = [
    [0, 0],
    [1, 0],
    [0, 1],
  ].flatMap(([x, y]) => [a! * x! + c! * y! + tx!, b! * x! + d! * y! + ty!]);
  expect(points).toEqual(expected);
});
test.each([0, 9])('invalid EXIF orientation %s fails', (n) =>
  expect(() => exifOrientation(exif(n))).toThrow(),
);
test('PNG eXIf and WebP EXIF are read without metadata entering descriptor', () => {
  expect(inspectImage(reader(png(800, 600, pngChunk('eXIf', exif(6).slice(6))))).orientation).toBe(
    6,
  );
  expect(inspectImage(reader(webp(800, 600, webpChunk('EXIF', exif(8))))).orientation).toBe(8);
});
test.each([
  png(800, 600, pngChunk('acTL', new Uint8Array(8))),
  webp(800, 600, webpChunk('ANIM', new Uint8Array(6))),
])('animation fails before decode', (data) =>
  expect(() => inspectImage(reader(data))).toThrow(/JPEG/),
);
test('PNG CRC corruption fails', () => {
  const data = png();
  data[30] = data[30]! ^ 1;
  expect(() => inspectImage(reader(data))).toThrow();
});
test.each([jpeg(), png(), webp()])('appended payloads fail', (data) => {
  expect(() => inspectImage(reader(concat(data, textBytes('trailing'))))).toThrow();
});
test('compressed metadata is rejected without expansion', () => {
  expect(() => inspectImage(reader(png(800, 600, pngChunk('iCCP', new Uint8Array(20)))))).toThrow();
});
test('bounded metadata budget rejects repeated large JPEG segments', () => {
  expect(() =>
    inspectImage(
      reader(
        jpeg(
          800,
          600,
          concat(segment(226, new Uint8Array(40000)), segment(237, new Uint8Array(40000))),
        ),
      ),
    ),
  ).toThrow();
});
