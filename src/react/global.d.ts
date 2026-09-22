// Ambient types for the vanilla-JS globals React islands need to talk to
// during the page-by-page migration. Kept minimal: only what's actually
// called from React code, not a full re-typing of main.js.
export {};

declare global {
    interface Window {
        // Set in src/main.js's boot() once auth succeeds. Optional because
        // React modules can load before it exists (or in tests).
        app?: {
            loadAccounts?: () => Promise<void>;
        };
        showNotification?: (message: string, type?: 'success' | 'error') => void;
    }
}
