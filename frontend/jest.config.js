module.exports = {
  preset: 'jest-expo',
  transformIgnorePatterns: [
    'node_modules/(?!(jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|axios|@tanstack/react-query)',
  ],
  moduleNameMapper: {
    '^firebase/auth$': '<rootDir>/__mocks__/firebase.ts',
    '^firebase/app$': '<rootDir>/__mocks__/firebase.ts',
    '^axios$': '<rootDir>/node_modules/axios/dist/node/axios.cjs', 
  },
  modulePathIgnorePatterns: [
    '<rootDir>/e2e/',
  ],
};
