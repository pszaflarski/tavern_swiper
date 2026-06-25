const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);

// Enable ESM package exports for three.js and @react-three/fiber
config.resolver.unstable_enablePackageExports = true;

// Web aliases for @10play/tentap-editor (rich text editor)
// Swaps react-native-webview for an iframe-based implementation on web
const webAliases = {
  'react-native-webview': '@10play/react-native-web-webview',
  'react-native/Libraries/Utilities/codegenNativeComponent': '@10play/react-native-web-webview/shim',
  'crypto': 'expo-crypto',
};

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web') {
    const alias = webAliases[moduleName];
    if (alias) {
      // Redirect to the web-compatible package
      return context.resolveRequest(context, alias, platform);
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
