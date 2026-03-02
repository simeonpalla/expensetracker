// ======================================================
// EXPENSE TRACKER — FRONTEND CONTROLLER (BFF VERSION)
// ======================================================

// ===============================
// API LAYER (AUTH-AWARE)
// ===============================
const API = {
    async request(path, options = {}) {
        let session = null;
        try {
            const raw = localStorage.getItem('session');
            if (raw && raw !== "undefined") {
                session = JSON.parse(raw);
            }
        } catch {
            localStorage.removeItem('session');
        }

        const headers = {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        };

        // Attach JWT if available
        if (session?.access_token) {
            headers['Authorization'] = `Bearer ${session.access_token}`;
        }

        const res = await fetch(`/.netlify/functions/${path}`, {
            ...options,
            headers
        });

        // Handle expired session cleanly
        if (res.status === 401) {
            console.warn('Session expired');
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

    login(email, password) {
        return this.request('login', {
            method: 'POST',
            body: JSON.stringify({ email, password })
        });
    },

    getCategories() { return this.request('categories'); },

    addCategory(data) {
        return this.request('categories', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },

    getTransactions() { return this.request('transactions'); },

    addTransaction(tx) {
        return this.request('transactions', {
            method: 'POST',
            body: JSON.stringify(tx)
        });
    }
};

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
        if (!session || !session.user) {
            throw new Error("Login failed. Please check your credentials.");
        }
        // store only VALID session
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
        this.transactions = []; // All raw transactions from API
        this.categories = [];
        this.chart = null;
        this.expenseDonutChart = null;
        this.currentChartView = 'source';
        
        // Default settings
        this.salaryAccount = 'UBI';
        this.currentCycleStart = null;
        this.currentCycleEnd = null;

        this.paymentSources = {
            upi: ['UBI', 'ICICI', 'SBI', 'Indian Bank'],
            'debit-card': ['UBI', 'ICICI', 'SBI', 'Indian Bank'],
            'credit-card': ['ICICI Amazon', 'ICICI Platinum', 'ICICI Coral', 'RBL', 'Union Bank'],
            cash: ['Cash']
        };

        this.init();
    }

    async init() {
        // ✅ 1. Setup listeners first so UI is immediately responsive
        this.setupEventListeners();
        this.setTodayDate();
        
        // Show loading states
        document.getElementById('status-dot').className = 'status-dot connecting';
        document.getElementById('status-text').textContent = 'Fetching data...';

        try {
            // ✅ 2. Fetch all data
            await this.loadCategories();
            this.transactions = await API.getTransactions() || [];
            
            document.getElementById('status-dot').className = 'status-dot connected';
            document.getElementById('status-text').textContent = 'Connected';

            // ✅ 3. Process local data for dashboard
            this.loadCycleHistory();
            // this.showPage('dashboard');
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
            this.populateCategoryDropdowns(); // Rebuild list when Income/Expense changes
            this.updateFormForSalary();       // Then run salary logic
        });
        qs('category')?.addEventListener('change', () => {
            this.updateFormForSalary();       // Only run salary logic, DO NOT rebuild list
        });
        qs('payment-source')?.addEventListener('change', () => this.updateSourceDetailsOptions());
        qs('filter-type')?.addEventListener('change', () => this.displayTransactions());
        qs('filter-category')?.addEventListener('change', () => this.displayTransactions());
        qs('cycle-history')?.addEventListener('change', () => this.handleCycleChange());
        qs('clear-form-btn')?.addEventListener('click', () => this.resetForm());
        qs('logout-btn')?.addEventListener('click', handleLogout);
        qs('generate-local-ai-btn')?.addEventListener('click', () => this.generateLocalAIInsights());
        qs('reset-chart-view-btn')?.addEventListener('click', () => this.renderChartBySource());

        document.querySelectorAll('.nav-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                this.showPage(tab.dataset.page);
            });
        });
    }

    showPage(pageId) {
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
        document.getElementById(pageId)?.classList.add('active');
        document.querySelector(`.nav-tab[data-page="${pageId}"]`)?.classList.add('active');
    }

    setTodayDate() {
        const el = document.getElementById('date');
        if (el) el.value = new Date().toISOString().split('T')[0];
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
            alert("Category added successfully!");
        } catch (error) {
            alert("Error adding category: " + error.message);
        }
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

        const tx = {
            type: document.getElementById('type').value,
            amount: parseFloat(document.getElementById('amount').value),
            category: document.getElementById('category').value,
            transaction_date: document.getElementById('date').value,
            description: document.getElementById('description').value || null,
            payment_to: document.getElementById('payment-to').value,
            payment_source: document.getElementById('payment-source').value || 'salary',
            source_details: document.getElementById('source-details').value || this.salaryAccount
        };

        try {
            await API.addTransaction(tx);
            this.resetForm();
            
            // Re-fetch all to ensure integrity, then refresh dashboard
            this.transactions = await API.getTransactions() || [];
            this.loadCycleHistory(); 
            // this.showPage('dashboard');
            alert("Transaction added successfully!");
        } catch (error) {
            alert("Error adding transaction: " + error.message);
        }
    }

    loadCycleHistory() {
        const selector = document.getElementById('cycle-history');
        if (!selector) return;

        // Find salary dates natively from fetched transactions
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
            let endDate;
            let label;

            if (index === 0) {
                endDate = new Date().toISOString().split('T')[0];
                const niceDate = new Date(startDate).toLocaleDateString('en-IN', {day: 'numeric', month: 'short'});
                label = `Current: Since ${niceDate}`;
            } else {
                const nextSalaryDate = new Date(salaries[index - 1].transaction_date);
                nextSalaryDate.setDate(nextSalaryDate.getDate() - 1);
                endDate = nextSalaryDate.toISOString().split('T')[0];

                const s = new Date(startDate).toLocaleDateString('en-IN', {day: 'numeric', month: 'short'});
                const e = new Date(endDate).toLocaleDateString('en-IN', {day: 'numeric', month: 'short'});
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
        const s = new Date(startDate).toLocaleDateString('en-IN', {day: 'numeric', month: 'short'});
        const e = new Date(endDate).toLocaleDateString('en-IN', {day: 'numeric', month: 'short'});
        if (chartTitle) chartTitle.innerHTML = `<span aria-hidden="true">📈</span> Trends: ${s} to ${e}`;

        this.updateDashboardStats(startDate, endDate);
        this.displayTransactions(); 
        this.renderLineChart(startDate, endDate);
        this.renderChartBySource(startDate, endDate);
    }

    // Local filter function replacing backend calls
    getTransactionsInCycle(startDate, endDate) {
        return this.transactions.filter(t => 
            t.transaction_date >= startDate && t.transaction_date <= endDate
        );
    }

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
            return `
            <div class="transaction-item">
                <div class="transaction-details" style="text-align: left;">
                    <strong>${icon} ${t.category}</strong><br>
                    <small>${t.transaction_date} • ${t.payment_to || 'N/A'}</small>
                </div>
                <div class="${t.type}">
                    ${t.type === 'income' ? '+' : '-'}₹${Number(t.amount).toFixed(2)}
                </div>
            </div>
        `}).join('');
    }

    updateDashboardStats(startDate, endDate) {
        const cycleTxs = this.getTransactionsInCycle(startDate, endDate);
        let income = 0;
        let expenses = 0;

        cycleTxs.forEach(t => {
            if (t.type === 'income') income += Number(t.amount);
            if (t.type === 'expense') expenses += Number(t.amount);
        });

        this.calculateRunRate(cycleTxs, startDate, income);

        const balance = income - expenses;

        document.getElementById('total-income').textContent = `₹${income.toFixed(2)}`;
        document.getElementById('total-expenses').textContent = `₹${expenses.toFixed(2)}`;
        document.getElementById('net-balance').textContent = `₹${balance.toFixed(2)}`;
        
        // Local Streak Calculation
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
            else if (dateStr === todayStr && !days[dateStr]) {
                currentStreak = 0; break;
            }
            tempDate.setDate(tempDate.getDate() - 1);
        }
        
        let tempStreak = 0;
        Object.keys(days).sort().forEach(date => {
            if (days[date]) tempStreak++;
            else {
                bestStreak = Math.max(bestStreak, tempStreak);
                tempStreak = 0;
            }
        });
        bestStreak = Math.max(bestStreak, tempStreak);

        return { currentStreak, bestStreak };
    }

    calculateRunRate(cycleTxs, startDate, income) {
        const start = new Date(startDate);
        const today = new Date();
        
        // Calculate days passed in this cycle (minimum 1 to avoid dividing by zero)
        const diffTime = Math.abs(today - start);
        const daysPassed = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) || 1;
        
        // Assume a standard 30-day cycle for projection
        const cycleLength = 30; 
        const daysRemaining = Math.max(0, cycleLength - daysPassed);

        let expensesSoFar = 0;
        cycleTxs.forEach(t => {
            if (t.type === 'expense') expensesSoFar += Number(t.amount);
        });

        const dailyBurnRate = expensesSoFar / daysPassed;
        const projectedTotalExpense = expensesSoFar + (dailyBurnRate * daysRemaining);
        const projectedBalance = income - projectedTotalExpense;

        const runRateEl = document.getElementById('run-rate');
        const riskCard = document.getElementById('risk-card');
        
        if (!runRateEl || income === 0) return;

        if (projectedBalance < 0) {
            runRateEl.innerHTML = `<span style="color: #ef4444;">Warning: Short by ₹${Math.abs(projectedBalance).toFixed(0)}</span>`;
            riskCard.style.borderLeft = "4px solid #ef4444";
        } else {
            runRateEl.innerHTML = `<span style="color: #10b981;">Safe: +₹${projectedBalance.toFixed(0)} leftover</span>`;
            riskCard.style.borderLeft = "4px solid #10b981";
        }
    }

    // ===============================
    // CHART RENDERING (LOCAL)
    // ===============================
    renderLineChart(startDate, endDate) {
        const cycleTxs = this.getTransactionsInCycle(startDate, endDate);
        const labels = [];
        const expenses = [];
        const dailyData = {};

        const start = new Date(startDate + 'T00:00:00');
        const end = new Date(Math.min(new Date(endDate + 'T00:00:00'), new Date())); // up to today or cycle end

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

        if (this.chart) this.chart.destroy();
        const canvas = document.getElementById('chart');
        if (!canvas) return;

        this.chart = new Chart(canvas.getContext('2d'), {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'Expenses',
                    data: expenses,
                    borderColor: '#ef4444',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
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
            const cat = t.category || 'Uncategorized';
            acc[cat] = (acc[cat] || 0) + Number(t.amount);
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
    // LOCAL AI COACH (DIRECTIVE MODE)
    // ===============================
    generateLocalAIInsights() {
        const loading = document.getElementById('local-ai-loading');
        const result = document.getElementById('local-ai-result');
        if (!loading || !result) return;

        loading.style.display = 'block';
        result.style.display = 'none';
        
        setTimeout(() => { // Simulate processing time for UX
            const cycleTxs = this.getTransactionsInCycle(this.currentCycleStart, this.currentCycleEnd);

            if (!cycleTxs || cycleTxs.length < 3) {
                result.innerHTML = `<p style="text-align: center; color: #6b7280;">Log a few more transactions in this cycle before I can issue a valid directive.</p>`;
                loading.style.display = 'none';
                result.style.display = 'block';
                return;
            }

            let income = 0;
            let expenses = 0;
            const byCategory = {};
            
            cycleTxs.forEach(t => {
                const amount = Number(t.amount);
                if (t.type === 'income') income += amount;
                if (t.type === 'expense') {
                    expenses += amount;
                    byCategory[t.category] = (byCategory[t.category] || 0) + amount;
                }
            });

            // Isolate the biggest leak
            const topCats = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
            const topSpender = topCats.length > 0 ? topCats[0] : null;

            // Calculate current velocity and projections
            const start = new Date(this.currentCycleStart);
            const today = new Date();
            const diffTime = Math.abs(today - start);
            const daysPassed = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
            const daysRemaining = Math.max(0, 30 - daysPassed); // Assuming ~30 day cycle
            
            const dailyBurnRate = expenses / daysPassed;
            const projectedBalance = income - (expenses + (dailyBurnRate * daysRemaining));

            let html = `<h3 style="margin-bottom: 20px;">🧠 Actionable Directives</h3>`;

            // DIRECTIVE 1: RUN-RATE STATUS
            if (projectedBalance < 0) {
                html += `
                    <div style="background: #fee2e2; color: #991b1b; padding: 15px; border-radius: 8px; margin-bottom: 15px; border-left: 4px solid #ef4444; text-align: left;">
                        <strong style="display: block; margin-bottom: 5px;">🚨 RED ALERT: SPENDING FREEZE REQUIRED</strong>
                        You are burning <b>₹${dailyBurnRate.toFixed(0)}/day</b>. At this velocity, you will end the cycle <strong>short by ₹${Math.abs(projectedBalance).toFixed(0)}</strong>. Stop all non-essential purchases immediately until your next deposit.
                    </div>`;
            } else if (projectedBalance < (income * 0.1)) {
                html += `
                    <div style="background: #fef3c7; color: #92400e; padding: 15px; border-radius: 8px; margin-bottom: 15px; border-left: 4px solid #f59e0b; text-align: left;">
                        <strong style="display: block; margin-bottom: 5px;">⚠️ CAUTION: MARGINS ARE TOO THIN</strong>
                        You are on track to save less than 10% of your income this cycle. You must pull your daily spend below <b>₹${((income * 0.9 - expenses) / (daysRemaining || 1)).toFixed(0)}/day</b> for the remainder of the month to build a proper safety net.
                    </div>`;
            } else {
                html += `
                    <div style="background: #d1fae5; color: #065f46; padding: 15px; border-radius: 8px; margin-bottom: 15px; border-left: 4px solid #10b981; text-align: left;">
                        <strong style="display: block; margin-bottom: 5px;">✅ GREEN LIGHT: SYSTEM OPTIMAL</strong>
                        Your burn rate is highly controlled. You are tracking toward a surplus of <b>₹${projectedBalance.toFixed(0)}</b>. Sweep this excess into investments the moment your cycle closes.
                    </div>`;
            }

            // DIRECTIVE 2: TARGET THE LEAK
            if (topSpender && expenses > 0) {
                const leakPercentage = ((topSpender[1] / expenses) * 100).toFixed(1);
                html += `
                    <div style="background: #f3f4f6; color: #1f2937; padding: 15px; border-radius: 8px; border-left: 4px solid #4f46e5; text-align: left;">
                        <strong style="display: block; margin-bottom: 5px;">🎯 TACTICAL CUT: ${topSpender[0].toUpperCase()}</strong>
                        <strong>${leakPercentage}%</strong> of your total outflow is bleeding into ${topSpender[0]} (₹${topSpender[1].toFixed(0)}). <br><br>
                        <strong>Directive:</strong> Institute a strict 48-hour cooling-off period. Do not log another transaction in this category for the next two days to break the spending momentum.
                    </div>`;
            }

            result.innerHTML = html;
            loading.style.display = 'none';
            result.style.display = 'block';
        }, 600);
    }
}

// ===============================
// INIT APP
// ===============================
document.addEventListener('DOMContentLoaded', () => {
    const authContainer = document.getElementById('auth-container');
    const appContainer = document.querySelector('.container');

    // 1. ATTACH AUTH LISTENERS
    document.getElementById('login-form')?.addEventListener('submit', handleLogin);
    
    // Auth Tab Toggles
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

    // 2. CHECK SESSION
    let session = null;
    try {
        const raw = localStorage.getItem('session');
        if (raw && raw !== "undefined") {
            session = JSON.parse(raw);
        }
    } catch {
        localStorage.removeItem('session');
    }

    // 3. ROUTE USER
    if (!session) {
        authContainer.style.display = 'flex';
        appContainer.style.display = 'none';
        return;
    }

    authContainer.style.display = 'none';
    appContainer.style.display = 'block';

    window.app = new ExpenseTracker(session);
});