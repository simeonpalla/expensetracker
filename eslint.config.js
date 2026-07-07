// ESLint flat config. Three environments live in this repo:
// browser ES modules (src/), Node CommonJS (netlify/functions/, e2e server),
// and Node ES modules (vitest tests, vite config).
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
    {
        ignores: ['dist/**', 'node_modules/**', 'playwright-report/**', 'test-results/**', 'dev-dist/**']
    },
    js.configs.recommended,
    {
        rules: {
            'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
            'no-var': 'error',
            'prefer-const': 'error',
            eqeqeq: ['error', 'smart']
        }
    },
    {
        files: ['src/**/*.js'],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'module',
            globals: { ...globals.browser }
        }
    },
    {
        files: [
            'netlify/functions/**/*.js',
            'tests/e2e/server.js',
            'eslint.config.js',
            'playwright.config.js'
        ],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'commonjs',
            globals: { ...globals.node }
        }
    },
    {
        files: ['tests/**/*.test.js', 'tests/e2e/*.spec.js', 'vite.config.js', 'vitest.config.js'],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'module',
            globals: { ...globals.node, ...globals.browser }
        }
    }
];
