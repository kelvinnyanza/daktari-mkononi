// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.smoke-dist/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/*.js',
      // .mjs is ignored everywhere EXCEPT the root scripts (linted by `pnpm lint:scripts`).
      '!scripts/*.mjs',
      'apps/**/*.mjs',
      'packages/**/*.mjs',
      'services/**/*.mjs',
      'docs/**/*.mjs',
      '**/*.cjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Root dev scripts (plain Node ESM): recommended JS rules + Node globals.
    files: ['scripts/*.mjs'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
