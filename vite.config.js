import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
    build: {
        outDir: 'dist',
        sourcemap: true
    },
    plugins: [
        VitePWA({
            registerType: 'autoUpdate',
            injectRegister: 'auto',
            // public/manifest.json is kept as the single source of truth.
            manifest: false,
            includeAssets: ['manifest.json', 'assets/*.png', 'assets/*.ico'],
            workbox: {
                // Precache the hashed build output; navigation falls back to
                // the precached index.html so the PWA works offline.
                globPatterns: ['**/*.{js,css,html,png,ico,json}'],
                navigateFallback: '/index.html',
                // Never intercept the BFF.
                navigateFallbackDenylist: [/^\/\.netlify\//]
            }
        })
    ]
});
