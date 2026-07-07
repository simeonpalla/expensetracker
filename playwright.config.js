// @ts-check
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: 'tests/e2e',
    timeout: 30000,
    use: {
        baseURL: 'http://localhost:4173',
        // The PWA service worker would bypass route stubbing.
        serviceWorkers: 'block'
    },
    webServer: {
        command: 'npm run build && node tests/e2e/server.js',
        port: 4173,
        reuseExistingServer: true,
        timeout: 120000
    }
});
