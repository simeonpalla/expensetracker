// ======================================================
// EXPENSE TRACKER — FRONTEND CONTROLLER (Vite entry point)
// ======================================================

import './style.css';
import './styleadditions.css';

import PFDates from './engine/dates.js';
import PFCycles from './engine/cycles.js';
import PFProjection from './engine/projection.js';
import { API } from './api.js';
import { escapeHtml, showNotification, withBusy, openModal, closeModal } from './ui.js';
import { loadChart } from './charts.js';

// The trackers register window.timeTracker / window.workoutTracker.
import './timetracker.js';
import './workouttracker.js';

// Make the toast available to the console / any stragglers.
window.showNotification = showNotification;

// ===============================
// AUTH HANDLERS
// ===============================
function showAuthError(message) {
    const errorDiv = document.getElementById('auth-error');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
    const successDiv = document.getElementById('auth-success');
    if (successDiv) successDiv.style.display = 'none';
}

function showAuthSuccess(message) {
    const successDiv = document.getElementById('auth-success');
    if (successDiv) {
        successDiv.textContent = message;
        successDiv.style.display = 'block';
    }
    document.getElementById('auth-error').style.display = 'none';
}

async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    document.getElementById('auth-error').style.display = 'none';

    await withBusy(e.submitter, '⏳ Signing in...', async () => {
        try {
            const data = await API.login(email, password);
            if (!data || !data.user) throw new Error('Login failed. Please check your credentials.');
            location.reload();
        } catch (err) {
            showAuthError(err.message || 'An error occurred during login.');
        }
    });
}

