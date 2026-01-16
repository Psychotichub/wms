const globals = require('globals');
const pluginJs = require('@eslint/js');

/** @type {import('eslint').Linter.Config[]} */
module.exports = [
  {
    ignores: ['node_modules/**', 'dist/**', 'build/**', 'coverage/**']
  },
  pluginJs.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node
      }
    },
    rules: {
      'no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_'
        }
      ],
      'no-console': 'off'
    }
  }
];
