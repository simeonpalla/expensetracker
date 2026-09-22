// ESLint flat config. Four environments live in this repo:
// browser ES modules (src/), Node CommonJS (netlify/functions/, e2e server),
// Node ES modules (vitest tests, vite config), and TypeScript/React (the
// incoming frontend, src/**/*.{ts,tsx}, migrated in page-by-page).
const js = require('@eslint/js');
const globals = require('globals');
const tseslint = require('typescript-eslint');

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
        files: ['tests/**/*.test.js', 'tests/e2e/*.spec.js', 'vite.config.mjs', 'vitest.config.mts'],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'module',
            globals: { ...globals.node, ...globals.browser }
        }
    },
    ...tseslint.configs.recommended.map(config => ({
        ...config,
        files: ['src/**/*.{ts,tsx}', 'tests/react/**/*.tsx']
    })),
    {
        files: ['src/**/*.{ts,tsx}'],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'module',
            globals: { ...globals.browser }
        }
    },
    {
        files: ['tests/react/**/*.tsx'],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'module',
            globals: { ...globals.browser, ...globals.node }
        }
    }
];
