module.exports = {
    preset: 'jest-expo',
    setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
    testPathIgnorePatterns: ['<rootDir>/e2e/'],
    transformIgnorePatterns: [
        'node_modules/(?!(jest-)?react-native|@react-native|expo|@expo|@react-navigation|@unimodules|unimodules|sentry-expo|native-base|react-native-svg|firebase|@firebase|axios|@tanstack)'
    ],
    moduleNameMapper: {
        '^firebase/app$': '<rootDir>/node_modules/firebase/app/dist/index.cjs.js',
        '^firebase/auth$': '<rootDir>/node_modules/firebase/auth/dist/index.cjs.js',
        '^@firebase/util$': '<rootDir>/node_modules/@firebase/util/dist/index.cjs.js',
    }
};