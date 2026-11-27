const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// FE-S6-03 (luật F4): bản production không giữ console.log/info/debug (kể cả của thư viện) — tránh lộ PII qua log thiết bị.
// console.error/warn giữ lại để báo lỗi. Minify chỉ chạy ở bản production nên dev không bị ảnh hưởng.
// Dùng `drop_console` dạng mảng (terser ≥ 5.27) thay `pure_funcs`: thay cả lời gọi có dùng giá trị trả về
// (vd `infoLog` của react-native: `return console.log(...args)`) bằng `void 0`.
config.transformer.minifierConfig = {
  ...config.transformer.minifierConfig,
  compress: {
    ...config.transformer.minifierConfig?.compress,
    drop_console: ['log', 'info', 'debug'],
  },
};

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
