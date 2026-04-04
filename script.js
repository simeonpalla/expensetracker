// ======================================================
// EXPENSE TRACKER — FRONTEND CONTROLLER (BFF VERSION)
// ======================================================

// ===============================
// API LAYER (AUTH-AWARE & AUTO-REFRESH)
// ===============================
const API = {
    async request(path, options = {}, isRetry = false) {
        let session = null;
        try {
            const raw = localStorage.getItem('session');
            if (raw && raw !== "undefined") session = JSON.parse(raw);
        } catch {
            localStorage.removeItem('session');
        }

        const headers = {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        };

        if (session?.access_token) {
            headers['Authorization'] = `Bearer ${session.access_token}`;
        }

        let res = await fetch(`/.netlify/functions/${path}`, {
            ...options,
            headers
        });

        if (res.status === 401 && !isRetry && session?.refresh_token) {
            const refreshRes = await fetch('/.netlify/functions/refresh', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refresh_token: session.refresh_token })
            });

            if (refreshRes.ok) {
                const newSession = await refreshRes.json();
                localStorage.setItem('session', JSON.stringify(newSession));
                headers['Authorization'] = `Bearer ${newSession.access_token}`;
                res = await fetch(`/.netlify/functions/${path}`, { ...options, headers });
            } else {
                localStorage.removeItem('session');
                location.reload();
                return;
            }
        } else if (res.status === 401) {
            localStorage.removeItem('session');
            location.reload();
            return;
        }

        if (!res.ok) {
            const text = await res.text();
            throw new Error(text);
        }

        return res.status === 204 ? null : res.json();
    },

    login(email, password) { return this.request('login', { method: 'POST', body: JSON.stringify({ email, password }) }); },
    getCategories() { return this.request('categories'); },
    addCategory(data) { return this.request('categories', { method: 'POST', body: JSON.stringify(data) }); },
    getTransactions() { return this.request('transactions'); },
    addTransaction(tx) { return this.request('transactions', { method: 'POST', body: JSON.stringify(tx) }); },
    updateTransaction(id, tx) { return this.request(`transactions?id=${id}`, { method: 'PUT', body: JSON.stringify(tx) }); },
    deleteTransaction(id) { return this.request(`transactions?id=${id}`, { method: 'DELETE' }); }
};

// ===============================
// NOTIFICATION SYSTEM (replaces alert())
// ===============================
function showNotification(message, type = 'success') {
    const notification = document.getElementById('notification');
    const msgEl = document.getElementById('notification-message');
    if (!notification || !msgEl) { alert(message); return; }

    msgEl.textContent = message;
    notification.className = `notification ${type} show`;

    const closeBtn = document.getElementById('notification-close');
    const dismiss = () => {
        notification.classList.remove('show');
    };
    closeBtn.onclick = dismiss;
    setTimeout(dismiss, 4000);
}

// ===============================
// AUTH HANDLERS
// ===============================
function showAuthError(message) {
    const errorDiv = document.getElementById('auth-error');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
}

async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const errorDiv = document.getElementById('auth-error');
    errorDiv.style.display = 'none';

    try {
        const session = await API.login(email, password);
        if (!session || !session.user) throw new Error("Login failed. Please check your credentials.");
        localStorage.setItem('session', JSON.stringify(session));
        location.reload();
    } catch (err) {
        localStorage.removeItem('session');
        showAuthError(err.message || "An error occurred during login.");
    }
}

function handleLogout() {
    localStorage.removeItem('session');
    location.reload();
}

// ===============================
// MAIN APP CLASS
// ===============================
class ExpenseTracker {
    constructor(session) {
        this.currentUser = session.user;
        this.transactions = [];
        this.categories = [];
        this.chart = null;
        this.expenseDonutChart = null;
        this.currentChartView = 'source';

        // Load salary account from localStorage (persisted setting)
        this.salaryAccount = localStorage.getItem('salaryAccount') || 'UBI';
        this.currentCycleStart = null;
        this.currentCycleEnd = null;

        // Budget limits per category: { categoryName: limitAmount }
        this.budgetLimits = JSON.parse(localStorage.getItem('budgetLimits') || '{}');

        this.paymentSources = {
            upi: ['UBI', 'ICICI', 'SBI', 'Indian Bank'],
            'debit-card': ['UBI', 'ICICI', 'SBI', 'Indian Bank'],
            'credit-card': ['ICICI Amazon', 'ICICI Platinum', 'ICICI Coral', 'RBL', 'Union Bank'],
            cash: ['Cash']
        };

        // Edit modal state
        this.editingTransactionId = null;

        this.init();
    }

    async init() {
        this.setupEventListeners();
        this.setTodayDate();
        this.syncSalaryAccountUI();

        document.getElementById('status-dot').className = 'status-dot connecting';
        document.getElementById('status-text').textContent = 'Fetching data...';

        try {
            await this.loadCategories();
            this.transactions = await API.getTransactions() || [];

            document.getElementById('status-dot').className = 'status-dot connected';
            document.getElementById('status-text').textContent = 'Connected';

            this.loadCycleHistory();
            this.showPage('add-transaction');
        } catch (error) {
            console.error("Init Error:", error);
            document.getElementById('status-dot').className = 'status-dot error';
            document.getElementById('status-text').textContent = 'Connection failed';
        }
    }

    // ===============================
    // EVENT LISTENERS & NAVIGATION
    // ===============================
    setupEventListeners() {
        const qs = (id) => document.getElementById(id);

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

        // Salary account setting
        qs('salary-settings-form')?.addEventListener('submit', e => {
            e.preventDefault();
            const val = qs('salary-default-account')?.value;
            if (val) {
                this.salaryAccount = val;
                localStorage.setItem('salaryAccount', val);
                showNotification('Salary account updated to ' + val);
            }
        });

        // Budget limits form
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

        document.querySelectorAll('.nav-tab').forEach(tab => {
            tab.addEventListener('click', () => this.showPage(tab.dataset.page));
        });
    }

