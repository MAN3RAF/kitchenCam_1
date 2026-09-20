import { parsePublicEnvironment } from '@/config/public-env';

test('the credential-free shell defaults to development and accepts explicit environments', () => {
  expect(parsePublicEnvironment({}).appEnvironment).toBe('development');
  for (const appEnvironment of ['development', 'staging', 'production']) {
    expect(parsePublicEnvironment({ appEnvironment }).appEnvironment).toBe(appEnvironment);
  }
});

test('configuration rejects unexpected fields and never echoes values', () => {
  for (const input of [
    { appEnvironment: 'sensitive-invalid-input' },
    { apiKey: 'sensitive-invalid-input' },
  ]) {
    expect(() => parsePublicEnvironment(input)).toThrow('KitchenCam configuration is invalid.');
    try {
      parsePublicEnvironment(input);
    } catch (error) {
      expect(String(error)).not.toContain('sensitive-invalid-input');
    }
  }
});

test('only a Supabase publishable key is accepted in public configuration', () => {
  for (const key of ['sb_secret_server-value-must-not-ship', 'sk-server-value-must-not-ship']) {
    expect(() =>
      parsePublicEnvironment({
        supabaseUrl: 'http://127.0.0.1:54321',
        supabasePublishableKey: key,
      }),
    ).toThrow('KitchenCam configuration is invalid.');
  }
  expect(
    parsePublicEnvironment({
      supabaseUrl: 'http://127.0.0.1:54321',
      supabasePublishableKey: 'sb_publishable_local-test-value',
    }).supabasePublishableKey,
  ).toBe('sb_publishable_local-test-value');
});
