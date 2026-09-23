// crossPageSync.ts — lightweight pub/sub so React islands that
// independently fetch categories/accounts (AddTransactionPage,
// BudgetsPage, and indirectly window.app's own dropdowns) can refresh
// when CategoriesPage/AccountsPage mutate them elsewhere. Each island
// mounts once at app boot and stays mounted, so without this its data
// would go stale until a full page reload.
const categoryListeners = new Set<() => void>();
const accountListeners = new Set<() => void>();
const transactionListeners = new Set<() => void>();
const settingsListeners = new Set<() => void>();

export function onCategoriesChanged(fn: () => void): () => void {
    categoryListeners.add(fn);
    return () => categoryListeners.delete(fn);
}

export function onAccountsChanged(fn: () => void): () => void {
    accountListeners.add(fn);
    return () => accountListeners.delete(fn);
}

// DashboardPage/InsightsPage/BudgetsPage subscribe to this so they refresh
// when main.js's ExpenseTracker (AddTransactionPage submit, edit/delete
// modal, budget/giving-floor save) mutates the shared transaction list.
export function onTransactionsChanged(fn: () => void): () => void {
    transactionListeners.add(fn);
    return () => transactionListeners.delete(fn);
}

export function notifyCategoriesChanged() {
    categoryListeners.forEach(fn => fn());
}

export function notifyAccountsChanged() {
    accountListeners.forEach(fn => fn());
}

export function notifyTransactionsChanged() {
    transactionListeners.forEach(fn => fn());
}

// Fired after the per-user settings (budgets, giving floor, salary account,
// onboarding state) load from or change on the server.
export function onSettingsChanged(fn: () => void): () => void {
    settingsListeners.add(fn);
    return () => settingsListeners.delete(fn);
}

export function notifySettingsChanged() {
    settingsListeners.forEach(fn => fn());
}
