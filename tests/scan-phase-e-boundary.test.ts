import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const capture = readdirSync(join(root, 'src/features/capture'))
  .filter((p) => /\.tsx?$/.test(p))
  .map((p) => readFileSync(join(root, 'src/features/capture', p), 'utf8'))
  .join('\n');
const android = readFileSync(
  join(
    root,
    'modules/kitchencam-image/android/src/main/java/expo/modules/kitchencamimage/KitchenCamImageModule.kt',
  ),
  'utf8',
);
const ios = readFileSync(
  join(root, 'modules/kitchencam-image/ios/KitchenCamImageModule.swift'),
  'utf8',
);
test('preparation has no upload, backend, media logs, telemetry or JS image strings', () => {
  expect(capture).not.toMatch(
    /\bfetch\s*\(|supabase|\.upload\(|analytics\.|captureException|\.base64\(|\.bytes\(|\.text\(/,
  );
  const withoutDiagnostics = readdirSync(join(root, 'src/features/capture'))
    .filter((p) => /\.tsx?$/.test(p) && p !== 'camera-diagnostics.ts')
    .map((p) => readFileSync(join(root, 'src/features/capture', p), 'utf8'))
    .join('\n');
  expect(withoutDiagnostics).not.toMatch(/console\./);
  expect(android + ios).not.toMatch(
    /https?:\/\/|URLSession|OkHttp|Base64|println\(|NSLog\(|print\(/,
  );
});
test('native renderers explicitly flatten white, use fresh JPEG and verify pixels', () => {
  expect(android).toContain('canvas.drawColor(Color.WHITE)');
  expect(android).toContain('Bitmap.CompressFormat.JPEG');
  expect(android).toContain('inPreferredColorSpace = ColorSpace.get(ColorSpace.Named.SRGB)');
  expect(ios).toContain('context.setFillColor(CGColor(gray: 1, alpha: 1))');
  expect(ios).toContain('CGImageDestinationAddImage(destination, pixels');
  expect(ios).toContain('CGColorSpace.sRGB');
  expect(ios).not.toContain('CGImageDestinationCopyImageSource');
});
test('native code bounds files, output surfaces and serializes decodes', () => {
  expect(android).toContain('synchronized(lock)');
  expect(android).toContain('inJustDecodeBounds = true');
  expect(android).toContain('12_000_000');
  expect(android).toContain('256..2048');
  expect(ios).toContain('runOnQueue(Self.renderQueue)');
  expect(ios).toContain('12_000_000 / height');
  expect(ios).toContain('(256...2048)');
});
