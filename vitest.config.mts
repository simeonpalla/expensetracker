import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
    // Only tests/react/**/*.tsx need JSX transform + jsdom; engine and
    // function-handler tests stay on Node with no plugin overhead.
    plugins: [react()],
    test: {
        include: ['tests/**/*.test.{js,tsx}'],
        // Only extends `expect` with jest-dom matchers (toBeInTheDocument,
        // etc.) — negligible cost for the non-React tests that ignore it.
        setupFiles: ['tests/react/setup.ts']
    }
});
