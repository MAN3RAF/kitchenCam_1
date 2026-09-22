const { z } = require('zod');
const { assertPublicEnvironment } = require('./tooling/client-boundary.cjs');

module.exports = () => {
  assertPublicEnvironment(process.env);
  const environment = z
    .enum(['development', 'staging', 'production'])
    .safeParse(process.env.EXPO_PUBLIC_APP_ENV ?? 'development');
  if (!environment.success) throw new Error('Invalid EXPO_PUBLIC_APP_ENV.');
  const suffix = environment.data === 'production' ? '' : ` (${environment.data})`;

  return {
    name: `KitchenCam${suffix}`,
    slug: 'kitchencam',
    version: '0.1.0',
    scheme: `kitchencam-${environment.data}`,
    orientation: 'default',
    userInterfaceStyle: 'automatic',
    ios: { supportsTablet: false },
    android: {
      predictiveBackGestureEnabled: true,
      blockedPermissions: [
        'android.permission.RECORD_AUDIO',
        'android.permission.READ_MEDIA_IMAGES',
        'android.permission.READ_MEDIA_VIDEO',
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.WRITE_EXTERNAL_STORAGE',
      ],
    },
    web: { bundler: 'metro', output: 'single' },
    plugins: [
      'expo-router',
      'expo-dev-client',
      [
        'expo-camera',
        {
          cameraPermission:
            'KitchenCam uses the camera to take ingredient photos that stay on your device.',
          microphonePermission: false,
          recordAudioAndroid: false,
          barcodeScannerEnabled: false,
        },
      ],
      [
        'expo-image-picker',
        {
          photosPermission: false,
          microphonePermission: false,
          cameraPermission:
            'KitchenCam uses the camera to take ingredient photos that stay on your device.',
        },
      ],
    ],
    experiments: { typedRoutes: true },
  };
};
