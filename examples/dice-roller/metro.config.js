const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);

// Enable ESM package exports for three.js and @react-three/fiber
config.resolver.unstable_enablePackageExports = true;

module.exports = config;
