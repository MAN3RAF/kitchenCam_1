module.exports = {
  preset: 'jest-expo',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  clearMocks: true,
  restoreMocks: true,
  transform: { '^.+\\.mjs$': ['babel-jest', { presets: ['babel-preset-expo'] }] },
  transformIgnorePatterns: [
    'node_modules/(?!(?:\\.pnpm/)?((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|react-navigation|@react-navigation/.*|react-native-svg|lucide-react-native))',
  ],
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.test.*'],
};
