import js from '@eslint/js';
import globals from 'globals';

const rules = {
  ...js.configs.recommended.rules,
  'no-unused-vars': ['error', { args: 'after-used', argsIgnorePattern: '^_', caughtErrors: 'none' }],
  'no-empty': ['error', { allowEmptyCatch: true }],
  'no-useless-escape': 'off',
  'no-control-regex': 'off',
  eqeqeq: ['error', 'smart'],
  'no-var': 'error',
  'prefer-const': 'warn',
};

export default [
  {
    ignores: ['app/assets/vendor/**', 'dist/**', 'desktop/bin/**', 'android/**', 'node_modules/**'],
  },
  {
    files: ['app/assets/js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        Neutralino: 'readonly',
      },
    },
    rules,
  },
  {
    files: ['scripts/**/*.mjs', '*.mjs', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules,
  },
];
