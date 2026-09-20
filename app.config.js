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
    android: { predictiveBackGestureEnabled: true },
    web: { bundler: 'metro', output: 'single' },
    plugins: ['expo-router', 'expo-dev-client'],
    experiments: { typedRoutes: true },
  };
};