    showPage(pageId) {
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
        document.getElementById(pageId)?.classList.add('active');
        document.querySelector(`.nav-tab[data-page="${pageId}"]`)?.classList.add('active');

        // Render budget UI when switching to budget page
        if (pageId === 'budgets') this.renderBudgetLimitsUI();
    }

    setTodayDate() {
        const el = document.getElementById('date');
        if (el) el.value = new Date().toISOString().split('T')[0];
    }

    syncSalaryAccountUI() {
        const sel = document.getElementById('salary-default-account');
        if (sel) sel.value = this.salaryAccount;
    }

    resetForm() {
        document.getElementById('transaction-form')?.reset();
        this.setTodayDate();
        this.populateCategoryDropdowns();
        this.updateFormForSalary();
    }

    // ===============================
    // CATEGORY LOGIC
    // ===============================
    async loadCategories() {
        this.categories = await API.getCategories() || [];
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
            this.categories.filter(c => !type || c.type === type).forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.name;
                opt.textContent = `${c.icon} ${c.name}`;
                select.appendChild(opt);
            });
        }

        if (filter) {
            filter.innerHTML = '<option value="">All Categories</option>';
            this.categories.forEach(c => {
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
            div.innerHTML = `<span class="category-icon">${c.icon}</span><span class="category-name">${c.name}</span>`;
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
            container.innerHTML = '<p style="color: var(--text-muted, #6b7280); font-size: 0.9rem;">Add expense categories first.</p>';
            return;
        }

        container.innerHTML = expenseCategories.map(c => `
            <div class="budget-limit-row">
                <label>${c.icon} ${c.name}</label>
                <div class="budget-input-wrap">
                    <span class="rupee-symbol">₹</span>
                    <input type="number" min="0" step="1"
                           class="budget-limit-input"
                           data-category="${c.name}"
                           placeholder="No limit"
                           value="${this.budgetLimits[c.name] || ''}">
                </div>
            </div>
        `).join('');
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
        // Re-render dashboard if visible
        if (this.currentCycleStart) this.updateDashboardStats(this.currentCycleStart, this.currentCycleEnd);
    }

    checkBudgetWarnings(cycleTxs) {
        const container = document.getElementById('budget-warnings');
        if (!container) return;

        const spendByCategory = {};
        cycleTxs.filter(t => t.type === 'expense').forEach(t => {
            spendByCategory[t.category] = (spendByCategory[t.category] || 0) + Number(t.amount);
        });

        const warnings = [];
        Object.entries(this.budgetLimits).forEach(([cat, limit]) => {
            const spent = spendByCategory[cat] || 0;
            const pct = (spent / limit) * 100;
            if (pct >= 80) {
                const catObj = this.categories.find(c => c.name === cat);
                const icon = catObj ? catObj.icon : '📁';
                warnings.push({ cat, icon, spent, limit, pct: Math.min(pct, 100).toFixed(0), over: pct > 100 });
            }
        });

        if (warnings.length === 0) {
            container.innerHTML = '';
            return;
        }

        container.innerHTML = `
            <div class="budget-warnings-block">
                ${warnings.map(w => `
                    <div class="budget-warning-item ${w.over ? 'over-budget' : 'near-budget'}">
                        <div class="budget-warning-header">
                            <span>${w.icon} ${w.cat}</span>
                            <span class="budget-badge">${w.over ? '🚨 Over budget' : '⚠️ ' + w.pct + '%'}</span>
                        </div>
                        <div class="budget-bar-track">
                            <div class="budget-bar-fill" style="width: ${Math.min(parseFloat(w.pct), 100)}%; background: ${w.over ? '#ef4444' : '#f59e0b'};"></div>
                        </div>
                        <div class="budget-bar-labels">
                            <span>₹${w.spent.toFixed(0)} spent</span>
                            <span>₹${w.limit} limit</span>
                        </div>
                    </div>
                `).join('')}
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

        const isSalary = typeSelect?.value === 'income' && (categorySelect?.value || '').trim().toLowerCase().includes('salary');

        if (isSalary) {
            if (paymentSourceSelect) {
                paymentSourceSelect.innerHTML = '<option value="salary" selected>Salary Deposit</option>';
                paymentSourceSelect.disabled = true;
            }
            if (sourceDetailsSelect) {
                sourceDetailsSelect.innerHTML = `<option value="${this.salaryAccount}" selected>${this.salaryAccount}</option>`;
                sourceDetailsSelect.disabled = true;
                sourceDetailsSelect.parentElement.style.display = 'block';
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

        if (this.paymentSources[source]) {
            details.parentElement.style.display = 'block';
            details.required = true;
            this.paymentSources[source].forEach(s => {
                const opt = document.createElement('option');
                opt.value = s;
                opt.textContent = s;
                details.appendChild(opt);
            });
        } else {
            details.parentElement.style.display = 'none';
            details.required = false;
        }
    }

    // ===============================
    // TRANSACTIONS & DASHBOARD
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

        try {
            await API.addTransaction(tx);
            this.resetForm();
            this.transactions = await API.getTransactions() || [];
            this.loadCycleHistory();
            showNotification('Transaction saved!');
        } catch (error) {
            showNotification('Error saving transaction: ' + error.message, 'error');
        }
    }

    // ===============================
    // EDIT / DELETE TRANSACTIONS
    // ===============================
    openEditModal(tx) {
        this.editingTransactionId = tx.id;
        const qs = id => document.getElementById(id);

        qs('edit-type').value = tx.type;
        qs('edit-amount').value = tx.amount;
        qs('edit-date').value = tx.transaction_date;
        qs('edit-payment-to').value = tx.payment_to || '';
        qs('edit-description').value = tx.description || '';

        // Populate category dropdown for this type
        const catSel = qs('edit-category');
        catSel.innerHTML = '';
        this.categories.filter(c => c.type === tx.type).forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.name;
            opt.textContent = `${c.icon} ${c.name}`;
            if (c.name === tx.category) opt.selected = true;
            catSel.appendChild(opt);
        });

        qs('edit-modal-overlay').style.display = 'flex';
    }

    closeEditModal() {
        document.getElementById('edit-modal-overlay').style.display = 'none';
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
            description: document.getElementById('edit-description').value || null,
        };

        try {
            await API.updateTransaction(this.editingTransactionId, updated);
            this.closeEditModal();
            this.transactions = await API.getTransactions() || [];
            this.loadCycleHistory();
            showNotification('Transaction updated!');
        } catch (error) {
            showNotification('Error updating: ' + error.message, 'error');
        }
    }

    async deleteTransaction(id) {
        if (!confirm('Delete this transaction? This cannot be undone.')) return;
        try {
            await API.deleteTransaction(id);
            this.transactions = await API.getTransactions() || [];
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
        if (!cycleTxs.length) { showNotification('No transactions to export.', 'error'); return; }

        const headers = ['Date', 'Type', 'Category', 'Amount', 'Payment To', 'Payment Source', 'Bank/Card', 'Description', 'Recurring'];
        const rows = cycleTxs.map(t => [
            t.transaction_date,
            t.type,
            t.category,
            t.amount,
            t.payment_to || '',
            t.payment_source || '',
            t.source_details || '',
            (t.description || '').replace(/,/g, ';'),
            t.is_recurring ? 'Yes' : 'No'
        ]);

        const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const s = this.currentCycleStart;
        const end = this.currentCycleEnd;
        a.download = `expenses_${s}_to_${end}.csv`;
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

        const salaries = this.transactions.filter(t => t.type === 'income' && t.category.toLowerCase().includes('salary'));

        if (salaries.length === 0) {
            selector.innerHTML = '<option value="">Current Month</option>';
            const d = new Date();
            const end = d.toISOString().split('T')[0];
            d.setDate(1);
            const start = d.toISOString().split('T')[0];
            this.loadSpecificCycle(start, end);
            return;
        }

        selector.innerHTML = '';
        salaries.forEach((salary, index) => {
            const startDate = salary.transaction_date;
            let endDate, label;

            if (index === 0) {
                endDate = new Date().toISOString().split('T')[0];
                const niceDate = new Date(startDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
                label = `Current: Since ${niceDate}`;
            } else {
                const nextSalaryDate = new Date(salaries[index - 1].transaction_date);
                nextSalaryDate.setDate(nextSalaryDate.getDate() - 1);
                endDate = nextSalaryDate.toISOString().split('T')[0];
                const s = new Date(startDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
                const e = new Date(endDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
                label = `${s} - ${e}`;
            }

            const option = document.createElement('option');
            option.value = `${startDate}|${endDate}`;
            option.textContent = label;
            selector.appendChild(option);
        });

        if (selector.options.length > 0) {
            selector.selectedIndex = 0;
            this.handleCycleChange();
        }
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
        const s = new Date(startDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
        const e = new Date(endDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
        if (chartTitle) chartTitle.innerHTML = `<span aria-hidden="true">📈</span> Trends: ${s} to ${e}`;

        this.updateDashboardStats(startDate, endDate);
        this.displayTransactions();
        this.renderLineChart(startDate, endDate);
        this.renderChartBySource(startDate, endDate);
        this.suggestRecurringTransactions(startDate);
    }

    getTransactionsInCycle(startDate, endDate) {
        return this.transactions.filter(t =>
            t.transaction_date >= startDate && t.transaction_date <= endDate
        );
    }

    // ===============================
    // RECURRING TRANSACTION SUGGESTIONS
    // ===============================
    suggestRecurringTransactions(currentCycleStart) {
        const container = document.getElementById('recurring-suggestions');
        if (!container) return;

        // Find transactions marked as recurring from any previous cycle
        const recurringTxs = this.transactions.filter(t =>
            t.is_recurring && t.transaction_date < currentCycleStart
        );

        if (recurringTxs.length === 0) { container.innerHTML = ''; return; }

        // Group by category+payment_to to find unique recurring patterns
        const seen = {};
        recurringTxs.forEach(t => {
            const key = `${t.category}||${t.payment_to}||${t.payment_source}`;
            if (!seen[key] || t.transaction_date > seen[key].transaction_date) {
                seen[key] = t;
            }
        });

        // Check which ones haven't been logged in the current cycle yet
        const currentTxs = this.getTransactionsInCycle(currentCycleStart, this.currentCycleEnd);
        const suggestions = Object.values(seen).filter(t => {
            return !currentTxs.some(ct =>
                ct.category === t.category && ct.payment_to === t.payment_to
            );
        });

        if (suggestions.length === 0) { container.innerHTML = ''; return; }

        container.innerHTML = `
            <div class="recurring-suggestions-block">
                <h4>🔁 Recurring transactions due this cycle</h4>
                ${suggestions.map(t => {
                    const cat = this.categories.find(c => c.name === t.category);
                    const icon = cat ? cat.icon : '📁';
                    return `
                        <div class="recurring-suggestion-item">
                            <div class="recurring-info">
                                <span class="recurring-icon">${icon}</span>
                                <div>
                                    <strong>${t.payment_to}</strong>
                                    <small>${t.category} • ₹${Number(t.amount).toFixed(0)} • ${t.payment_source}</small>
                                </div>
                            </div>
                            <button class="btn btn-secondary btn-sm" onclick="app.prefillFromRecurring(${JSON.stringify(t).replace(/"/g, '&quot;')})">
                                + Log it
                            </button>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
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

            // Trigger payment source population
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

    // ===============================
    // DISPLAY TRANSACTIONS (with edit/delete + swipe)
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

        list.innerHTML = filtered.map(t => {
            const cat = this.categories.find(c => c.name === t.category);
            const icon = cat ? cat.icon : '📁';
            const txJson = JSON.stringify(t).replace(/"/g, '&quot;');
            return `
            <div class="transaction-item" data-id="${t.id}">
                <div class="transaction-swipe-wrapper">
                    <div class="transaction-content">
                        <div class="transaction-details">
                            <strong>${icon} ${t.category}</strong>
                            ${t.is_recurring ? '<span class="recurring-badge">🔁</span>' : ''}
                            <br>
                            <small>${t.transaction_date} • ${t.payment_to || 'N/A'}</small>
                        </div>
                        <div class="transaction-right">
                            <div class="${t.type}">
                                ${t.type === 'income' ? '+' : '-'}₹${Number(t.amount).toFixed(2)}
                            </div>
                            <div class="transaction-actions">
                                <button class="tx-action-btn edit-btn" onclick="app.openEditModal(JSON.parse(this.closest('[data-id]').dataset.tx))" title="Edit">✏️</button>
                                <button class="tx-action-btn delete-btn" onclick="app.deleteTransaction('${t.id}')" title="Delete">🗑️</button>
                            </div>
                        </div>
                    </div>
                    <div class="swipe-delete-bg" onclick="app.deleteTransaction('${t.id}')">
                        🗑️ Delete
                    </div>
                </div>
            </div>
        `;
        }).join('');

        // Store tx data on elements for edit
        filtered.forEach(t => {
            const el = list.querySelector(`[data-id="${t.id}"]`);
            if (el) el.dataset.tx = JSON.stringify(t);
        });

        this.setupSwipeToDelete(list);
    }

    setupSwipeToDelete(list) {
        list.querySelectorAll('.transaction-item').forEach(item => {
            const wrapper = item.querySelector('.transaction-swipe-wrapper');
            const content = item.querySelector('.transaction-content');
            let startX = 0, currentX = 0, isDragging = false;

            const onStart = (x) => { startX = x; isDragging = true; };
            const onMove = (x) => {
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
        let income = 0, expenses = 0;

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

        const streak = this.calculateNoSpendStreak(cycleTxs, startDate, endDate);
        document.getElementById('current-streak').textContent = `${streak.currentStreak} Days`;
        document.getElementById('best-streak').textContent = `Best: ${streak.bestStreak} days`;
    }

    calculateNoSpendStreak(cycleTxs, startDate, endDate) {
        const days = {};
        const start = new Date(startDate);
        const end = new Date();

        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            days[d.toISOString().split('T')[0]] = true;
        }

        cycleTxs.forEach(t => {
            if (t.type === 'expense') days[t.transaction_date] = false;
        });

        let currentStreak = 0, bestStreak = 0;
        const todayStr = new Date().toISOString().split('T')[0];

        let tempDate = new Date();
        while (true) {
            const dateStr = tempDate.toISOString().split('T')[0];
            if (new Date(dateStr) < start) break;
            if (days[dateStr]) currentStreak++;
            else if (dateStr !== todayStr) break;
            else if (dateStr === todayStr && !days[dateStr]) { currentStreak = 0; break; }
            tempDate.setDate(tempDate.getDate() - 1);
        }

        let tempStreak = 0;
        Object.keys(days).sort().forEach(date => {
            if (days[date]) tempStreak++;
            else { bestStreak = Math.max(bestStreak, tempStreak); tempStreak = 0; }
        });
        bestStreak = Math.max(bestStreak, tempStreak);

        return { currentStreak, bestStreak };
    }

    calculateRunRate(cycleTxs, startDate, income) {
        const msPerDay = 1000 * 60 * 60 * 24;
        const start = new Date(startDate);
        const today = new Date();
        const daysPassed = Math.max(1, Math.ceil((today - start) / msPerDay));

        let expensesSoFar = 0;
        cycleTxs.forEach(t => {
            if (t.type === 'expense') expensesSoFar += Number(t.amount);
        });

        const historicalTxs = this.transactions.filter(t =>
            t.type === 'expense' && t.transaction_date < startDate
        );

        let projectedFutureSpend = 0;

        if (historicalTxs.length >= 10) {
            const salaries = this.transactions
                .filter(t => t.type === 'income' && t.category.toLowerCase().includes('salary'))
                .sort((a, b) => a.transaction_date.localeCompare(b.transaction_date));

            const dayOfCycleSpend = {};
            historicalTxs.forEach(t => {
                let cycleStart = null;
                for (let i = salaries.length - 1; i >= 0; i--) {
                    if (salaries[i].transaction_date <= t.transaction_date) { cycleStart = salaries[i].transaction_date; break; }
                }
                if (!cycleStart) return;
                const dayNum = Math.ceil((new Date(t.transaction_date) - new Date(cycleStart)) / msPerDay) + 1;
                if (!dayOfCycleSpend[dayNum]) dayOfCycleSpend[dayNum] = [];
                dayOfCycleSpend[dayNum].push(Number(t.amount));
            });

            for (let d = daysPassed + 1; d <= 30; d++) {
                if (dayOfCycleSpend[d]?.length > 0) {
                    projectedFutureSpend += dayOfCycleSpend[d].reduce((s, v) => s + v, 0) / dayOfCycleSpend[d].length;
                }
            }
        } else {
            const recentCutoff = new Date(today);
            recentCutoff.setDate(recentCutoff.getDate() - 7);
            let recentSpend = 0, earlierSpend = 0, recentDays = 0, earlierDays = 0;

            cycleTxs.forEach(t => {
                if (t.type !== 'expense') return;
                const amt = Number(t.amount);
                if (new Date(t.transaction_date) >= recentCutoff) {
                    recentSpend += amt; recentDays = Math.min(7, daysPassed);
                } else {
                    earlierSpend += amt; earlierDays = Math.max(1, daysPassed - 7);
                }
            });

            const recentRate = recentDays > 0 ? recentSpend / recentDays : 0;
            const earlierRate = earlierDays > 0 ? earlierSpend / earlierDays : recentRate;
            projectedFutureSpend = ((recentRate * 0.6) + (earlierRate * 0.4)) * Math.max(0, 30 - daysPassed);
        }

        const projectedBalance = income - (expensesSoFar + projectedFutureSpend);
        const dailyBurnRate = expensesSoFar / daysPassed;
        const daysRemaining = Math.max(0, 30 - daysPassed);

        const runRateEl = document.getElementById('run-rate');
        const riskCard = document.getElementById('risk-card');
        if (!runRateEl || income === 0) return;

        if (projectedBalance < 0) {
            runRateEl.innerHTML = `<span style="color: #ef4444;">Warning: Short by ₹${Math.abs(projectedBalance).toFixed(0)}</span>`;
            if (riskCard) riskCard.style.borderLeft = "4px solid #ef4444";
        } else if (projectedBalance < income * 0.1) {
            runRateEl.innerHTML = `<span style="color: #f59e0b;">Caution: ₹${projectedBalance.toFixed(0)} leftover (thin margin)</span>`;
            if (riskCard) riskCard.style.borderLeft = "4px solid #f59e0b";
        } else {
            runRateEl.innerHTML = `<span style="color: #10b981;">Safe: +₹${projectedBalance.toFixed(0)} projected surplus</span>`;
            if (riskCard) riskCard.style.borderLeft = "4px solid #10b981";
        }
    }

    // ===============================
    // CHART RENDERING
    // ===============================
    renderLineChart(startDate, endDate) {
        const cycleTxs = this.getTransactionsInCycle(startDate, endDate);
        const labels = [], expenses = [], dailyData = {};

        const start = new Date(startDate + 'T00:00:00');
        const end = new Date(Math.min(new Date(endDate + 'T00:00:00'), new Date()));

        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const dateStr = d.toISOString().split('T')[0];
            labels.push(d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }));
            dailyData[dateStr] = 0;
        }

        cycleTxs.forEach(t => {
            if (t.type === 'expense' && dailyData[t.transaction_date] !== undefined) {
                dailyData[t.transaction_date] += Number(t.amount);
            }
        });

        Object.keys(dailyData).forEach(dateStr => expenses.push(dailyData[dateStr]));

        // Linear regression trend line
        const n = expenses.length;
        const xMean = (n - 1) / 2;
        const yMean = expenses.reduce((a, b) => a + b, 0) / n;
        let num = 0, den = 0;
        expenses.forEach((y, x) => { num += (x - xMean) * (y - yMean); den += (x - xMean) ** 2; });
        const slope = den !== 0 ? num / den : 0;
        const intercept = yMean - slope * xMean;
        const trendData = expenses.map((_, x) => parseFloat((slope * x + intercept).toFixed(2)));

        if (this.chart) this.chart.destroy();
        const canvas = document.getElementById('chart');
        if (!canvas) return;

        this.chart = new Chart(canvas.getContext('2d'), {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Daily Expenses',
                        data: expenses,
                        borderColor: '#ef4444',
                        backgroundColor: 'rgba(239, 68, 68, 0.1)',
                        fill: true,
                        tension: 0.4,
                        pointRadius: 3,
                    },
                    {
                        label: 'Trend',
                        data: trendData,
                        borderColor: '#f59e0b',
                        borderWidth: 2,
                        borderDash: [6, 4],
                        pointRadius: 0,
                        fill: false,
                        tension: 0,
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

        const cycleTxs = this.getTransactionsInCycle(this.currentCycleStart, this.currentCycleEnd)
            .filter(t => t.type === 'expense' && (t.payment_source || 'Unknown') === source);

        const categoryData = cycleTxs.reduce((acc, t) => {
            acc[t.category || 'Uncategorized'] = (acc[t.category || 'Uncategorized'] || 0) + Number(t.amount);
            return acc;
        }, {});

        this.renderDonutChart(Object.keys(categoryData), Object.values(categoryData), `Expenses via ${source}`);
    }

    renderDonutChart(labels, data, title) {
        if (this.expenseDonutChart) this.expenseDonutChart.destroy();
        const canvas = document.getElementById('expense-donut-chart');
        if (!canvas) return;
        document.getElementById('donut-chart-title').textContent = title;

        this.expenseDonutChart = new Chart(canvas.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels,
                datasets: [{
                    data,
                    backgroundColor: ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#3b82f6', '#8b5cf6'],
                    borderWidth: 2
                }]
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
    // LOCAL AI COACH (5-POINT MASTER AUDIT + WEEKEND/WEEKDAY + MOM TREND)
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
                result.innerHTML = `<p style="text-align: center; color: #6b7280;">Log a few more transactions in this cycle before I can run a full audit.</p>`;
                loading.style.display = 'none';
                result.style.display = 'block';
                return;
            }

            // --- DATA AGGREGATION ---
            let income = 0, expenses = 0;
            const currentSpend = {};

            currentTxs.forEach(t => {
                const amount = Number(t.amount);
                if (t.type === 'income') income += amount;
                if (t.type === 'expense') {
                    expenses += amount;
                    currentSpend[t.category] = (currentSpend[t.category] || 0) + amount;
                }
            });

            let historicalMonths = 1;
            const historicalSpend = {};
            if (historicalTxs.length > 0) {
                let earliestTime = new Date().getTime();
                historicalTxs.forEach(t => {
                    const tTime = new Date(t.transaction_date).getTime();
                    if (tTime < earliestTime) earliestTime = tTime;
                    if (t.type === 'expense') {
                        historicalSpend[t.category] = (historicalSpend[t.category] || 0) + Number(t.amount);
                    }
                });
                const msPerMonth = 1000 * 60 * 60 * 24 * 30.44;
                historicalMonths = Math.max(1, (new Date(currentStart).getTime() - earliestTime) / msPerMonth);
            }

            // --- 1 & 2. ANOMALIES ---
            const anomalies = [];
            if (historicalTxs.length > 0) {
                Object.keys(currentSpend).forEach(cat => {
                    const currentAmt = currentSpend[cat];
                    const histAvg = (historicalSpend[cat] || 0) / historicalMonths;
                    if (currentAmt > histAvg && histAvg > 0) {
                        const diff = currentAmt - histAvg;
                        const pct = (diff / histAvg) * 100;
                        if (pct >= 10 && diff >= 500) anomalies.push({ cat, currentAmt, histAvg, diff, pct });
                    }
                });
                anomalies.sort((a, b) => b.diff - a.diff);
            }

            // --- 3. RUN-RATE (pattern-aware) ---
            const msPerDay = 1000 * 60 * 60 * 24;
            const start = new Date(currentStart);
            const today = new Date();
            const daysPassed = Math.max(1, Math.ceil((today - start) / msPerDay));
            const dailyBurnRate = expenses / daysPassed;
            const daysRemaining = Math.max(0, 30 - daysPassed);

            const historicalExpTxs = this.transactions.filter(t =>
                t.type === 'expense' && t.transaction_date < currentStart
            );

            let projectedFutureSpend = 0;
            if (historicalExpTxs.length >= 10) {
                const salaries = this.transactions
                    .filter(t => t.type === 'income' && t.category.toLowerCase().includes('salary'))
                    .sort((a, b) => a.transaction_date.localeCompare(b.transaction_date));

                const dayOfCycleSpend = {};
                historicalExpTxs.forEach(t => {
                    let cycleStart = null;
                    for (let i = salaries.length - 1; i >= 0; i--) {
                        if (salaries[i].transaction_date <= t.transaction_date) { cycleStart = salaries[i].transaction_date; break; }
                    }
                    if (!cycleStart) return;
                    const dayNum = Math.ceil((new Date(t.transaction_date) - new Date(cycleStart)) / msPerDay) + 1;
                    if (!dayOfCycleSpend[dayNum]) dayOfCycleSpend[dayNum] = [];
                    dayOfCycleSpend[dayNum].push(Number(t.amount));
                });

                for (let d = daysPassed + 1; d <= 30; d++) {
                    if (dayOfCycleSpend[d]?.length > 0) {
                        projectedFutureSpend += dayOfCycleSpend[d].reduce((s, v) => s + v, 0) / dayOfCycleSpend[d].length;
                    }
                }
            } else {
                const recentCutoff = new Date(today);
                recentCutoff.setDate(recentCutoff.getDate() - 7);
                let recentSpend = 0, earlierSpend = 0, recentDays = 0, earlierDays = 0;
                currentTxs.forEach(t => {
                    if (t.type !== 'expense') return;
                    const amt = Number(t.amount);
                    if (new Date(t.transaction_date) >= recentCutoff) { recentSpend += amt; recentDays = Math.min(7, daysPassed); }
                    else { earlierSpend += amt; earlierDays = Math.max(1, daysPassed - 7); }
                });
                const recentRate = recentDays > 0 ? recentSpend / recentDays : 0;
                const earlierRate = earlierDays > 0 ? earlierSpend / earlierDays : recentRate;
                projectedFutureSpend = ((recentRate * 0.6) + (earlierRate * 0.4)) * daysRemaining;
            }

            const projectedBalance = income - (expenses + projectedFutureSpend);

            // --- 4. TARGET THE LEAK ---
            const sortedCategories = Object.entries(currentSpend).sort((a, b) => b[1] - a[1]);
            const topSpender = sortedCategories.length > 0 ? sortedCategories[0] : null;

            // --- 5. MACRO ANALYTICS ---
            let top3Spend = 0;
            sortedCategories.slice(0, 3).forEach(c => top3Spend += c[1]);
            const paretoRatio = expenses > 0 ? ((top3Spend / expenses) * 100).toFixed(0) : 0;
            const savingsRate = income > 0 ? (((income - expenses) / income) * 100).toFixed(0) : 0;

            // --- 6. WEEKEND vs WEEKDAY ---
            let weekendSpend = 0, weekdaySpend = 0, weekendDays = 0, weekdayDays = 0;
            const expenseTxs = allTxs.filter(t => t.type === 'expense');
            expenseTxs.forEach(t => {
                const dow = new Date(t.transaction_date + 'T12:00:00').getDay(); // 0=Sun,6=Sat
                const amt = Number(t.amount);
                if (dow === 0 || dow === 6) weekendSpend += amt;
                else weekdaySpend += amt;
            });
            // Count unique weekend/weekday dates
            const uniqueDates = [...new Set(expenseTxs.map(t => t.transaction_date))];
            uniqueDates.forEach(d => {
                const dow = new Date(d + 'T12:00:00').getDay();
                if (dow === 0 || dow === 6) weekendDays++;
                else weekdayDays++;
            });
            const weekendAvg = weekendDays > 0 ? weekendSpend / weekendDays : 0;
            const weekdayAvg = weekdayDays > 0 ? weekdaySpend / weekdayDays : 0;

            // --- 7. MONTH-OVER-MONTH TREND ---
            const salaries = this.transactions
                .filter(t => t.type === 'income' && t.category.toLowerCase().includes('salary'))
                .sort((a, b) => a.transaction_date.localeCompare(b.transaction_date));

            const cycleExpenses = [];
            salaries.forEach((salary, index) => {
                const cStart = salary.transaction_date;
                let cEnd;
                if (index < salaries.length - 1) {
                    const next = new Date(salaries[index + 1].transaction_date);
                    next.setDate(next.getDate() - 1);
                    cEnd = next.toISOString().split('T')[0];
                } else {
                    cEnd = new Date().toISOString().split('T')[0];
                }
                const cycleTx = this.getTransactionsInCycle(cStart, cEnd);
                const total = cycleTx.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
                const label = new Date(cStart).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
                cycleExpenses.push({ label, total, start: cStart });
            });

            // ==========================================
            // HTML GENERATION
            // ==========================================
            let html = `<div style="text-align: left;">`;

            // SECTION 1
            html += `<h4 style="color: #4b5563; border-bottom: 1px solid #e5e7eb; padding-bottom: 8px; margin-bottom: 12px; margin-top: 10px;">1. Informative (The Audit)</h4>`;
            if (historicalTxs.length === 0) {
                html += `<p style="font-size: 0.9rem; color: #6b7280;">Baseline comparison requires at least one prior cycle. Keep logging data.</p>`;
            } else if (anomalies.length === 0) {
                html += `<div style="background: #d1fae5; color: #065f46; padding: 12px; border-radius: 6px; border-left: 4px solid #10b981;">✅ No significant overspending detected against your ${historicalMonths.toFixed(1)}-month baseline.</div>`;
            } else {
                html += `<p style="font-size: 0.9rem; color: #6b7280; margin-bottom: 10px;">Variances against your ${historicalMonths.toFixed(1)}-month historical average:</p><ul style="list-style: none; padding: 0; margin: 0;">`;
                anomalies.forEach(a => {
                    html += `<li style="background: #fef2f2; border: 1px solid #fee2e2; padding: 10px; border-radius: 6px; margin-bottom: 8px;">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                            <strong style="color: #991b1b; font-size: 0.95rem;">${a.cat.toUpperCase()}</strong>
                            <span style="background: #ef4444; color: white; padding: 2px 6px; border-radius: 12px; font-size: 0.75rem; font-weight: bold;">+${a.pct.toFixed(0)}%</span>
                        </div>
                        <div style="font-size: 0.85rem; color: #7f1d1d;">Current: <b>₹${a.currentAmt.toFixed(0)}</b> | Avg: <b>₹${a.histAvg.toFixed(0)}</b> <span style="color: #ef4444;">(+₹${a.diff.toFixed(0)})</span></div>
                    </li>`;
                });
                html += `</ul>`;
            }

            // SECTION 2
            html += `<h4 style="color: #4b5563; border-bottom: 1px solid #e5e7eb; padding-bottom: 8px; margin-bottom: 12px; margin-top: 25px;">2. Corrective Measures</h4>`;
            if (anomalies.length === 0) {
                html += `<p style="font-size: 0.9rem; color: #6b7280;">No immediate corrections required. Maintain current trajectory.</p>`;
            } else {
                html += `<div style="background: #f8fafc; border-left: 4px solid #3b82f6; padding: 12px; border-radius: 6px; color: #1e293b; font-size: 0.9rem;">`;
                anomalies.slice(0, 2).forEach((a, index) => {
                    html += `<div style="${index !== 0 ? 'margin-top: 10px;' : ''}">
                        <strong style="color: #1d4ed8;">Action ${index + 1}: Re-peg ${a.cat}</strong><br>
                        Mandated limit for next cycle: <b>₹${(a.histAvg * 0.95).toFixed(0)}</b> (5% below baseline) to offset the ₹${a.diff.toFixed(0)} variance.
                    </div>`;
                });
                html += `</div>`;
            }

            // SECTION 3
            html += `<h4 style="color: #4b5563; border-bottom: 1px solid #e5e7eb; padding-bottom: 8px; margin-bottom: 12px; margin-top: 25px;">3. Run-Rate Status</h4>`;
            if (projectedBalance < 0) {
                html += `<div style="background: #fee2e2; color: #991b1b; padding: 12px; border-radius: 6px; border-left: 4px solid #ef4444; font-size: 0.9rem;">
                    <strong style="display: block; margin-bottom: 4px;">🚨 RED ALERT: DEFICIT PROJECTED</strong>
                    Burning <b>₹${dailyBurnRate.toFixed(0)}/day</b>. Projected to finish the cycle <strong>short by ₹${Math.abs(projectedBalance).toFixed(0)}</strong>. Freeze non-essential spending.
                </div>`;
            } else if (projectedBalance < income * 0.1) {
                html += `<div style="background: #fef3c7; color: #92400e; padding: 12px; border-radius: 6px; border-left: 4px solid #f59e0b; font-size: 0.9rem;">
                    <strong style="display: block; margin-bottom: 4px;">⚠️ CAUTION: LOW MARGINS</strong>
                    Burning <b>₹${dailyBurnRate.toFixed(0)}/day</b>. Only ₹${projectedBalance.toFixed(0)} leftover. Reduce to <b>₹${((income * 0.9 - expenses) / (daysRemaining || 1)).toFixed(0)}/day</b>.
                </div>`;
            } else {
                html += `<div style="background: #d1fae5; color: #065f46; padding: 12px; border-radius: 6px; border-left: 4px solid #10b981; font-size: 0.9rem;">
                    <strong style="display: block; margin-bottom: 4px;">✅ GREEN LIGHT: SURPLUS PROJECTED</strong>
                    Controlled burn of <b>₹${dailyBurnRate.toFixed(0)}/day</b>. Tracking toward a surplus of <b>₹${projectedBalance.toFixed(0)}</b>.
                </div>`;
            }

            // SECTION 4
            html += `<h4 style="color: #4b5563; border-bottom: 1px solid #e5e7eb; padding-bottom: 8px; margin-bottom: 12px; margin-top: 25px;">4. Target The Leak</h4>`;
            if (topSpender && expenses > 0) {
                const leakPercentage = ((topSpender[1] / expenses) * 100).toFixed(1);
                html += `<div style="background: #f3f4f6; color: #1f2937; padding: 12px; border-radius: 6px; border-left: 4px solid #4f46e5; font-size: 0.9rem;">
                    <strong>${topSpender[0].toUpperCase()}</strong> is consuming <strong>${leakPercentage}%</strong> of total outflow (₹${topSpender[1].toFixed(0)}).<br><br>
                    <strong>Directive:</strong> Institute a strict 48-hour cooling-off period for this category.
                </div>`;
            } else {
                html += `<p style="font-size: 0.9rem; color: #6b7280;">No dominant leaks detected.</p>`;
            }

            // SECTION 5
            html += `<h4 style="color: #4b5563; border-bottom: 1px solid #e5e7eb; padding-bottom: 8px; margin-bottom: 12px; margin-top: 25px;">5. Macro-Level Analytics</h4>`;
            html += `<div style="font-size: 0.9rem; color: #374151; line-height: 1.5;"><ul style="margin-left: 20px; margin-bottom: 10px;">`;
            if (income > 0) {
                const rateColor = savingsRate < 20 ? '#ef4444' : '#10b981';
                const rateTip = savingsRate < 20
                    ? 'Standard benchmark is 20%. Focus on cutting recurring fixed costs.'
                    : 'Excellent. Ensure surplus is deployed into compounding assets.';
                html += `<li style="margin-bottom: 8px;"><b>Savings Rate: <span style="color:${rateColor}">${savingsRate}%</span></b>. ${rateTip}</li>`;
            }
            if (expenses > 0 && sortedCategories.length > 3) {
                html += `<li style="margin-bottom: 8px;"><b>Concentration Risk:</b> Top 3 categories account for <b>${paretoRatio}%</b> of spend. Focus cuts here for maximum impact.</li>`;
            }
            html += `</ul></div>`;

            // SECTION 6: WEEKEND vs WEEKDAY
            html += `<h4 style="color: #4b5563; border-bottom: 1px solid #e5e7eb; padding-bottom: 8px; margin-bottom: 12px; margin-top: 25px;">6. Weekend vs Weekday Pattern</h4>`;
            if (expenseTxs.length < 5) {
                html += `<p style="font-size: 0.9rem; color: #6b7280;">Need more transactions to detect weekend/weekday patterns.</p>`;
            } else {
                const higherDay = weekendAvg > weekdayAvg ? 'weekends' : 'weekdays';
                const ratio = weekendAvg > 0 && weekdayAvg > 0 ? Math.max(weekendAvg, weekdayAvg) / Math.min(weekendAvg, weekdayAvg) : 1;
                const weekendPct = weekendDays > 0 ? ((weekendSpend / (weekendDays * 2)) / ((weekendSpend / (weekendDays * 2)) + (weekdaySpend / (weekdayDays * 5))) * 100).toFixed(0) : 0;

                html += `<div style="background: #f8fafc; border-left: 4px solid #8b5cf6; padding: 12px; border-radius: 6px; font-size: 0.9rem; color: #1e293b;">
                    <div style="display: flex; gap: 20px; margin-bottom: 10px;">
                        <div style="flex:1; text-align:center; background:#fff; padding:10px; border-radius:6px; border: 1px solid #e5e7eb;">
                            <div style="font-size:1.3rem; font-weight:600; color:#4f46e5;">₹${weekdayAvg.toFixed(0)}</div>
                            <div style="color:#6b7280; font-size:0.8rem;">avg/weekday</div>
                        </div>
                        <div style="flex:1; text-align:center; background:#fff; padding:10px; border-radius:6px; border: 1px solid #e5e7eb;">
                            <div style="font-size:1.3rem; font-weight:600; color:#f59e0b;">₹${weekendAvg.toFixed(0)}</div>
                            <div style="color:#6b7280; font-size:0.8rem;">avg/weekend day</div>
                        </div>
                    </div>
                    You spend <b>${ratio.toFixed(1)}×</b> more on ${higherDay}. 
                    ${weekendAvg > weekdayAvg * 1.5
                        ? 'Weekend spending is a significant driver of your outflows. Plan weekend activities with a budget cap.'
                        : 'Spending is fairly even across the week — no major weekend splurge pattern detected.'}
                </div>`;
            }

            // SECTION 7: MONTH-OVER-MONTH
            html += `<h4 style="color: #4b5563; border-bottom: 1px solid #e5e7eb; padding-bottom: 8px; margin-bottom: 12px; margin-top: 25px;">7. Month-over-Month Expense Trend</h4>`;
            if (cycleExpenses.length < 2) {
                html += `<p style="font-size: 0.9rem; color: #6b7280;">Need at least 2 salary cycles to show a trend.</p>`;
            } else {
                const maxVal = Math.max(...cycleExpenses.map(c => c.total));
                const recent = cycleExpenses[cycleExpenses.length - 1].total;
                const prev = cycleExpenses[cycleExpenses.length - 2].total;
                const momChange = prev > 0 ? (((recent - prev) / prev) * 100).toFixed(1) : 0;
                const momColor = recent > prev ? '#ef4444' : '#10b981';
                const momIcon = recent > prev ? '📈' : '📉';

                html += `<div style="background: #f8fafc; padding: 12px; border-radius: 6px; border-left: 4px solid #10b981; margin-bottom: 12px; font-size: 0.9rem;">
                    ${momIcon} vs last cycle: <b style="color:${momColor}">${recent > prev ? '+' : ''}${momChange}%</b> 
                    (₹${recent.toFixed(0)} vs ₹${prev.toFixed(0)})
                </div>`;

                html += `<div style="display: flex; align-items: flex-end; gap: 6px; height: 80px; padding: 0 4px;">`;
                cycleExpenses.forEach(c => {
                    const barHeight = maxVal > 0 ? Math.max(4, (c.total / maxVal) * 70) : 4;
                    const isCurrent = c.start === currentStart;
                    html += `
                        <div style="flex:1; display:flex; flex-direction:column; align-items:center; gap:4px;">
                            <div style="font-size:9px; color:#6b7280;">₹${(c.total/1000).toFixed(1)}k</div>
                            <div style="width:100%; height:${barHeight}px; background:${isCurrent ? '#4f46e5' : '#c7d2fe'}; border-radius:3px 3px 0 0;"></div>
                            <div style="font-size:9px; color:#6b7280; text-align:center; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:36px;">${c.label}</div>
                        </div>`;
                });
                html += `</div>`;
            }

            html += `</div>`;

            result.innerHTML = html;
            loading.style.display = 'none';
            result.style.display = 'block';
        }, 800);
    }
}

// ===============================
// INIT APP
// ===============================
document.addEventListener('DOMContentLoaded', () => {
    const authContainer = document.getElementById('auth-container');
    const appContainer = document.querySelector('.container');

    document.getElementById('login-form')?.addEventListener('submit', handleLogin);

    document.getElementById('login-tab-btn')?.addEventListener('click', (e) => {
        document.getElementById('login-form').style.display = 'block';
        document.getElementById('signup-form').style.display = 'none';
        e.target.classList.add('active');
        document.getElementById('signup-tab-btn').classList.remove('active');
    });

    document.getElementById('signup-tab-btn')?.addEventListener('click', (e) => {
        document.getElementById('login-form').style.display = 'none';
        document.getElementById('signup-form').style.display = 'block';
        e.target.classList.add('active');
        document.getElementById('login-tab-btn').classList.remove('active');
        document.getElementById('auth-error').style.display = 'block';
        document.getElementById('auth-error').textContent = "Signup via frontend is disabled in BFF mode. Create users in Supabase dashboard.";
    });

    let session = null;
    try {
        const raw = localStorage.getItem('session');
        if (raw && raw !== "undefined") session = JSON.parse(raw);
    } catch {
        localStorage.removeItem('session');
    }

    if (!session) {
        authContainer.style.display = 'flex';
        appContainer.style.display = 'none';
        return;
    }

    authContainer.style.display = 'none';
    appContainer.style.display = 'block';
    window.app = new ExpenseTracker(session);
});