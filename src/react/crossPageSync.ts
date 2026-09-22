// crossPageSync.ts — lightweight pub/sub so React islands that
// independently fetch categories/accounts (AddTransactionPage,
// BudgetsPage, and indirectly window.app's own dropdowns) can refresh
// when CategoriesPage/AccountsPage mutate them elsewhere. Each island
// mounts once at app boot and stays mounted, so without this its data
// would go stale until a full page reload.
const categoryListeners = new Set<() => void>();
const accountListeners = new Set<() => void>();

export function onCategoriesChanged(fn: () => void): () => void {
    categoryListeners.add(fn);
    return () => categoryListeners.delete(fn);
}

export function onAccountsChanged(fn: () => void): () => void {
    accountListeners.add(fn);
    return () => accountListeners.delete(fn);
}

export function notifyCategoriesChanged() {
    categoryListeners.forEach(fn => fn());
}

export function notifyAccountsChanged() {
    accountListeners.forEach(fn => fn());
}
