const path = require('node:path');

const publicEnvironmentNames = new Set([
  'EXPO_PUBLIC_APP_ENV',
  'EXPO_PUBLIC_SUPABASE_URL',
  'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  // Expo CLI injects these while resolving and bundling the project.
  'EXPO_PUBLIC_FOLDER',
  'EXPO_PUBLIC_PROJECT_ROOT',
  'EXPO_PUBLIC_USE_RN_FETCH',
]);

function assertPublicEnvironment(environment) {
  const unexpected = Object.keys(environment).filter(
    (name) => name.startsWith('EXPO_PUBLIC_') && !publicEnvironmentNames.has(name),
  );
  if (unexpected.length) {
    // Values are deliberately excluded, including in configuration errors.
    throw new Error(
      'Unapproved EXPO_PUBLIC_* variable. Review the public configuration allowlist.',
    );
  }
}

function assertClientModule(projectRoot, filePath) {
  const relative = path.relative(projectRoot, filePath).replaceAll('\\', '/');
  if (relative.startsWith('../') || relative.includes('node_modules/')) return;
  if (
    /(^|\/)(server|supabase|tooling)(\/|$)/.test(relative) ||
    /(^|\/)\.env($|\.)/.test(relative) ||
    /\.server\.[cm]?[jt]sx?$/.test(relative) ||
    /^app\.config\./.test(relative)
  ) {
    throw new Error('Server/build-only module cannot enter the mobile bundle.');
  }
}

module.exports = { assertPublicEnvironment, assertClientModule };
