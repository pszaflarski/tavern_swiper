const baseConfig = require('./app.json');

module.exports = ({ config }) => {
  const isProd = process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID === 'tavern-swiper-prod';
  const isEmulator = process.env.EAS_BUILD_EMULATOR === 'true';

  // For emulator builds, include x86_64 so the APK runs on the x86_64 MaestroTest AVD.
  // Production/preview builds stay arm64-only for smaller APK size.
  const buildArchs = isEmulator ? ['arm64-v8a', 'x86_64'] : ['arm64-v8a'];

  // Override expo-build-properties plugin with the correct buildArchs
  const plugins = (baseConfig.expo.plugins || []).map((plugin) => {
    if (Array.isArray(plugin) && plugin[0] === 'expo-build-properties') {
      return [
        'expo-build-properties',
        {
          ...plugin[1],
          android: {
            ...plugin[1]?.android,
            buildArchs,
          },
        },
      ];
    }
    return plugin;
  });

  return {
    ...baseConfig.expo,
    ...config,
    android: {
      ...baseConfig.expo.android,
      ...config.android,
      googleServicesFile: isProd
        ? './google-services.prod.json'
        : './google-services.dev.json',
    },
    plugins: [
      ...plugins,
      '@react-native-google-signin/google-signin',
    ],
  };
};
