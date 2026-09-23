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
            needsOnboarding?: boolean;
            showPage?: (pageId: string) => void;
            loadCategories?: () => Promise<void>;
            refreshTransactions?: () => Promise<void>;
            transactions?: Array<{
                id: number | string;
                type: 'income' | 'expense';
                amount: number | string;
                category: string;
                transaction_date: string;
                payment_to?: string | null;
                payment_source?: string | null;
                source_details?: string | null;
                description?: string | null;
                is_recurring?: boolean;
            }>;
            categories?: Array<{ name: string; icon?: string }>;
            budgetLimits?: Record<string, number>;
            givingFloorPct?: number;
            givingFloorCategory?: string;
            salaryAccount?: string;
            currentCycleStart?: string | null;
            currentCycleEnd?: string | null;
            updateDashboardStats?: (start?: string, end?: string | null) => void;
            openEditModalById?: (id: string | number) => void;
            deleteTransaction?: (id: string | number) => void;
        };
        // Bridge for main.js's prefillFromRecurring() (the Dashboard-owned
        // "+ Log it" recurring-suggestion button) to reach into the React
        // form — see AddTransactionPage.tsx. Native DOM .value assignment
        // can't update React-controlled input state, so this indirection
        // is required rather than optional.
        __prefillAddTransactionForm?: (tx: {
            type: string;
            category: string;
            amount: number | string;
            payment_to: string | null;
            payment_source: string | null;
            source_details: string | null;
            description: string | null;
        }) => void;
        showNotification?: (message: string, type?: 'success' | 'error') => void;
    }
}
