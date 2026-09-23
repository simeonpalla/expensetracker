// ======================================================
// EXPENSE TRACKER — FRONTEND CONTROLLER (Vite entry point)
// ======================================================

import './fonts.css';
import './style.css';
import './styleadditions.css';

import PFDates from './engine/dates.js';
import { API } from './api.js';
import { escapeHtml, showNotification, openModal, closeModal } from './ui.js';
import { notifyTransactionsChanged } from './react/crossPageSync';

// Make the toast available to the console / any stragglers.
window.showNotification = showNotification;

// ===============================
// AUTH HANDLERS
// ===============================
// Login/signup live in src/react/pages/AuthPage.tsx (mounted by boot()).
async function handleLogout() {
    try {
        await API.logout();
    } catch {
        /* cookies cleared server-side; proceed */
    }
    localStorage.removeItem('activeTimer');
    localStorage.removeItem('session'); // legacy key from the pre-cookie version
    location.reload();
}

// ===============================
// THEME MANAGER
// ===============================
const ThemeManager = {
    init() {
        const saved = localStorage.getItem('theme') || 'system';
        this.apply(saved);
        this.watchSystem();
        document.querySelectorAll('.theme-btn').forEach(btn => {
            btn.addEventListener('click', () => this.apply(btn.dataset.theme));
        });
    },

    apply(theme) {
        localStorage.setItem('theme', theme);
        const root = document.documentElement;

        if (theme === 'system') {
            const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            root.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
        } else {
            root.setAttribute('data-theme', theme);
        }

        document.querySelectorAll('.theme-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.theme === theme);
        });
    },

    watchSystem() {
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
            if (localStorage.getItem('theme') === 'system') this.apply('system');
        });
    }
};

// ===============================
// MAIN APP CLASS
// ===============================
class ExpenseTracker {
    constructor(user) {
        this.currentUser = user;
        this.transactions = [];
        this.categories = [];

        this.salaryAccount = localStorage.getItem('salaryAccount') || 'UBI';
        this.currentCycleStart = null;
        this.currentCycleEnd = null;

        this.budgetLimits = JSON.parse(localStorage.getItem('budgetLimits') || '{}');
        this.givingFloorPct = parseFloat(localStorage.getItem('givingFloorPct')) || 5;
        this.givingFloorCategory = localStorage.getItem('givingFloorCategory') || '';

        this.accounts = [];
        // Grouped by type for the source-details dropdowns, e.g.
        // { upi: ['UBI', ...], 'credit-card': [...] }. Rebuilt by loadAccounts().
        this.paymentSources = {};

        this.editingTransactionId = null;
        this.pendingDeleteId = null;

        this.init();
    }

    async init() {
        if (!this._listenersAttached) {
            this.setupEventListeners();
            this._listenersAttached = true;
        }
        if (!this._reactMounted) {
            this.mountReactIslands();
            this._reactMounted = true;
        }
        this.syncSalaryAccountUI();

        document.getElementById('status-dot').className = 'status-dot connecting';
        document.getElementById('status-text').textContent = 'Fetching data...';

        try {
            await this.loadCategories();
            await this.loadAccounts();
            this.transactions = (await API.getTransactions()) || [];

            document.getElementById('status-dot').className = 'status-dot connected';
            document.getElementById('status-text').textContent = 'Connected';

            this.suggestRecurringTransactions();
            // React islands mount before this data finishes loading.
            notifyTransactionsChanged();
            this.showPage('add-transaction');
        } catch (error) {
            console.error('Init Error:', error);
            document.getElementById('status-dot').className = 'status-dot error';
            document.getElementById('status-text').textContent = 'Connection failed — tap to retry';
            const status = document.getElementById('connection-status');
            if (status) {
                status.style.cursor = 'pointer';
                status.addEventListener('click', () => this.init(), { once: true });
            }
            showNotification(
                'Could not load your data. Check your connection and tap the status to retry.',
                'error'
            );
        }
    }

