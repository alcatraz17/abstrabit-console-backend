import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import promise from 'eslint-plugin-promise';
import globals from 'globals';

export default [
  { ignores: ['node_modules', 'coverage', 'src/db/migrations'] },
  js.configs.recommended,
  promise.configs['flat/recommended'],
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      eqeqeq: ['error', 'always'],
      'no-console': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'prefer-const': 'error',
      'no-var': 'error',
      'object-shorthand': 'error',
      'promise/always-return': 'off',
    },
  },
  {
    files: ['scripts/**', 'cron-worker/**'],
    rules: { 'no-console': 'off' },
  },
  prettier,
];
