const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

const defaultResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    moduleName.startsWith('.') &&
    moduleName.endsWith('.js') &&
    context.originModulePath &&
    // Mọi file TS (app + packages) viết import ESM có đuôi `.js` theo quy ước repo → thử bản bỏ `.js`.
    /\.(tsx?)$/.test(context.originModulePath)
  ) {
    const stripped = moduleName.replace(/\.js$/, '');
    try {
      const resolve = defaultResolveRequest ?? context.resolveRequest;
      return resolve(context, stripped, platform);
    } catch {
      // Bỏ qua nếu không resolve được bản bỏ .js
    }
  }

  const resolve = defaultResolveRequest ?? context.resolveRequest;
  return resolve(context, moduleName, platform);
};

module.exports = withNativeWind(config, { input: './global.css' });
