const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: [
      '.agents/**',
      '.expo/**',
      'dist/**',
      'coverage/**',
      'expo-env.d.ts',
      // Edge Functions run in Deno and are checked with Supabase/Deno tooling.
      'supabase/functions/**',
    ],
  },
  {
    files: ['app/**/*.{ts,tsx}', 'src/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': 'error',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/*.server',
                '**/*.server.*',
                '**/server/**',
                '**/supabase/**',
                '**/tooling/**',
                'node:*',
              ],
              message: 'Client code cannot import server/build-only modules.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message: 'Read validated public configuration from @/config/public-env.',
        },
      ],
    },
  },
  {
    files: ['src/config/public-env.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
]);
