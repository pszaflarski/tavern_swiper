const baseConfig = require('./app.json');

module.exports = ({ config }) => {
  const isProd = process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID === 'tavern-swiper-prod';

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
      ...(baseConfig.expo.plugins || []),
      '@react-native-google-signin/google-signin',
    ],
  };
};