async function handleSignup(e) {
    e.preventDefault();
    const email = document.getElementById('signup-email').value;
    const password = document.getElementById('signup-password').value;
    const confirm = document.getElementById('signup-confirm').value;
    document.getElementById('auth-error').style.display = 'none';

    if (password !== confirm) {
        showAuthError('Passwords do not match.');
        return;
    }
    if (password.length < 8) {
        showAuthError('Password must be at least 8 characters.');
        return;
    }

    await withBusy(e.submitter, '⏳ Creating account...', async () => {
        try {
            const data = await API.signup(email, password);
            if (data && data.needsConfirmation) {
                showAuthSuccess('Account created! Check your email to confirm, then log in.');
                document.getElementById('signup-form').reset();
            } else if (data && data.user) {
                location.reload();
            } else {
                throw new Error('Signup failed.');
            }
        } catch (err) {
            showAuthError(err.message || 'An error occurred during signup.');
        }
    });
}

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
        this.chart = null;
        this.expenseDonutChart = null;
        this.currentChartView = 'source';

        this.salaryAccount = localStorage.getItem('salaryAccount') || 'UBI';
        this.currentCycleStart = null;
        this.currentCycleEnd = null;

        this.budgetLimits = JSON.parse(localStorage.getItem('budgetLimits') || '{}');

        this.paymentSources = {
            upi: ['UBI', 'ICICI', 'SBI', 'Indian Bank'],
            'debit-card': ['UBI', 'ICICI', 'SBI', 'Indian Bank'],
            'credit-card': ['ICICI Amazon', 'ICICI Platinum', 'ICICI Coral', 'RBL', 'Union Bank'],
            cash: ['Cash']
        };

        this.editingTransactionId = null;
        this.pendingDeleteId = null;

        this.init();
    }

    async init() {
        if (!this._listenersAttached) {
            this.setupEventListeners();
            this._listenersAttached = true;
        }
        this.setTodayDate();
        this.syncSalaryAccountUI();

        document.getElementById('status-dot').className = 'status-dot connecting';
        document.getElementById('status-text').textContent = 'Fetching data...';

        try {
            await this.loadCategories();
            this.transactions = (await API.getTransactions()) || [];

            document.getElementById('status-dot').className = 'status-dot connected';
            document.getElementById('status-text').textContent = 'Connected';

            this.updateSourceDetailsOptions();
            this.loadCycleHistory();
            this.showPage('add-transaction');

            if (window.timeTracker)
                window.timeTracker.init().catch(err => console.error('TimeTracker init failed', err));
            if (window.workoutTracker)
                window.workoutTracker.init().catch(err => console.error('WorkoutTracker init failed', err));
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

        qs('transaction-form')?.addEventListener('submit', e => this.handleTransactionSubmit(e));
        qs('category-form')?.addEventListener('submit', e => this.handleCategorySubmit(e));
        qs('type')?.addEventListener('change', () => {
            this.populateCategoryDropdowns();
            this.updateFormForSalary();
        });
        qs('category')?.addEventListener('change', () => this.updateFormForSalary());
        qs('payment-source')?.addEventListener('change', () => this.updateSourceDetailsOptions());
        qs('filter-type')?.addEventListener('change', () => this.displayTransactions());
        qs('filter-category')?.addEventListener('change', () => this.displayTransactions());
        qs('cycle-history')?.addEventListener('change', () => this.handleCycleChange());
        qs('clear-form-btn')?.addEventListener('click', () => this.resetForm());
        qs('logout-btn')?.addEventListener('click', handleLogout);
        qs('generate-local-ai-btn')?.addEventListener('click', () => this.generateLocalAIInsights());
        qs('reset-chart-view-btn')?.addEventListener('click', () => this.renderChartBySource());
        qs('export-csv-btn')?.addEventListener('click', () => this.exportCSV());

        qs('salary-settings-form')?.addEventListener('submit', e => {
            e.preventDefault();
            const val = qs('salary-default-account')?.value;
            if (val) {
                this.salaryAccount = val;
                localStorage.setItem('salaryAccount', val);
                showNotification('Salary account updated to ' + val);
            }
        });

        qs('budget-limits-form')?.addEventListener('submit', e => {
            e.preventDefault();
            this.saveBudgetLimits();
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

        // Life report button
        qs('generate-life-report-btn')?.addEventListener('click', () => this.generateLifeReport());

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

        // Delegated clicks for list rows rendered via innerHTML (no inline
        // handlers: they are blocked by the CSP).
        qs('transactions-list')?.addEventListener('click', e => {
            const editBtn = e.target.closest('.edit-btn');
            if (editBtn) {
                this.openEditModalById(editBtn.dataset.id);
                return;
            }
            const deleteBtn = e.target.closest('.delete-btn');
            if (deleteBtn) {
                this.deleteTransaction(deleteBtn.dataset.id);
                return;
            }
            const swipeBg = e.target.closest('.swipe-delete-bg');
            if (swipeBg) this.deleteTransaction(swipeBg.dataset.id);
        });

        qs('recurring-suggestions')?.addEventListener('click', e => {
            const btn = e.target.closest('[data-recurring-id]');
            if (btn) this.prefillFromRecurringId(btn.dataset.recurringId);
        });
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

        if (pageId === 'budgets') this.renderBudgetLimitsUI();

        if (pageId === 'time-tracker' && window.timeTracker) {
            window.timeTracker.init().then(() => window.timeTracker.renderAll());
        }
        if (pageId === 'workout-tracker' && window.workoutTracker) {
            window.workoutTracker.init().then(() => window.workoutTracker.renderAll());
        }
    }

    setTodayDate() {
        const el = document.getElementById('date');
        if (el) el.value = PFDates.todayStr();
    }

    syncSalaryAccountUI() {
        const sel = document.getElementById('salary-default-account');
        if (sel) sel.value = this.salaryAccount;
    }

    resetForm() {
        document.getElementById('transaction-form')?.reset();
        this.setTodayDate();
        this.populateCategoryDropdowns();
        this.updateSourceDetailsOptions();
        this.updateFormForSalary();
    }

    // ===============================
    // CATEGORY LOGIC
    // ===============================
    async loadCategories() {
        const raw = (await API.getCategories()) || [];
        this.categories = raw.sort((a, b) => a.name.localeCompare(b.name));
        this.populateCategoryDropdowns();
        this.displayCategories();
        this.renderBudgetLimitsUI();
    }

    populateCategoryDropdowns() {
        const type = document.getElementById('type')?.value;
        const select = document.getElementById('category');
        const filter = document.getElementById('filter-category');

        if (select) {
            select.innerHTML = '<option value="">Select Category</option>';
            this.categories
                .filter(c => !type || c.type === type)
                .sort((a, b) => a.name.localeCompare(b.name))
                .forEach(c => {
                    const opt = document.createElement('option');
                    opt.value = c.name;
                    opt.textContent = `${c.icon} ${c.name}`;
                    select.appendChild(opt);
                });
        }

        if (filter) {
            filter.innerHTML = '<option value="">All Categories</option>';
            this.categories
                .sort((a, b) => a.name.localeCompare(b.name))
                .forEach(c => {
                    const opt = document.createElement('option');
                    opt.value = c.name;
                    opt.textContent = `${c.icon} ${c.name}`;
                    filter.appendChild(opt);
                });
        }
    }

    displayCategories() {
        const incomeDiv = document.getElementById('income-categories');
        const expenseDiv = document.getElementById('expense-categories');
        if (!incomeDiv || !expenseDiv) return;

        incomeDiv.innerHTML = '';
        expenseDiv.innerHTML = '';

        this.categories.forEach(c => {
            const div = document.createElement('div');
            div.className = 'category-item';
            div.innerHTML = `<span class="category-icon">${this.escapeHtml(c.icon)}</span><span class="category-name">${this.escapeHtml(c.name)}</span>`;
            if (c.type === 'income') incomeDiv.appendChild(div);
            else expenseDiv.appendChild(div);
        });
    }

    async handleCategorySubmit(e) {
        e.preventDefault();
        const category = {
            name: document.getElementById('category-name').value.trim(),
            type: document.getElementById('category-type').value,
            icon: document.getElementById('category-icon').value.trim() || '📁'
        };

        try {
            await API.addCategory(category);
            await this.loadCategories();
            e.target.reset();
            showNotification('Category added successfully!');
        } catch (error) {
            showNotification('Error adding category: ' + error.message, 'error');
        }
    }

    // ===============================
    // BUDGET LIMITS
    // ===============================
    renderBudgetLimitsUI() {
        const container = document.getElementById('budget-limits-container');
        if (!container) return;

        const expenseCategories = this.categories.filter(c => c.type === 'expense');
        if (expenseCategories.length === 0) {
            container.innerHTML =
                '<p style="color: var(--text2); font-size: 0.9rem;">Add expense categories first.</p>';
            return;
        }

        container.innerHTML = expenseCategories
            .map(
                c => `
            <div class="budget-limit-row">
                <label>${this.escapeHtml(c.icon)} ${this.escapeHtml(c.name)}</label>
                <div class="budget-input-wrap">
                    <span class="rupee-symbol">₹</span>
                    <input type="number" min="0" step="1"
                           class="budget-limit-input"
                           data-category="${this.escapeHtml(c.name)}"
                           placeholder="No limit"
                           value="${this.budgetLimits[c.name] || ''}">
                </div>
            </div>
        `
            )
            .join('');
    }

    saveBudgetLimits() {
        const inputs = document.querySelectorAll('.budget-limit-input');
        inputs.forEach(input => {
            const cat = input.dataset.category;
            const val = parseFloat(input.value);
            if (val > 0) this.budgetLimits[cat] = val;
            else delete this.budgetLimits[cat];
        });
        localStorage.setItem('budgetLimits', JSON.stringify(this.budgetLimits));
        showNotification('Budget limits saved!');
        if (this.currentCycleStart) this.updateDashboardStats(this.currentCycleStart, this.currentCycleEnd);
    }

    checkBudgetWarnings(cycleTxs) {
        const container = document.getElementById('budget-warnings');
        if (!container) return;

        const spendByCategory = {};
        cycleTxs
            .filter(t => t.type === 'expense')
            .forEach(t => {
                spendByCategory[t.category] = (spendByCategory[t.category] || 0) + Number(t.amount);
            });

        const warnings = [];
        Object.entries(this.budgetLimits).forEach(([cat, limit]) => {
            const spent = spendByCategory[cat] || 0;
            const pct = (spent / limit) * 100;
            if (pct >= 80) {
                const catObj = this.categories.find(c => c.name === cat);
                const icon = catObj ? catObj.icon : '📁';
                warnings.push({
                    cat,
                    icon,
                    spent,
                    limit,
                    pct: Math.min(pct, 100).toFixed(0),
                    over: pct > 100
                });
            }
        });

        if (warnings.length === 0) {
            container.innerHTML = '';
            return;
        }

        container.innerHTML = `
            <div class="budget-warnings-block">
                ${warnings
                    .map(
                        w => `
                    <div class="budget-warning-item ${w.over ? 'over-budget' : 'near-budget'}">
                        <div class="budget-warning-header">
                            <span>${this.escapeHtml(w.icon)} ${this.escapeHtml(w.cat)}</span>
                            <span class="budget-badge">${w.over ? '🚨 Over budget' : '⚠️ ' + w.pct + '%'}</span>
                        </div>
                        <div class="budget-bar-track">
                            <div class="budget-bar-fill" style="width: ${Math.min(parseFloat(w.pct), 100)}%; background: ${w.over ? 'var(--expense)' : 'var(--warning)'};"></div>
                        </div>
                        <div class="budget-bar-labels">
                            <span>₹${w.spent.toFixed(0)} spent</span>
                            <span>₹${w.limit} limit</span>
                        </div>
                    </div>
                `
                    )
                    .join('')}
            </div>
        `;
    }

    // ===============================
    // FORM LOGIC
    // ===============================
    updateFormForSalary() {
        const typeSelect = document.getElementById('type');
        const categorySelect = document.getElementById('category');
        const paymentSourceSelect = document.getElementById('payment-source');
        const sourceDetailsSelect = document.getElementById('source-details');

        const isSalary =
            typeSelect?.value === 'income' &&
            (categorySelect?.value || '').trim().toLowerCase().includes('salary');

        if (isSalary) {
            if (paymentSourceSelect) {
                paymentSourceSelect.innerHTML = '<option value="salary" selected>Salary Deposit</option>';
                paymentSourceSelect.disabled = true;
            }
            if (sourceDetailsSelect) {
                sourceDetailsSelect.innerHTML = `<option value="${this.salaryAccount}" selected>${this.salaryAccount}</option>`;
                sourceDetailsSelect.disabled = true;
                sourceDetailsSelect.closest('.form-group').style.display = 'block';
            }
        } else {
            if (paymentSourceSelect && paymentSourceSelect.disabled) {
                paymentSourceSelect.innerHTML = `
                    <option value="">Select Source</option>
                    <option value="upi">UPI</option>
                    <option value="credit-card">Credit Card</option>
                    <option value="debit-card">Debit Card</option>
                    <option value="cash">Cash</option>
                `;
                paymentSourceSelect.disabled = false;
            }
            if (sourceDetailsSelect) sourceDetailsSelect.disabled = false;
            this.updateSourceDetailsOptions();
        }
    }

    updateSourceDetailsOptions() {
        const source = document.getElementById('payment-source')?.value;
        const details = document.getElementById('source-details');
        if (!details) return;

        details.innerHTML = '<option value="">Select Details</option>';
        const sourceGroup = details.closest('.form-group');

        if (this.paymentSources[source]) {
            if (sourceGroup) sourceGroup.style.display = 'block';
            details.required = true;
            this.paymentSources[source].forEach(s => {
                const opt = document.createElement('option');
                opt.value = s;
                opt.textContent = s;
                details.appendChild(opt);
            });
        } else {
            if (sourceGroup) sourceGroup.style.display = source ? 'block' : 'none';
            details.required = false;
        }
    }

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
    async handleTransactionSubmit(e) {
        e.preventDefault();

        const isRecurring = document.getElementById('is-recurring')?.checked || false;

        const tx = {
            type: document.getElementById('type').value,
            amount: parseFloat(document.getElementById('amount').value),
            category: document.getElementById('category').value,
            transaction_date: document.getElementById('date').value,
            description: document.getElementById('description').value || null,
            payment_to: document.getElementById('payment-to').value,
            payment_source: document.getElementById('payment-source').value || 'salary',
            source_details: document.getElementById('source-details').value || this.salaryAccount,
            is_recurring: isRecurring
        };

        await withBusy(e.submitter, '💾 Saving...', async () => {
            try {
                await API.addTransaction(tx);
                this.resetForm();
                this.transactions = (await API.getTransactions()) || [];
                this.loadCycleHistory();
                showNotification('Transaction saved!');
            } catch (error) {
                showNotification('Error saving transaction: ' + error.message, 'error');
            }
        });
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
            this.transactions = (await API.getTransactions()) || [];
            this.loadCycleHistory();
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
            this.transactions = (await API.getTransactions()) || [];
            this.loadCycleHistory();
            showNotification('Transaction deleted.');
        } catch (error) {
            showNotification('Error deleting: ' + error.message, 'error');
        }
    }

    // ===============================
    // CSV EXPORT
    // ===============================
    exportCSV() {
        const cycleTxs = this.getTransactionsInCycle(this.currentCycleStart, this.currentCycleEnd);
        if (!cycleTxs.length) {
            showNotification('No transactions to export.', 'error');
            return;
        }

        const headers = [
            'Date',
            'Type',
            'Category',
            'Amount',
            'Payment To',
            'Payment Source',
            'Bank/Card',
            'Description',
            'Recurring'
        ];
        // RFC 4180: quote cells containing commas/quotes/newlines and double
        // embedded quotes. Cells starting with formula characters get a
        // leading apostrophe so spreadsheets treat them as text (CSV
        // injection guard).
        const cell = v => {
            let s = v == null ? '' : String(v);
            if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
            if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
            return s;
        };

        const rows = cycleTxs.map(t =>
            [
                t.transaction_date,
                t.type,
                t.category,
                Number(t.amount),
                t.payment_to || '',
                t.payment_source || '',
                t.source_details || '',
                t.description || '',
                t.is_recurring ? 'Yes' : 'No'
            ]
                .map(cell)
                .join(',')
        );

        const csv = [headers.join(','), ...rows].join('\r\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `expenses_${this.currentCycleStart}_to_${this.currentCycleEnd}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        showNotification('CSV exported!');
    }

    // ===============================
    // CYCLE MANAGEMENT
    // ===============================
    loadCycleHistory() {
        const selector = document.getElementById('cycle-history');
        if (!selector) return;

        const today = PFDates.todayStr();
        const cycles = PFCycles.deriveCycles(this.transactions, today);
        const nice = d =>
            PFDates.parseLocal(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

        selector.innerHTML = '';
        cycles.forEach(c => {
            const option = document.createElement('option');
            option.value = `${c.start}|${c.end}`;
            option.textContent = c.fallback
                ? 'Current Month'
                : c.isCurrent
                  ? `Current: Since ${nice(c.start)}`
                  : `${nice(c.start)} – ${nice(c.end)}`;
            selector.appendChild(option);
        });

        selector.selectedIndex = 0;
        this.handleCycleChange();
    }

    handleCycleChange() {
        const selector = document.getElementById('cycle-history');
        const value = selector.value;
        if (!value || !value.includes('|')) return;
        const [startDate, endDate] = value.split('|');
        this.loadSpecificCycle(startDate, endDate);
    }

    loadSpecificCycle(startDate, endDate) {
        this.currentCycleStart = startDate;
        this.currentCycleEnd = endDate;

        const chartTitle = document.getElementById('line-chart-title');
        const s = PFDates.parseLocal(startDate).toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short'
        });
        const e = PFDates.parseLocal(endDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
        if (chartTitle) chartTitle.innerHTML = `📈 Trends: ${s} to ${e}`;

        this.updateDashboardStats(startDate, endDate);
        this.displayTransactions();
        this.renderLineChart(startDate, endDate);
        this.renderChartBySource(startDate, endDate);
        this.suggestRecurringTransactions(startDate);
    }

    getTransactionsInCycle(startDate, endDate) {
        return PFCycles.transactionsInCycle(this.transactions, startDate, endDate);
    }

    // ===============================
    // RECURRING SUGGESTIONS
    // ===============================
    suggestRecurringTransactions(currentCycleStart) {
        const container = document.getElementById('recurring-suggestions');
        if (!container) return;

        const recurringTxs = this.transactions.filter(
            t => t.is_recurring && t.transaction_date < currentCycleStart
        );

        if (recurringTxs.length === 0) {
            container.innerHTML = '';
            return;
        }

        const seen = {};
        recurringTxs.forEach(t => {
            const key = `${t.category}||${t.payment_to}||${t.payment_source}`;
            if (!seen[key] || t.transaction_date > seen[key].transaction_date) {
                seen[key] = t;
            }
        });

        const currentTxs = this.getTransactionsInCycle(currentCycleStart, this.currentCycleEnd);
        const suggestions = Object.values(seen).filter(
            t => !currentTxs.some(ct => ct.category === t.category && ct.payment_to === t.payment_to)
        );

        if (suggestions.length === 0) {
            container.innerHTML = '';
            return;
        }

        container.innerHTML = `
            <div class="recurring-suggestions-block">
                <h4>🔁 Recurring transactions due this cycle</h4>
                ${suggestions
                    .map(t => {
                        const cat = this.categories.find(c => c.name === t.category);
                        const icon = cat ? cat.icon : '📁';
                        return `
                        <div class="recurring-suggestion-item">
                            <div class="recurring-info">
                                <span class="recurring-icon">${this.escapeHtml(icon)}</span>
                                <div>
                                    <strong>${this.escapeHtml(t.payment_to)}</strong>
                                    <small>${this.escapeHtml(t.category)} • ₹${Number(t.amount).toFixed(0)} • ${this.escapeHtml(t.payment_source || '')}</small>
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

    prefillFromRecurring(tx) {
        this.showPage('add-transaction');
        setTimeout(() => {
            document.getElementById('type').value = tx.type;
            this.populateCategoryDropdowns();
            document.getElementById('category').value = tx.category;
            document.getElementById('amount').value = tx.amount;
            document.getElementById('payment-to').value = tx.payment_to || '';
            document.getElementById('description').value = tx.description || '';
            document.getElementById('is-recurring').checked = true;

            const psEl = document.getElementById('payment-source');
            psEl.value = tx.payment_source || '';
            this.updateSourceDetailsOptions();
            setTimeout(() => {
                document.getElementById('source-details').value = tx.source_details || '';
            }, 50);

            this.updateFormForSalary();
            showNotification('Form pre-filled from recurring transaction.');
        }, 100);
    }

    escapeHtml(str) {
        return escapeHtml(str);
    }

    // ===============================
    // DISPLAY TRANSACTIONS
    // ===============================
    displayTransactions() {
        const list = document.getElementById('transactions-list');
        const filterType = document.getElementById('filter-type')?.value;
        const filterCategory = document.getElementById('filter-category')?.value;

        if (!list) return;

        let filtered = this.getTransactionsInCycle(this.currentCycleStart, this.currentCycleEnd);
        if (filterType) filtered = filtered.filter(t => t.type === filterType);
        if (filterCategory) filtered = filtered.filter(t => t.category === filterCategory);

        if (!filtered.length) {
            list.innerHTML = '<div class="loading">No transactions found</div>';
            return;
        }

        list.innerHTML = filtered
            .map(t => {
                const cat = this.categories.find(c => c.name === t.category);
                const icon = cat ? cat.icon : '📁';
                return `
            <div class="transaction-item" data-id="${this.escapeHtml(String(t.id))}">
                <div class="transaction-swipe-wrapper">
                    <div class="transaction-content">
                        <div class="transaction-details">
                            <strong>${this.escapeHtml(icon)} ${this.escapeHtml(t.category)}${t.is_recurring ? '<span class="recurring-badge">🔁 recurring</span>' : ''}</strong>
                            <small>${this.escapeHtml(t.transaction_date)} · ${this.escapeHtml(t.payment_to || 'N/A')} · ${this.escapeHtml(t.payment_source || '')}</small>
                        </div>
                        <div class="transaction-right">
                            <div class="${t.type === 'income' ? 'income' : 'expense'}">
                                ${t.type === 'income' ? '+' : '−'}₹${Number(t.amount).toFixed(2)}
                            </div>
                            <div class="transaction-actions">
                                <button class="tx-action-btn edit-btn" data-id="${this.escapeHtml(String(t.id))}" title="Edit" aria-label="Edit transaction">✏️</button>
                                <button class="tx-action-btn delete-btn" data-id="${this.escapeHtml(String(t.id))}" title="Delete" aria-label="Delete transaction">🗑️</button>
                            </div>
                        </div>
                    </div>
                    <div class="swipe-delete-bg" data-id="${this.escapeHtml(String(t.id))}">
                        🗑️ Delete
                    </div>
                </div>
            </div>
        `;
            })
            .join('');

        this.setupSwipeToDelete(list);
    }

    setupSwipeToDelete(list) {
        list.querySelectorAll('.transaction-item').forEach(item => {
            const wrapper = item.querySelector('.transaction-swipe-wrapper');
            const content = item.querySelector('.transaction-content');
            let startX = 0,
                currentX = 0,
                isDragging = false;

            const onStart = x => {
                startX = x;
                isDragging = true;
            };
            const onMove = x => {
                if (!isDragging) return;
                currentX = x - startX;
                if (currentX < 0) {
                    content.style.transform = `translateX(${Math.max(currentX, -80)}px)`;
                    content.style.transition = 'none';
                }
            };
            const onEnd = () => {
                if (!isDragging) return;
                isDragging = false;
                content.style.transition = 'transform 0.2s ease';
                if (currentX < -60) {
                    content.style.transform = 'translateX(-80px)';
                    wrapper.classList.add('swiped');
                } else {
                    content.style.transform = 'translateX(0)';
                    wrapper.classList.remove('swiped');
                }
                currentX = 0;
            };

            content.addEventListener('touchstart', e => onStart(e.touches[0].clientX), { passive: true });
            content.addEventListener('touchmove', e => onMove(e.touches[0].clientX), { passive: true });
            content.addEventListener('touchend', onEnd);
        });
    }

    // ===============================
    // DASHBOARD STATS
    // ===============================
    updateDashboardStats(startDate, endDate) {
        const cycleTxs = this.getTransactionsInCycle(startDate, endDate);
        let income = 0,
            expenses = 0;

        cycleTxs.forEach(t => {
            if (t.type === 'income') income += Number(t.amount);
            if (t.type === 'expense') expenses += Number(t.amount);
        });

        this.calculateRunRate(cycleTxs, startDate, income);
        this.checkBudgetWarnings(cycleTxs);

        const balance = income - expenses;
        document.getElementById('total-income').textContent = `₹${income.toFixed(2)}`;
        document.getElementById('total-expenses').textContent = `₹${expenses.toFixed(2)}`;
        document.getElementById('net-balance').textContent = `₹${balance.toFixed(2)}`;

        const streak = PFCycles.noSpendStreak(cycleTxs, startDate, PFDates.todayStr());
        document.getElementById('current-streak').textContent = `${streak.currentStreak} Days`;
        document.getElementById('best-streak').textContent = `Best: ${streak.bestStreak} days`;
    }

    calculateRunRate(cycleTxs, startDate, income) {
        const { projectedBalance } = PFProjection.projectCycle(
            this.transactions,
            startDate,
            PFDates.todayStr()
        );

        const runRateEl = document.getElementById('run-rate');
        const riskCard = document.getElementById('risk-card');
        if (!runRateEl || income === 0) return;

        if (projectedBalance < 0) {
            runRateEl.innerHTML = `<span style="color: var(--expense-text);">Short by ₹${Math.abs(projectedBalance).toFixed(0)}</span>`;
            if (riskCard) riskCard.style.borderLeft = '4px solid var(--expense)';
        } else if (projectedBalance < income * 0.1) {
            runRateEl.innerHTML = `<span style="color: var(--warning);">₹${projectedBalance.toFixed(0)} leftover (thin margin)</span>`;
            if (riskCard) riskCard.style.borderLeft = '4px solid var(--warning)';
        } else {
            runRateEl.innerHTML = `<span style="color: var(--income-text);">+₹${projectedBalance.toFixed(0)} projected surplus</span>`;
            if (riskCard) riskCard.style.borderLeft = '4px solid var(--income)';
        }
    }

    // ===============================
    // CHARTS
    // ===============================
    async renderLineChart(startDate, endDate) {
        const cycleTxs = this.getTransactionsInCycle(startDate, endDate);

        const today = PFDates.todayStr();
        const chartEnd = endDate < today ? endDate : today;
        const days = PFDates.eachDay(startDate, chartEnd);

        const labels = days.map(d =>
            PFDates.parseLocal(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
        );

        const dailyData = {};
        days.forEach(d => {
            dailyData[d] = 0;
        });
        cycleTxs.forEach(t => {
            if (t.type === 'expense' && dailyData[t.transaction_date] !== undefined) {
                dailyData[t.transaction_date] += Number(t.amount);
            }
        });
        const expenses = days.map(d => dailyData[d]);

        const trendData = PFProjection.linearRegression(expenses).trend;

        const canvas = document.getElementById('chart');
        if (!canvas) return;
        const Chart = await loadChart();
        if (this.chart) this.chart.destroy();

        this.chart = new Chart(canvas.getContext('2d'), {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Daily Expenses',
                        data: expenses,
                        borderColor: '#ff5c72',
                        backgroundColor: 'rgba(255,92,114,0.08)',
                        fill: true,
                        tension: 0.4,
                        pointRadius: 3,
                        pointBackgroundColor: '#ff5c72'
                    },
                    {
                        label: 'Trend',
                        data: trendData,
                        borderColor: '#f5a623',
                        borderWidth: 2,
                        borderDash: [6, 4],
                        pointRadius: 0,
                        fill: false,
                        tension: 0
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: true, position: 'top' } },
                scales: { y: { beginAtZero: true } }
            }
        });
    }

    renderChartBySource(startDate = this.currentCycleStart, endDate = this.currentCycleEnd) {
        this.currentChartView = 'source';
        document.getElementById('reset-chart-view-btn').style.display = 'none';

        const cycleTxs = this.getTransactionsInCycle(startDate, endDate).filter(t => t.type === 'expense');
        const sourceData = cycleTxs.reduce((acc, t) => {
            const src = t.payment_source || 'Unknown';
            acc[src] = (acc[src] || 0) + Number(t.amount);
            return acc;
        }, {});

        this.renderDonutChart(Object.keys(sourceData), Object.values(sourceData), 'Expenses by Source');
    }

    renderChartByCategory(source) {
        this.currentChartView = 'category';
        document.getElementById('reset-chart-view-btn').style.display = 'inline-block';

        const cycleTxs = this.getTransactionsInCycle(this.currentCycleStart, this.currentCycleEnd).filter(
            t => t.type === 'expense' && (t.payment_source || 'Unknown') === source
        );

        const categoryData = cycleTxs.reduce((acc, t) => {
            acc[t.category || 'Uncategorized'] = (acc[t.category || 'Uncategorized'] || 0) + Number(t.amount);
            return acc;
        }, {});

        this.renderDonutChart(
            Object.keys(categoryData),
            Object.values(categoryData),
            `Expenses via ${source}`
        );
    }

    async renderDonutChart(labels, data, title) {
        const canvas = document.getElementById('expense-donut-chart');
        if (!canvas) return;
        document.getElementById('donut-chart-title').textContent = title;
        const Chart = await loadChart();
        if (this.expenseDonutChart) this.expenseDonutChart.destroy();

        this.expenseDonutChart = new Chart(canvas.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels,
                datasets: [
                    {
                        data,
                        backgroundColor: ['#7c6aff', '#00d4aa', '#f5a623', '#ff5c72', '#3b82f6', '#c44dff'],
                        borderWidth: 2,
                        borderColor: 'transparent'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                onClick: (evt, elements) => {
                    if (elements.length > 0 && this.currentChartView === 'source') {
                        this.renderChartByCategory(labels[elements[0].index]);
                    }
                }
            }
        });
    }

    // ===============================
    // LOCAL AI INSIGHTS
    // ===============================
    generateLocalAIInsights() {
        const loading = document.getElementById('local-ai-loading');
        const result = document.getElementById('local-ai-result');
        if (!loading || !result) return;

        loading.style.display = 'block';
        result.style.display = 'none';

        setTimeout(() => {
            const allTxs = this.transactions || [];
            const currentStart = this.currentCycleStart;
            const currentEnd = this.currentCycleEnd;

            const currentTxs = this.getTransactionsInCycle(currentStart, currentEnd);
            const historicalTxs = allTxs.filter(t => t.transaction_date < currentStart);

            if (currentTxs.length < 3) {
                result.innerHTML = `<p class="ai-empty">Log a few more transactions in this cycle before I can run a full audit.</p>`;
                loading.style.display = 'none';
                result.style.display = 'block';
                return;
            }

            let income = 0,
                expenses = 0;
            const currentSpend = {};

            currentTxs.forEach(t => {
                const amount = Number(t.amount);
                if (t.type === 'income') income += amount;
                if (t.type === 'expense') {
                    expenses += amount;
                    currentSpend[t.category] = (currentSpend[t.category] || 0) + amount;
                }
            });

            const today = PFDates.todayStr();

            const historicalMonths = PFProjection.historicalMonths(this.transactions, currentStart);
            const historicalSpend = PFProjection.spendByCategory(historicalTxs);
            const anomalies =
                historicalTxs.length > 0
                    ? PFProjection.computeAnomalies(currentSpend, historicalSpend, historicalMonths)
                    : [];

            const proj = PFProjection.projectCycle(this.transactions, currentStart, today);
            const { dailyBurnRate, daysRemaining, projectedBalance } = proj;

            const sortedCategories = Object.entries(currentSpend).sort((a, b) => b[1] - a[1]);
            const topSpender = sortedCategories.length > 0 ? sortedCategories[0] : null;

            let top3Spend = 0;
            sortedCategories.slice(0, 3).forEach(c => (top3Spend += c[1]));
            const paretoRatio = expenses > 0 ? ((top3Spend / expenses) * 100).toFixed(0) : 0;
            const savingsRate = income > 0 ? (((income - expenses) / income) * 100).toFixed(0) : 0;

            const expenseTxs = allTxs.filter(t => t.type === 'expense');
            const { weekendAvg, weekdayAvg } = PFProjection.weekendWeekdayStats(expenseTxs);

            const cycleExpenses = PFProjection.cycleExpenseTotals(this.transactions, today).map(c => ({
                label: PFDates.parseLocal(c.start).toLocaleDateString('en-IN', {
                    day: 'numeric',
                    month: 'short'
                }),
                total: c.total,
                start: c.start
            }));

            let html = `<div class="insights-body">`;

            const section = (num, title, content) => `
                <div class="insight-section">
                    <div class="insight-section-header">
                        <span class="insight-num">${num}</span>
                        <h4>${title}</h4>
                    </div>
                    <div class="insight-content">${content}</div>
                </div>
            `;

            // 1. The Audit
            let auditContent = '';
            if (historicalTxs.length === 0) {
                auditContent = `<p class="insight-muted">Baseline comparison requires at least one prior cycle. Keep logging data.</p>`;
            } else if (anomalies.length === 0) {
                auditContent = `<div class="insight-badge insight-badge--green">✅ No significant overspending detected against your ${historicalMonths.toFixed(1)}-month baseline.</div>`;
            } else {
                auditContent = `<p class="insight-muted" style="margin-bottom:10px;">Variances against your ${historicalMonths.toFixed(1)}-month average:</p>`;
                anomalies.forEach(a => {
                    auditContent += `
                        <div class="insight-anomaly-row">
                            <div class="insight-anomaly-header">
                                <strong>${this.escapeHtml(a.cat)}</strong>
                                <span class="insight-pill insight-pill--red">+${a.pct.toFixed(0)}%</span>
                            </div>
                            <div class="insight-anomaly-values">
                                Current: <b>₹${a.currentAmt.toFixed(0)}</b> &nbsp;·&nbsp; Avg: <b>₹${a.histAvg.toFixed(0)}</b>
                                <span class="insight-pill--delta">+₹${a.diff.toFixed(0)}</span>
                            </div>
                        </div>`;
                });
            }
            html += section('01', 'The Audit', auditContent);

            // 2. Corrective Measures
            let correctiveContent = '';
            if (anomalies.length === 0) {
                correctiveContent = `<p class="insight-muted">No immediate corrections required. Maintain current trajectory.</p>`;
            } else {
                anomalies.slice(0, 2).forEach((a, i) => {
                    correctiveContent += `
                        <div class="insight-action-row">
                            <div class="insight-action-label">Action ${i + 1}: Re-peg ${this.escapeHtml(a.cat)}</div>
                            <div class="insight-action-body">Target ₹<b>${(a.histAvg * 0.95).toFixed(0)}</b> next cycle (5% below baseline) to offset the ₹${a.diff.toFixed(0)} variance.</div>
                        </div>`;
                });
            }
            html += section('02', 'Corrective Measures', correctiveContent);

            // 3. Run-Rate Status
            let runContent;
            if (projectedBalance < 0) {
                runContent = `<div class="insight-badge insight-badge--red">🚨 Deficit Projected — burning ₹${dailyBurnRate.toFixed(0)}/day. Short by <b>₹${Math.abs(projectedBalance).toFixed(0)}</b>. Freeze non-essential spending.</div>`;
            } else if (projectedBalance < income * 0.1) {
                runContent = `<div class="insight-badge insight-badge--amber">⚠️ Low Margins — ₹${projectedBalance.toFixed(0)} leftover. Reduce to ₹<b>${((income * 0.9 - expenses) / (daysRemaining || 1)).toFixed(0)}</b>/day.</div>`;
            } else {
                runContent = `<div class="insight-badge insight-badge--green">✅ Surplus Projected — controlled burn of ₹${dailyBurnRate.toFixed(0)}/day. On track for <b>+₹${projectedBalance.toFixed(0)}</b>.</div>`;
            }
            html += section('03', 'Run-Rate Status', runContent);

            // 4. Target the Leak
            let leakContent;
            if (topSpender && expenses > 0) {
                const leakPct = ((topSpender[1] / expenses) * 100).toFixed(1);
                leakContent = `<div class="insight-leak-row">
                    <div class="insight-leak-label">${this.escapeHtml(topSpender[0])}</div>
                    <div class="insight-leak-pct">${leakPct}% of outflow</div>
                    <div class="insight-leak-amount">₹${topSpender[1].toFixed(0)}</div>
                </div>
                <p class="insight-muted" style="margin-top:10px;">Directive: Institute a 48-hour cooling-off period for this category.</p>`;
            } else {
                leakContent = `<p class="insight-muted">No dominant leaks detected.</p>`;
            }
            html += section('04', 'Target the Leak', leakContent);

            // 5. Macro Analytics
            let macroContent = '<div class="insight-macro-grid">';
            if (income > 0) {
                const rateOk = Number(savingsRate) >= 20;
                macroContent += `
                    <div class="insight-macro-tile">
                        <div class="insight-macro-val" style="color: ${rateOk ? 'var(--income)' : 'var(--expense)'};">${savingsRate}%</div>
                        <div class="insight-macro-label">Savings Rate</div>
                        <div class="insight-macro-note">${rateOk ? 'Above 20% benchmark' : 'Below 20% benchmark'}</div>
                    </div>`;
            }
            if (expenses > 0 && sortedCategories.length > 3) {
                macroContent += `
                    <div class="insight-macro-tile">
                        <div class="insight-macro-val">${paretoRatio}%</div>
                        <div class="insight-macro-label">Top 3 Concentration</div>
                        <div class="insight-macro-note">Focus cuts here for max impact</div>
                    </div>`;
            }
            macroContent += '</div>';
            html += section('05', 'Macro Analytics', macroContent);

            // 6. Weekend vs Weekday
            let weekendContent;
            if (expenseTxs.length < 5) {
                weekendContent = `<p class="insight-muted">Need more transactions to detect patterns.</p>`;
            } else {
                const higherDay = weekendAvg > weekdayAvg ? 'weekends' : 'weekdays';
                const ratio =
                    weekendAvg > 0 && weekdayAvg > 0
                        ? Math.max(weekendAvg, weekdayAvg) / Math.min(weekendAvg, weekdayAvg)
                        : 1;
                weekendContent = `
                    <div class="insight-day-grid">
                        <div class="insight-day-tile">
                            <div class="insight-day-val">₹${weekdayAvg.toFixed(0)}</div>
                            <div class="insight-day-label">avg/weekday</div>
                        </div>
                        <div class="insight-day-tile insight-day-tile--alt">
                            <div class="insight-day-val">₹${weekendAvg.toFixed(0)}</div>
                            <div class="insight-day-label">avg/weekend day</div>
                        </div>
                    </div>
                    <p class="insight-muted" style="margin-top:10px;">
                        You spend <b>${ratio.toFixed(1)}×</b> more on ${higherDay}.
                        ${weekendAvg > weekdayAvg * 1.5 ? 'Weekend spending is a significant driver — cap weekend activities.' : 'Spending is fairly even across the week.'}
                    </p>`;
            }
            html += section('06', 'Weekend vs Weekday', weekendContent);

            // 7. Month-over-Month
            let momContent = '';
            if (cycleExpenses.length < 2) {
                momContent = `<p class="insight-muted">Need at least 2 salary cycles to show a trend.</p>`;
            } else {
                const maxVal = Math.max(...cycleExpenses.map(c => c.total));
                const recent = cycleExpenses[cycleExpenses.length - 1].total;
                const prev = cycleExpenses[cycleExpenses.length - 2].total;
                const momChange = prev > 0 ? (((recent - prev) / prev) * 100).toFixed(1) : 0;
                const isUp = recent > prev;

                momContent = `
                    <div class="insight-badge ${isUp ? 'insight-badge--red' : 'insight-badge--green'}" style="margin-bottom:14px;">
                        ${isUp ? '📈' : '📉'} vs last cycle: <b>${isUp ? '+' : ''}${momChange}%</b>
                        (₹${recent.toFixed(0)} vs ₹${prev.toFixed(0)})
                    </div>
                    <div class="insight-bar-chart">`;
                cycleExpenses.forEach(c => {
                    const barHeight = maxVal > 0 ? Math.max(4, (c.total / maxVal) * 70) : 4;
                    const isCurrent = c.start === currentStart;
                    momContent += `
                        <div class="insight-bar-col">
                            <div class="insight-bar-val">₹${(c.total / 1000).toFixed(1)}k</div>
                            <div class="insight-bar-fill ${isCurrent ? 'insight-bar-fill--active' : ''}" style="height:${barHeight}px;"></div>
                            <div class="insight-bar-label">${c.label}</div>
                        </div>`;
                });
                momContent += `</div>`;
            }
            html += section('07', 'Month-over-Month', momContent);

            html += `</div>`;

            result.innerHTML = html;
            loading.style.display = 'none';
            result.style.display = 'block';
        }, 800);
    }

    // ===============================
    // CROSS-DOMAIN LIFE REPORT
    // ===============================
    generateLifeReport() {
        const loading = document.getElementById('life-report-loading');
        const result = document.getElementById('life-report-result');
        if (!loading || !result) return;

        loading.style.display = 'block';
        result.style.display = 'none';

        setTimeout(() => {
            const timeLogs = (window.timeTracker && window.timeTracker.getLogs()) || [];
            const workouts = (window.workoutTracker && window.workoutTracker.getWorkouts()) || [];
            const allTxs = this.transactions || [];

            if (timeLogs.length < 3) {
                result.innerHTML = `<p class="ai-empty">Log a few time entries first so I can correlate them with your spending.</p>`;
                loading.style.display = 'none';
                result.style.display = 'block';
                return;
            }

            const totalsForDate = dateStr => {
                const out = { Work: 0, Health: 0, Personal: 0, Leisure: 0, Sleep: 0 };
                timeLogs
                    .filter(l => l.date === dateStr)
                    .forEach(l => {
                        if (out[l.category] !== undefined) out[l.category] += Number(l.duration_seconds);
                    });
                return out;
            };

            const cycleStart = this.currentCycleStart;
            const cycleEnd = this.currentCycleEnd;
            const dayMap = {};
            if (cycleStart && cycleEnd) {
                const s = new Date(`${cycleStart}T00:00:00`);
                const e = new Date(`${cycleEnd}T00:00:00`);
                for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
                    const yyyy = d.getFullYear();
                    const mm = String(d.getMonth() + 1).padStart(2, '0');
                    const dd = String(d.getDate()).padStart(2, '0');
                    const key = `${yyyy}-${mm}-${dd}`;
                    dayMap[key] = totalsForDate(key);
                }
            }

            const overworkDays = Object.entries(dayMap)
                .filter(([, t]) => t.Work / 3600 > 10)
                .map(([date, t]) => ({ date, workHours: +(t.Work / 3600).toFixed(1) }))
                .sort((a, b) => b.workHours - a.workHours);

            const today = new Date();
            const last7 = [];
            for (let i = 6; i >= 0; i--) {
                const d = new Date(today);
                d.setDate(d.getDate() - i);
                const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                last7.push(key);
            }
            const sleepHoursByDay = last7.map(k => {
                const logged = timeLogs
                    .filter(l => l.date === k && l.category === 'Sleep')
                    .reduce((s, l) => s + Number(l.duration_seconds), 0);
                return +(logged / 3600).toFixed(2);
            });
            const sleepDaysWithData = sleepHoursByDay.filter(h => h > 0);
            const sleepAvg =
                sleepDaysWithData.length > 0
                    ? sleepDaysWithData.reduce((s, h) => s + h, 0) / sleepDaysWithData.length
                    : 0;

            const spendByDate = {};
            allTxs
                .filter(t => t.type === 'expense')
                .forEach(t => {
                    spendByDate[t.transaction_date] =
                        (spendByDate[t.transaction_date] || 0) + Number(t.amount);
                });

            let heavyWorkSpendTotal = 0,
                heavyWorkDays = 0;
            let normalSpendTotal = 0,
                normalDays = 0;
            Object.entries(dayMap).forEach(([date, t]) => {
                const workHours = t.Work / 3600;
                const spend = spendByDate[date] || 0;
                if (workHours > 9) {
                    heavyWorkSpendTotal += spend;
                    heavyWorkDays++;
                } else if (workHours > 0) {
                    normalSpendTotal += spend;
                    normalDays++;
                }
            });
            const heavyAvg = heavyWorkDays > 0 ? heavyWorkSpendTotal / heavyWorkDays : 0;
            const normalAvg = normalDays > 0 ? normalSpendTotal / normalDays : 0;
            const spendDelta = heavyAvg - normalAvg;
            const spendDeltaPct = normalAvg > 0 ? (spendDelta / normalAvg) * 100 : 0;

            let weeklyWorkSec = 0,
                weeklySpend = 0;
            last7.forEach(k => {
                weeklyWorkSec += totalsForDate(k).Work;
                weeklySpend += spendByDate[k] || 0;
            });
            const weeklyWorkouts = workouts.filter(w => last7.includes(w.date)).length;

            const weeks = [];
            for (let w = 3; w >= 0; w--) {
                const weekDays = [];
                for (let i = 6; i >= 0; i--) {
                    const d = new Date(today);
                    d.setDate(d.getDate() - (w * 7 + i));
                    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                    weekDays.push(key);
                }
                let work = 0,
                    health = 0,
                    sleep = 0;
                weekDays.forEach(k => {
                    const t = totalsForDate(k);
                    work += t.Work;
                    health += t.Health;
                    sleep += t.Sleep;
                });
                const awake = Math.max(1, 7 * 24 * 3600 - sleep);
                const score = Math.min(100, Math.round(((work + health) / awake) * 100));
                const startDate = weekDays[0];
                const label = new Date(`${startDate}T00:00:00`).toLocaleDateString('en-IN', {
                    day: 'numeric',
                    month: 'short'
                });
                weeks.push({ label, score });
            }

            const section = (num, title, content) => `
                <div class="insight-section">
                    <div class="insight-section-header">
                        <span class="insight-num">${num}</span>
                        <h4>${title}</h4>
                    </div>
                    <div class="insight-content">${content}</div>
                </div>`;

            let html = `<div class="insights-body">`;

            // 01 Overwork
            let overworkContent;
            if (overworkDays.length === 0) {
                overworkContent = `<div class="insight-badge insight-badge--green">✅ No overwork days (>10h) detected this cycle.</div>`;
            } else {
                overworkContent = `<p class="insight-muted" style="margin-bottom:10px;">${overworkDays.length} day(s) over 10h of work this cycle:</p>`;
                overworkDays.slice(0, 5).forEach(d => {
                    overworkContent += `
                        <div class="insight-anomaly-row">
                            <div class="insight-anomaly-header">
                                <strong>${d.date}</strong>
                                <span class="insight-pill insight-pill--red">${d.workHours}h</span>
                            </div>
                        </div>`;
                });
            }
            html += section('01', 'Overwork Detector', overworkContent);

            // 02 Sleep
            let sleepContent;
            if (sleepDaysWithData.length === 0) {
                sleepContent = `<p class="insight-muted">No sleep logged in the last 7 days.</p>`;
            } else {
                const sleepOk = sleepAvg >= 7;
                sleepContent = `
                    <div class="insight-macro-grid">
                        <div class="insight-macro-tile">
                            <div class="insight-macro-val" style="color: ${sleepOk ? 'var(--income)' : 'var(--expense)'};">${sleepAvg.toFixed(1)}h</div>
                            <div class="insight-macro-label">7-Day Avg</div>
                            <div class="insight-macro-note">${sleepOk ? 'Meeting 7h target' : 'Below 7h target'}</div>
                        </div>
                        <div class="insight-macro-tile">
                            <div class="insight-macro-val">${sleepDaysWithData.length}/7</div>
                            <div class="insight-macro-label">Days Tracked</div>
                            <div class="insight-macro-note">Out of last week</div>
                        </div>
                    </div>`;
            }
            html += section('02', 'Sleep Tracker', sleepContent);

            // 03 Money-Time Correlation
            let corrContent;
            if (heavyWorkDays === 0 || normalDays === 0) {
                corrContent = `<p class="insight-muted">Need more days in the cycle with both normal and heavy (>9h) work to compute correlation.</p>`;
            } else {
                const arrow = spendDelta > 0 ? '📈' : '📉';
                const badgeClass = spendDelta > 0 ? 'insight-badge--red' : 'insight-badge--green';
                corrContent = `
                    <div class="insight-day-grid">
                        <div class="insight-day-tile">
                            <div class="insight-day-val">₹${Math.round(normalAvg)}</div>
                            <div class="insight-day-label">avg normal day</div>
                        </div>
                        <div class="insight-day-tile insight-day-tile--alt">
                            <div class="insight-day-val">₹${Math.round(heavyAvg)}</div>
                            <div class="insight-day-label">avg heavy-work day</div>
                        </div>
                    </div>
                    <div class="insight-badge ${badgeClass}" style="margin-top:12px;">
                        ${arrow} On heavy-work days (>9h) you spend <b>${spendDelta > 0 ? '+' : ''}₹${Math.round(spendDelta)}</b> (${spendDeltaPct > 0 ? '+' : ''}${spendDeltaPct.toFixed(0)}%) vs normal days.
                    </div>`;
            }
            html += section('03', 'Money–Time Correlation', corrContent);

            // 04 Weekly Operating Report
            const weeklyReport = `
                <div class="insight-macro-grid">
                    <div class="insight-macro-tile">
                        <div class="insight-macro-val">${(weeklyWorkSec / 3600).toFixed(1)}h</div>
                        <div class="insight-macro-label">Work</div>
                    </div>
                    <div class="insight-macro-tile">
                        <div class="insight-macro-val">${weeklyWorkouts}</div>
                        <div class="insight-macro-label">Workouts</div>
                    </div>
                    <div class="insight-macro-tile">
                        <div class="insight-macro-val">${sleepAvg > 0 ? sleepAvg.toFixed(1) + 'h' : '—'}</div>
                        <div class="insight-macro-label">Sleep Avg</div>
                    </div>
                    <div class="insight-macro-tile">
                        <div class="insight-macro-val">₹${Math.round(weeklySpend)}</div>
                        <div class="insight-macro-label">Money Spent</div>
                    </div>
                </div>`;
            html += section('04', 'Weekly Operating Report', weeklyReport);

            // 05 Productivity Trend
            let trendContent;
            const hasTrendData = weeks.some(w => w.score > 0);
            if (!hasTrendData) {
                trendContent = `<p class="insight-muted">Log more time over the last 4 weeks to see your trend.</p>`;
            } else {
                const maxScore = Math.max(...weeks.map(w => w.score), 1);
                trendContent = `<div class="insight-bar-chart" style="height: 110px;">`;
                weeks.forEach((w, i) => {
                    const barHeight = Math.max(4, (w.score / maxScore) * 85);
                    const isCurrent = i === weeks.length - 1;
                    trendContent += `
                        <div class="insight-bar-col">
                            <div class="insight-bar-val">${w.score}%</div>
                            <div class="insight-bar-fill ${isCurrent ? 'insight-bar-fill--active' : ''}" style="height:${barHeight}px;"></div>
                            <div class="insight-bar-label">${w.label}</div>
                        </div>`;
                });
                trendContent += `</div>`;
            }
            html += section('05', 'Productivity Trend (4 weeks)', trendContent);

            html += `</div>`;

            result.innerHTML = html;
            loading.style.display = 'none';
            result.style.display = 'block';
        }, 600);
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

    document.getElementById('login-form')?.addEventListener('submit', handleLogin);
    document.getElementById('signup-form')?.addEventListener('submit', handleSignup);

    document.getElementById('login-tab-btn')?.addEventListener('click', e => {
        document.getElementById('login-form').style.display = 'block';
        document.getElementById('signup-form').style.display = 'none';
        e.target.classList.add('active');
        document.getElementById('signup-tab-btn').classList.remove('active');
        document.getElementById('auth-error').style.display = 'none';
        document.getElementById('auth-success').style.display = 'none';
    });

    document.getElementById('signup-tab-btn')?.addEventListener('click', e => {
        document.getElementById('login-form').style.display = 'none';
        document.getElementById('signup-form').style.display = 'block';
        e.target.classList.add('active');
        document.getElementById('login-tab-btn').classList.remove('active');
        document.getElementById('auth-error').style.display = 'none';
        document.getElementById('auth-success').style.display = 'none';
    });

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