    // ===============================
    // EVENT LISTENERS & NAVIGATION
    // ===============================
    setupEventListeners() {
        const qs = id => document.getElementById(id);

        qs('logout-btn')?.addEventListener('click', handleLogout);

        qs('salary-settings-form')?.addEventListener('submit', e => {
            e.preventDefault();
            const val = qs('salary-default-account')?.value;
            if (val) {
                this.salaryAccount = val;
                localStorage.setItem('salaryAccount', val);
                showNotification('Salary account updated to ' + val);
            }
        });

        // Edit modal
        qs('edit-modal-close')?.addEventListener('click', () => this.closeEditModal());
        qs('edit-modal-cancel')?.addEventListener('click', () => this.closeEditModal());
        qs('edit-transaction-form')?.addEventListener('submit', e => this.handleEditSubmit(e));
        qs('edit-modal-overlay')?.addEventListener('click', e => {
            if (e.target === qs('edit-modal-overlay')) this.closeEditModal();
        });
        qs('edit-payment-source')?.addEventListener('change', () => this.updateEditSourceDetailsOptions());

        // Delete confirm modal
        qs('delete-confirm-btn')?.addEventListener('click', () => this.confirmDelete());
        qs('delete-cancel-btn')?.addEventListener('click', () => this.closeDeleteModal());
        qs('delete-modal-overlay')?.addEventListener('click', e => {
            if (e.target === qs('delete-modal-overlay')) this.closeDeleteModal();
        });

        document.querySelectorAll('.nav-tab').forEach(tab => {
            tab.addEventListener('click', () => this.showPage(tab.dataset.page));
        });

        // Tablist keyboard support: arrows move + activate, Home/End jump.
        document.querySelector('.nav-tabs')?.addEventListener('keydown', e => {
            const tabs = [...document.querySelectorAll('.nav-tab')];
            const current = tabs.indexOf(document.activeElement);
            if (current === -1) return;
            let next = null;
            if (e.key === 'ArrowRight') next = (current + 1) % tabs.length;
            else if (e.key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length;
            else if (e.key === 'Home') next = 0;
            else if (e.key === 'End') next = tabs.length - 1;
            if (next === null) return;
            e.preventDefault();
            tabs[next].focus();
            this.showPage(tabs[next].dataset.page);
        });

        // #transactions-list is React-owned now (DashboardPage.tsx), which
        // attaches its own delegated click handler in a useEffect and calls
        // openEditModalById()/deleteTransaction() below directly — a
        // listener attached here at boot, before React mounts, would be
        // orphaned against React's freshly-created DOM node.

        qs('recurring-suggestions')?.addEventListener('click', e => {
            const btn = e.target.closest('[data-recurring-id]');
            if (btn) this.prefillFromRecurringId(btn.dataset.recurringId);
        });
    }

    // Mounts React-ported pages (see SCALABILITY_ROADMAP.md). Dynamically
    // imported so React is only downloaded after auth succeeds — an
    // unauthenticated visit (just the login screen) never pays for it.
    // Add Transaction is the page every session actually lands on, so its
    // chunk gets loaded and mounted first — the other 4 pages' chunks used
    // to load in an arbitrary order alongside it, competing for network/
    // main-thread priority right when boot matters most (see
    // SCALABILITY_ROADMAP.md's 2026-09-23 finding, which traced a real E2E
    // flake to this). They now load afterward, while the user is already
    // on and interacting with Add Transaction.
    async mountReactIslands() {
        const addTransactionRoot = document.getElementById('add-transaction-react-root');
        if (addTransactionRoot) {
            const { mountAddTransactionPage } = await import('./react/mount-add-transaction.tsx');
            mountAddTransactionPage(addTransactionRoot);
        }

        // Deliberately not awaited by the caller: these mount in the
        // background once the primary page is up, not before.
        this.mountSecondaryReactIslands();
    }

    async mountSecondaryReactIslands() {
        const dashboardRoot = document.getElementById('dashboard-react-root');
        if (dashboardRoot) {
            const { mountDashboardPage } = await import('./react/mount-dashboard.tsx');
            mountDashboardPage(dashboardRoot);
        }
        const accountsRoot = document.getElementById('accounts-react-root');
        if (accountsRoot) {
            const { mountAccountsPage } = await import('./react/mount-accounts.tsx');
            mountAccountsPage(accountsRoot);
        }
        const insightsRoot = document.getElementById('insights-react-root');
        if (insightsRoot) {
            const { mountInsightsPage } = await import('./react/mount-insights.tsx');
            mountInsightsPage(insightsRoot);
        }
        const categoriesRoot = document.getElementById('categories-react-root');
        if (categoriesRoot) {
            const { mountCategoriesPage } = await import('./react/mount-categories.tsx');
            mountCategoriesPage(categoriesRoot);
        }
        const budgetsRoot = document.getElementById('budgets-react-root');
        if (budgetsRoot) {
            const { mountBudgetsPage } = await import('./react/mount-budgets.tsx');
            mountBudgetsPage(budgetsRoot);
        }
    }

    showPage(pageId) {
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.querySelectorAll('.nav-tab').forEach(t => {
            const selected = t.dataset.page === pageId;
            t.classList.toggle('active', selected);
            t.setAttribute('aria-selected', String(selected));
            // Roving tabindex: only the active tab sits in the tab order.
            t.tabIndex = selected ? 0 : -1;
        });
        document.getElementById(pageId)?.classList.add('active');
    }

    syncSalaryAccountUI() {
        const sel = document.getElementById('salary-default-account');
        if (sel) sel.value = this.salaryAccount;
    }

    // ===============================
    // CATEGORY LOGIC
    // ===============================
    async loadCategories() {
        const raw = (await API.getCategories()) || [];
        this.categories = raw.sort((a, b) => a.name.localeCompare(b.name));

        // First-time giving-floor guess: used to happen inside the vanilla
        // renderBudgetLimitsUI(), called unconditionally from here — so it
        // ran at boot regardless of whether the user ever visited Budgets.
        // BudgetsPage.tsx repeats this guess on its own mount too (belt and
        // suspenders, idempotent), but Dashboard's giving-floor warning
        // needs this to have already run even if Budgets is never opened.
        if (!this.givingFloorCategory) {
            const guess = this.categories.find(
                c => c.type === 'expense' && /offering|tithe|giving|donation/i.test(c.name)
            );
            if (guess) this.givingFloorCategory = guess.name;
        }
    }

    // Rendering + add for this page now live in
    // src/react/pages/CategoriesPage.tsx, mounted into
    // #categories-react-root by mountReactIslands(). loadCategories()
    // above stays: this.categories still backs the giving-floor guess and
    // window.app.categories (read by DashboardPage.tsx for icons).

    // ===============================
    // PAYMENT ACCOUNTS / CARDS
    // ===============================
    async loadAccounts() {
        this.accounts = (await API.getAccounts()) || [];

        this.paymentSources = {};
        this.accounts.forEach(a => {
            if (!this.paymentSources[a.type]) this.paymentSources[a.type] = [];
            this.paymentSources[a.type].push(a.name);
        });

        this.populateSalaryAccountOptions();
    }

    // The salary-default-account select draws from UPI + debit-card accounts,
    // since that's what a salary deposit lands in.
    populateSalaryAccountOptions() {
        const sel = document.getElementById('salary-default-account');
        if (!sel) return;

        const names = [
            ...new Set([...(this.paymentSources.upi || []), ...(this.paymentSources['debit-card'] || [])])
        ];
        sel.innerHTML = names
            .map(n => `<option value="${this.escapeHtml(n)}">${this.escapeHtml(n)}</option>`)
            .join('');
        if (names.length === 0) sel.innerHTML = '<option value="">Add an account first</option>';

        if (!names.includes(this.salaryAccount) && names.length > 0) this.salaryAccount = names[0];
        this.syncSalaryAccountUI();
    }

    // Rendering + add/delete for this page now live in
    // src/react/pages/AccountsPage.tsx, mounted into #accounts-react-root
    // by mountReactIslands(). This method stays: it's the shared-state
    // hydration other pages' dropdowns (payment source, salary account)
    // depend on, via this.paymentSources / populateSalaryAccountOptions().

    // ===============================
    // BUDGET LIMITS
    // ===============================
    // Rendering + save for this page (budget limits + the Giving Floor
    // form) now live in src/react/pages/BudgetsPage.tsx, mounted into
    // #budgets-react-root by mountReactIslands(). That page writes
    // budgetLimits/givingFloorPct/givingFloorCategory straight to
    // localStorage and mutates this.* in place (there's no backend table
    // for these — they were always localStorage-only). The budget/giving-
    // floor warnings that used to render here (checkBudgetWarnings()/
    // checkOfferingFloor()) now live in src/react/pages/DashboardPage.tsx,
    // reading these same this.budgetLimits/givingFloorPct/
    // givingFloorCategory fields — same pattern InsightsPage already used.

    // ===============================
    // FORM LOGIC
    // ===============================
    // updateFormForSalary()/updateSourceDetailsOptions() (the add-transaction
    // form's own salary-toggle + source-details cascade) now live in
    // src/react/pages/AddTransactionPage.tsx as derived state. This one
    // stays: it's for the edit modal, which is still vanilla.
    updateEditSourceDetailsOptions() {
        const source = document.getElementById('edit-payment-source')?.value;
        const details = document.getElementById('edit-source-details');
        if (!details) return;

        details.innerHTML = '<option value="">Select Details</option>';

        const allSources = {
            upi: ['UBI', 'ICICI', 'SBI', 'Indian Bank'],
            'debit-card': ['UBI', 'ICICI', 'SBI', 'Indian Bank'],
            'credit-card': ['ICICI Amazon', 'ICICI Platinum', 'ICICI Coral', 'RBL', 'Union Bank'],
            cash: ['Cash'],
            salary: [this.salaryAccount]
        };

        if (allSources[source]) {
            allSources[source].forEach(s => {
                const opt = document.createElement('option');
                opt.value = s;
                opt.textContent = s;
                details.appendChild(opt);
            });
        }
    }

    // ===============================
    // TRANSACTIONS
    // ===============================
    // The add-transaction form itself now lives in
    // src/react/pages/AddTransactionPage.tsx (mounted into
    // #add-transaction-react-root), including its own submit handling.
    // This helper is what it (and the edit modal, and delete) call after
    // a mutation. Dashboard is React now too (DashboardPage.tsx), so this
    // just refreshes the shared transaction list + notifies it — same
    // crossPageSync pattern AccountsPage/CategoriesPage already use for
    // AddTransactionPage's independently-fetched data.
    async refreshTransactions() {
        this.transactions = (await API.getTransactions()) || [];
        this.suggestRecurringTransactions();
        notifyTransactionsChanged();
    }

    // Kept as a compatibility shim: BudgetsPage.tsx calls
    // window.app.updateDashboardStats(start, end) after saving budget
    // limits/the giving floor, since those changes affect Dashboard's
    // warnings but aren't a "transaction changed" event. Args are unused
    // now (DashboardPage recomputes from its own cycle selection) but the
    // call signature stays so BudgetsPage doesn't need to change.
    updateDashboardStats() {
        notifyTransactionsChanged();
    }

    // ===============================
    // EDIT MODAL
    // ===============================
    openEditModalById(id) {
        const tx = this.transactions.find(t => String(t.id) === String(id));
        if (tx) this.openEditModal(tx);
        else showNotification('Transaction not found.', 'error');
    }

    openEditModal(tx) {
        this.editingTransactionId = tx.id;
        const qs = id => document.getElementById(id);

        qs('edit-type').value = tx.type;
        qs('edit-amount').value = tx.amount;
        qs('edit-date').value = tx.transaction_date;
        qs('edit-payment-to').value = tx.payment_to || '';
        qs('edit-description').value = tx.description || '';

        const catSel = qs('edit-category');
        catSel.innerHTML = '';
        this.categories
            .filter(c => c.type === tx.type)
            .forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.name;
                opt.textContent = `${c.icon} ${c.name}`;
                if (c.name === tx.category) opt.selected = true;
                catSel.appendChild(opt);
            });

