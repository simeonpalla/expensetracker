import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import react from '@vitejs/plugin-react';

export default defineConfig({
    build: {
        outDir: 'dist',
        sourcemap: true
    },
    plugins: [
        react(),
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
                // The ~12 MB OCR runtime is fetched on first bill scan, not
                // at install; cached on first use so scanning works offline.
                globIgnores: ['ocr/**'],
                runtimeCaching: [
                    {
                        urlPattern: ({ url }) => url.pathname.startsWith('/ocr/'),
                        handler: 'CacheFirst',
                        options: {
                            cacheName: 'ocr-runtime',
                            expiration: { maxEntries: 10 },
                            cacheableResponse: { statuses: [200] }
                        }
                    }
                ],
                navigateFallback: '/index.html',
                // Never intercept the BFF.
                navigateFallbackDenylist: [/^\/\.netlify\//, /^\/(privacy|terms)\.html$/]
            }
        })
    ]
});
