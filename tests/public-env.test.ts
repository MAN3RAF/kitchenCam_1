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