        const srcSel = qs('edit-payment-source');
        if (srcSel) {
            srcSel.value = tx.payment_source || '';
            this.updateEditSourceDetailsOptions();
            setTimeout(() => {
                const detSel = qs('edit-source-details');
                if (detSel) detSel.value = tx.source_details || '';
            }, 30);
        }

        openModal(qs('edit-modal-overlay'), () => this.closeEditModal());
    }

    closeEditModal() {
        closeModal(document.getElementById('edit-modal-overlay'));
        this.editingTransactionId = null;
    }

    async handleEditSubmit(e) {
        e.preventDefault();
        if (!this.editingTransactionId) return;

        const updated = {
            type: document.getElementById('edit-type').value,
            amount: parseFloat(document.getElementById('edit-amount').value),
            category: document.getElementById('edit-category').value,
            transaction_date: document.getElementById('edit-date').value,
            payment_to: document.getElementById('edit-payment-to').value,
            payment_source: document.getElementById('edit-payment-source')?.value || null,
            source_details: document.getElementById('edit-source-details')?.value || null,
            description: document.getElementById('edit-description').value || null
        };

        try {
            await API.updateTransaction(this.editingTransactionId, updated);
            this.closeEditModal();
            await this.refreshTransactions();
            showNotification('Transaction updated!');
        } catch (error) {
            showNotification('Error updating: ' + error.message, 'error');
        }
    }

    // ===============================
    // DELETE
    // ===============================
    deleteTransaction(id) {
        this.pendingDeleteId = id;
        openModal(document.getElementById('delete-modal-overlay'), () => this.closeDeleteModal());
    }

    closeDeleteModal() {
        closeModal(document.getElementById('delete-modal-overlay'));
        this.pendingDeleteId = null;
    }

    async confirmDelete() {
        if (!this.pendingDeleteId) return;
        const id = this.pendingDeleteId;
        this.closeDeleteModal();

        try {
            await API.deleteTransaction(id);
            await this.refreshTransactions();
            showNotification('Transaction deleted.');
        } catch (error) {
            showNotification('Error deleting: ' + error.message, 'error');
        }
    }

    // CSV export, cycle derivation/selection, dashboard stats/charts/
    // transaction-list rendering, and swipe-to-delete all now live in
    // src/react/pages/DashboardPage.tsx, mounted into #dashboard-react-
    // root. It writes window.app.currentCycleStart/currentCycleEnd back
    // (InsightsPage/BudgetsPage still read those) and owns its own click
    // delegation for edit/delete, calling the unchanged
    // openEditModalById()/deleteTransaction() below directly.

    // ===============================
    // RECURRING SUGGESTIONS
    // ===============================
    // A recurring transaction (Netflix on the 21st, Claude subscription, ...)
    // only becomes a suggestion once its next monthly due date has actually
    // arrived — not from the start of the salary cycle. Due date is the most
    // recent occurrence's date plus one calendar month.
    //
    // The giving-floor category is excluded here even if marked recurring:
    // it has no fixed schedule (you give what/when you choose), and it
    // already gets dynamic, any-day tracking from checkOfferingFloor — a
    // fixed monthly "due" date would just contradict that.
    suggestRecurringTransactions() {
        const container = document.getElementById('recurring-suggestions');
        if (!container) return;

        const recurringTxs = this.transactions.filter(
            t => t.is_recurring && t.category !== this.givingFloorCategory
        );
        if (recurringTxs.length === 0) {
            container.innerHTML = '';
            return;
        }

        const latest = {};
        recurringTxs.forEach(t => {
            const key = `${t.category}||${t.payment_to}||${t.payment_source}`;
            if (!latest[key] || t.transaction_date > latest[key].transaction_date) {
                latest[key] = t;
            }
        });

        const today = PFDates.todayStr();
        const suggestions = Object.values(latest)
            .map(t => ({ tx: t, nextDue: PFDates.addMonths(t.transaction_date, 1) }))
            .filter(({ nextDue }) => today >= nextDue);

        if (suggestions.length === 0) {
            container.innerHTML = '';
            return;
        }

        container.innerHTML = `
            <div class="recurring-suggestions-block">
                <h4>🔁 Recurring transactions due</h4>
                ${suggestions
                    .map(({ tx: t, nextDue }) => {
                        const cat = this.categories.find(c => c.name === t.category);
                        const icon = cat ? cat.icon : '📁';
                        const dueLabel = PFDates.parseLocal(nextDue).toLocaleDateString('en-IN', {
                            day: 'numeric',
                            month: 'short'
                        });
                        return `
                        <div class="recurring-suggestion-item">
                            <div class="recurring-info">
                                <span class="recurring-icon">${this.escapeHtml(icon)}</span>
                                <div>
                                    <strong>${this.escapeHtml(t.payment_to)}</strong>
                                    <small>${this.escapeHtml(t.category)} • ₹${Number(t.amount).toFixed(0)} • due ${this.escapeHtml(dueLabel)}</small>
                                </div>
                            </div>
                            <button class="btn btn-secondary btn-sm" data-recurring-id="${this.escapeHtml(String(t.id))}">
                                + Log it
                            </button>
                        </div>
                    `;
                    })
                    .join('')}
            </div>
        `;
    }

    prefillFromRecurringId(id) {
        const tx = this.transactions.find(t => String(t.id) === String(id));
        if (!tx) return;
        this.prefillFromRecurring(tx);
    }

    // The form itself is React now (AddTransactionPage.tsx) — native DOM
    // .value assignment can't update React-controlled input state, so this
    // goes through the window.__prefillAddTransactionForm bridge the
    // component registers on mount instead of touching the DOM directly.
    prefillFromRecurring(tx) {
        this.showPage('add-transaction');
        window.__prefillAddTransactionForm?.(tx);
    }

    escapeHtml(str) {
        return escapeHtml(str);
    }

}

// ===============================
// INIT APP
// ===============================
async function boot() {
    ThemeManager.init();

    const authContainer = document.getElementById('auth-container');
    const appContainer = document.querySelector('.container');

    // Tokens no longer live in localStorage; clean up the legacy key.
    localStorage.removeItem('session');

    // Session check: the HttpOnly cookie decides. API.me() transparently
    // refreshes an expired access token before giving up.
    let user = null;
    try {
        const data = await API.me();
        user = data?.user || null;
    } catch {
        /* not signed in */
    }

    if (!user) {
        authContainer.style.display = 'flex';
        appContainer.style.display = 'none';
        const authRoot = document.getElementById('auth-react-root');
        if (authRoot) {
            const { mountAuthPage } = await import('./react/mount-auth.tsx');
            mountAuthPage(authRoot);
        }
        return;
    }

    authContainer.style.display = 'none';
    appContainer.style.display = 'block';
    window.app = new ExpenseTracker(user);
}

// Module scripts are deferred, but guard both cases anyway.
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
}
