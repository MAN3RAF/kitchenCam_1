import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const feature = join(root, 'src/features/capture');
const source = readdirSync(feature)
  .filter((name) => /\.tsx?$/.test(name))
  .map((name) => readFileSync(join(feature, name), 'utf8'))
  .join('\n');
test('local capture has no network/backend/logging/analytics boundary', () => {
  expect(source).not.toMatch(
    /\bfetch\s*\(|supabase|\.rpc\(|\.upload\(|console\.|analytics\.|captureException/,
  );
  expect(source).not.toMatch(
    /requestMediaLibraryPermissions|requestMicrophonePermissions|recordAsync|onBarcodeScanned|launchCameraAsync/,
  );
  expect(source).not.toMatch(/base64:\s*true|exif:\s*true/);
});
test('photo navigation contains fixed routes only, never media references or bytes', () => {
  const navigation = [...source.matchAll(/router\.(?:push|replace|navigate)\(([^)]*)\)/g)];
  expect(navigation.length).toBeGreaterThan(5);
  for (const call of navigation)
    expect(call[1]).toMatch(/^'\/scans\/(camera|gallery|preview|manual)'$/);
});
test('native config explicitly disables microphone, barcode and broad photo access', () => {
  const config = readFileSync(join(root, 'app.config.js'), 'utf8');
  expect(config).toMatch(/recordAudioAndroid: false/);
  expect(config).toMatch(/barcodeScannerEnabled: false/);
  expect(config.match(/microphonePermission: false/g)).toHaveLength(2);
  expect(config).toMatch(/photosPermission: false/);
  for (const permission of [
    'RECORD_AUDIO',
    'READ_MEDIA_IMAGES',
    'READ_MEDIA_VIDEO',
    'READ_EXTERNAL_STORAGE',
    'WRITE_EXTERNAL_STORAGE',
  ])
    expect(config).toContain(`android.permission.${permission}`);
});
