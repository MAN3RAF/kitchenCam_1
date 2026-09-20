const { getDefaultConfig } = require('expo/metro-config');
const { assertClientModule, assertPublicEnvironment } = require('./tooling/client-boundary.cjs');

assertPublicEnvironment(process.env);
const config = getDefaultConfig(__dirname);
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolution = context.resolveRequest(context, moduleName, platform);
  if (resolution.type === 'sourceFile') assertClientModule(__dirname, resolution.filePath);
  return resolution;
};
module.exports = config;
