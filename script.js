// script.js - Clean, Month-Centric Expense Tracker (Updated)

// --- Authentication Functions ---
function showAuthTab(tab) {
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('signup-form').style.display = 'none';
    document.getElementById('reset-form').style.display = 'none';

    document.querySelectorAll('.auth-tab').forEach(t => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
    });

    if (tab === 'login') {
        document.getElementById('login-form').style.display = 'block';
        document.getElementById('login-tab-btn').classList.add('active');
        document.getElementById('login-tab-btn').setAttribute('aria-selected', 'true');
    } else if (tab === 'signup') {
        document.getElementById('signup-form').style.display = 'block';
        document.getElementById('signup-tab-btn').classList.add('active');
        document.getElementById('signup-tab-btn').setAttribute('aria-selected', 'true');
    } else if (tab === 'reset') {
        document.getElementById('reset-form').style.display = 'block';
    }

    hideAuthMessage();
}

function showAuthError(message) {
    const errorDiv = document.getElementById('auth-error');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
    document.getElementById('auth-success').style.display = 'none';
}

function showAuthSuccess(message) {
    const successDiv = document.getElementById('auth-success');
    successDiv.textContent = message;
    successDiv.style.display = 'block';
    document.getElementById('auth-error').style.display = 'none';
}

function hideAuthMessage() {
    document.getElementById('auth-error').style.display = 'none';
    document.getElementById('auth-success').style.display = 'none';
}

async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    try {
        const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw error;
    } catch (error) {
        showAuthError(error.message);
    }
}

async function handleSignup(e) {
    e.preventDefault();
    const email = document.getElementById('signup-email').value;
    const password = document.getElementById('signup-password').value;
    const confirmPassword = document.getElementById('signup-confirm').value;

    if (password !== confirmPassword) {
        showAuthError('Passwords do not match');
        return;
    }

    try {
        const { error } = await supabaseClient.auth.signUp({ email, password });
        if (error) throw error;
        showAuthSuccess('Check your email for verification link!');
    } catch (error) {
        showAuthError(error.message);
    }
}

async function handleReset(e) {
    e.preventDefault();
    const email = document.getElementById('reset-email').value;

    try {
        const { error } = await supabaseClient.auth.resetPasswordForEmail(email);
        if (error) throw error;
        showAuthSuccess('Password reset email sent!');
    } catch (error) {
        showAuthError(error.message);
    }
}

async function handleLogout() {
    try {
        const { error } = await supabaseClient.auth.signOut();
        if (error) throw error;
    } catch (error) {
        console.error('Logout error:', error);
    }
}

// --- Main Application Class ---
class ExpenseTracker {
    constructor() {
        this.transactions = [];
        this.categories = [];
        this.chart = null;
        this.expenseDonutChart = null;
        this.allExpenses = [];
        this.currentChartView = 'source';
        this.loadOffset = 0;
        this.loadLimit = 10;

        // Default salary account (can be overridden by user_settings)
        this.salaryAccount = 'UBI';

        // Month string like "2025-11"
        this.selectedMonth = this.getCurrentMonthString();

        this.paymentSources = {
            'upi': ['UBI', 'ICICI', 'SBI', 'Indian Bank'],
            'debit-card': ['UBI', 'ICICI', 'SBI', 'Indian Bank'],
            'credit-card': ['ICICI Platinum', 'ICICI Amazon Pay', 'ICICI Coral', 'RBL Paisabazar', 'UBI CC']
        };

        this.currentUser = null;

        // Initialize
        this.init();
    }

    async init() {
        try {
            const { data: { user } } = await supabaseClient.auth.getUser();
            if (!user) {
                console.log('No user found, awaiting auth.');
                return;
            }
            this.currentUser = user;

            await this.testConnection();
            this.initMonthSelector();
            this.setupEventListeners();

            // Load persisted user setting for salary account (if table/UI exists)
            await this.loadSalaryAccountSetting();

            // Load categories once
            await this.loadCategories();

            // Do not load dashboard until user opens Dashboard tab
            this.setTodayDate();

            console.log('✅ Expense Tracker initialized successfully!');
        } catch (error) {
            console.error('❌ Failed to initialize Expense Tracker:', error);
            this.showNotification('Failed to initialize application', 'error');
        }
    }

    async testConnection() {
        const statusDot = document.getElementById('status-dot');
        const statusText = document.getElementById('status-text');

        try {
            const { error } = await supabaseClient
                .from('categories')
                .select('*', { count: 'exact', head: true });

            if (error) throw error;

            statusDot.className = 'status-dot connected';
            statusText.textContent = 'Connected to database';
        } catch (error) {
            console.error('Database connection error:', error);
            statusDot.className = 'status-dot error';
            statusText.textContent = 'Database connection failed';
            throw error;
        }
    }

    initMonthSelector() {
        const monthSelector = document.getElementById('month-selector');
        monthSelector.value = this.selectedMonth;
        monthSelector.addEventListener('change', async (e) => {
            this.selectedMonth = e.target.value;
            console.log(`Month changed to: ${this.selectedMonth}`);
            await this.updateDashboardForSelectedMonth();
        });
    }

    async updateDashboardForSelectedMonth() {
        console.log(`Updating dashboard for ${this.selectedMonth}`);
        const { startDate, endDate } = this.getDateRangeForMonth(this.selectedMonth);

        // Reset transaction list for new month
        this.transactions = [];
        this.loadOffset = 0;
        const listEl = document.getElementById('transactions-list');
        if (listEl) {
            listEl.innerHTML = '<div class="loading">Loading transactions...</div>';
        }

        try {
            // Get the salary from the LAST WORKING DAY of the previous month
            const prevMonthSalary = await this.getPreviousMonthSalary();

            await Promise.all([
                this.loadTransactions(startDate, endDate),             // initial page
                this.updateStats(startDate, endDate, prevMonthSalary), // cards
                this.updateChart(startDate, endDate, prevMonthSalary), // line chart
                this.updateExpenseDonutChart(startDate, endDate)       // donut
            ]);
        } catch (error) {
            console.error('Error updating dashboard:', error);
            this.showNotification('Failed to update dashboard', 'error');
        }
    }

    async loadCategories() {
        try {
            const { data, error } = await supabaseClient
                .from('categories')
                .select('*')
                .eq('user_id', this.currentUser.id)
                .order('name');

            if (error) throw error;

            this.categories = data || [];
            this.populateCategoryDropdowns();
            this.displayCategories();
        } catch (error) {
            console.error('Error loading categories:', error);
            this.showNotification('Failed to load categories', 'error');
        }
    }

    async loadTransactions(startDate, endDate, loadMore = false) {
        if (!loadMore) {
            this.loadOffset = 0;
            this.transactions = [];
        }

        try {
            let query = supabaseClient
                .from('transactions')
                .select('*')
                .eq('user_id', this.currentUser.id)
                .gte('transaction_date', startDate)
                .lte('transaction_date', endDate)
                .order('transaction_date', { ascending: false })
                .order('created_at', { ascending: false })
                .range(this.loadOffset, this.loadOffset + this.loadLimit - 1);

            const filterType = document.getElementById('filter-type').value;
            const filterCategory = document.getElementById('filter-category').value;
            if (filterType) query = query.eq('type', filterType);
            if (filterCategory) query = query.eq('category', filterCategory);

            const { data, error } = await query;
            if (error) throw error;

            if (data && data.length > 0) {
                this.transactions.push(...data);
                this.loadOffset += data.length;
            }

            this.displayTransactions();
            await this.updateLoadMoreButton(startDate, endDate);
        } catch (error) {
            console.error('Error loading transactions:', error);
            this.showNotification('Failed to load transactions', 'error');
        }
    }

    async loadMoreTransactions() {
        const { startDate, endDate } = this.getDateRangeForMonth(this.selectedMonth);
        await this.loadTransactions(startDate, endDate, true);
    }

    async updateLoadMoreButton(startDate, endDate) {
        const container = document.getElementById('load-more-container');
        if (!container) return;
        try {
            let query = supabaseClient
                .from('transactions')
                .select('*', { count: 'exact', head: true })
                .eq('user_id', this.currentUser.id)
                .gte('transaction_date', startDate)
                .lte('transaction_date', endDate);

            const filterType = document.getElementById('filter-type').value;
            const filterCategory = document.getElementById('filter-category').value;
            if (filterType) query = query.eq('type', filterType);
            if (filterCategory) query = query.eq('category', filterCategory);

            const { count, error } = await query;
            if (error) throw error;

            container.style.display = (this.transactions.length < count) ? 'block' : 'none';
        } catch (error) {
            console.error('Error checking transaction count:', error);
            container.style.display = 'none';
        }
    }

    setupEventListeners() {
        // Forms
        document.getElementById('transaction-form').addEventListener('submit', (e) => this.handleTransactionSubmit(e));
        document.getElementById('category-form').addEventListener('submit', (e) => this.handleCategorySubmit(e));

        // Field changes
        document.getElementById('type').addEventListener('change', () => {
            this.updateCategoryOptions();
            this.updateFormForSalary();
        });
        document.getElementById('category').addEventListener('change', () => this.updateFormForSalary());
        document.getElementById('payment-source').addEventListener('change', () => this.updateSourceDetailsOptions());

        // Filters
        document.getElementById('filter-type').addEventListener('change', () => this.filterTransactions());
        document.getElementById('filter-category').addEventListener('change', () => this.filterTransactions());

        // Buttons
        document.getElementById('load-more-btn').addEventListener('click', () => this.loadMoreTransactions());
        document.getElementById('notification-close').addEventListener('click', () => this.hideNotification());
        document.getElementById('reset-chart-view-btn').addEventListener('click', () => this.renderChartBySource());
        document.getElementById('clear-form-btn').addEventListener('click', () => this.resetForm());
        document.getElementById('logout-btn').addEventListener('click', handleLogout);

        // Page Navigation
        document.querySelectorAll('.nav-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                const pageId = e.currentTarget.dataset.page;
                this.showPage(pageId, e);
            });
        });

        // Optional Settings form (exists only if you added it in HTML)
        const salarySettingsForm = document.getElementById('salary-settings-form');
        if (salarySettingsForm) {
            salarySettingsForm.addEventListener('submit', (e) => this.saveSalaryAccountSetting(e));
        }
    }

    async handleTransactionSubmit(e) {
        e.preventDefault();

        if (!this.currentUser) {
            this.showNotification('You must be logged in', 'error');
            return;
        }

        const transaction = {
            type: document.getElementById('type').value,
            amount: parseFloat(document.getElementById('amount').value),
            category: document.getElementById('category').value.trim(),
            transaction_date: document.getElementById('date').value,
            description: document.getElementById('description').value || null,
            payment_to: document.getElementById('payment-to').value,
            payment_source: document.getElementById('payment-source').value,
            source_details: document.getElementById('source-details').value || null,
            user_id: this.currentUser.id
        };

        if (!this.validateTransaction(transaction)) return;

        try {
            const { error } = await supabaseClient.from('transactions').insert([transaction]);
            if (error) throw error;

            this.showNotification('Transaction added successfully!', 'success');

            const transactionMonth = transaction.transaction_date.slice(0, 7);
            const affectsCurrentMonth = (transactionMonth === this.selectedMonth);

            const { startDate: prevStart, endDate: prevEnd } = this.getPreviousMonthPayPeriod();

            const isSalary = transaction.type === 'income' &&
                             transaction.category.trim().toLowerCase() === 'salary';

            const isPreviousMonthSalary = (
                isSalary &&
                transaction.transaction_date >= prevStart &&
                transaction.transaction_date <= prevEnd
            );

            if (affectsCurrentMonth || isPreviousMonthSalary) {
                await this.updateDashboardForSelectedMonth();
            } else {
                console.log('Transaction added for a different month.');
            }

            this.resetForm();
        } catch (error) {
            console.error('Error adding transaction:', error);
            this.showNotification(`Failed to add transaction: ${error.message}`, 'error');
        }
    }

    async handleCategorySubmit(e) {
        e.preventDefault();

        if (!this.currentUser) {
            this.showNotification('You must be logged in', 'error');
            return;
        }

        const category = {
            name: document.getElementById('category-name').value.trim(),
            type: document.getElementById('category-type').value,
            icon: document.getElementById('category-icon').value.trim() || '📁',
            user_id: this.currentUser.id
        };

        if (!category.name || !category.type) {
            this.showNotification('Name and type are required', 'error');
            return;
        }

        try {
            const { error } = await supabaseClient.from('categories').insert([category]);
            if (error) {
                if (error.code === '23505') throw new Error('Category already exists!');
                throw error;
            }

            this.showNotification('Category added successfully!', 'success');
            document.getElementById('category-form').reset();
            await this.loadCategories();
        } catch (error) {
            console.error('Error adding category:', error);
            this.showNotification(error.message, 'error');
        }
    }

    validateTransaction(tx) {
        if (!tx.type || !tx.amount || tx.amount <= 0 || !tx.category || !tx.transaction_date) {
            this.showNotification('Please fill all required fields', 'error');
            return false;
        }
        return true;
    }

    updateFormForSalary() {
        const typeSelect = document.getElementById('type');
        const categorySelect = document.getElementById('category');
        const paymentSourceSelect = document.getElementById('payment-source');
        const sourceDetailsSelect = document.getElementById('source-details');
        const dateInput = document.getElementById('date');

        const isSalary = typeSelect.value === 'income' &&
                         categorySelect.value.trim().toLowerCase() === 'salary';

        if (isSalary) {
            // Auto-fill payment details
            paymentSourceSelect.innerHTML = '<option value="salary" selected>Salary Deposit</option>';
            sourceDetailsSelect.innerHTML = `<option value="${this.salaryAccount}" selected>${this.salaryAccount}</option>`;
            paymentSourceSelect.disabled = true;
            sourceDetailsSelect.disabled = true;
            sourceDetailsSelect.parentElement.style.display = 'block';

            // Auto-set date to LAST WORKING DAY of the currently selected date's month
            try {
                const currentDate = new Date((dateInput.value || new Date().toISOString().split('T')[0]) + 'T00:00:00');
                const year = currentDate.getFullYear();
                const month = currentDate.getMonth() + 1; // 1-based
                const lastWorkingDay = this.getLastWorkingDay(year, month);
                dateInput.value = this.formatDateToYYYYMMDD(lastWorkingDay);
            } catch (e) {
                console.error("Could not auto-set salary date:", e);
            }
        } else {
            if (paymentSourceSelect.disabled) {
                paymentSourceSelect.innerHTML = `
                    <option value="">Select Source</option>
                    <option value="upi">UPI</option>
                    <option value="credit-card">Credit Card</option>
                    <option value="debit-card">Debit Card</option>
                    <option value="cash">Cash</option>
                `;
            }
            paymentSourceSelect.disabled = false;
            sourceDetailsSelect.disabled = false;
            this.updateSourceDetailsOptions();
        }
    }

    updateSourceDetailsOptions() {
        const paymentSource = document.getElementById('payment-source').value;
        const sourceDetailsSelect = document.getElementById('source-details');

        sourceDetailsSelect.innerHTML = '<option value="">Select Details</option>';

        if (this.paymentSources[paymentSource]) {
            sourceDetailsSelect.parentElement.style.display = 'block';
            sourceDetailsSelect.required = true;

            this.paymentSources[paymentSource].forEach(source => {
                const option = document.createElement('option');
                option.value = source;
                option.textContent = source;
                sourceDetailsSelect.appendChild(option);
            });
        } else {
            sourceDetailsSelect.parentElement.style.display = 'none';
            sourceDetailsSelect.required = false;
        }
    }

    populateCategoryDropdowns() {
        const categorySelect = document.getElementById('category');
        const filterCategorySelect = document.getElementById('filter-category');

        const currentCategoryVal = categorySelect.value;
        const currentFilterVal = filterCategorySelect.value;

        categorySelect.innerHTML = '<option value="">Select Category</option>';
        filterCategorySelect.innerHTML = '<option value="">All Categories</option>';

        const selectedType = document.getElementById('type').value;

        const filtered = selectedType
            ? this.categories.filter(cat => cat.type === selectedType)
            : [];

        filtered.forEach(category => {
            const option = document.createElement('option');
            option.value = category.name;
            option.textContent = `${category.icon} ${category.name}`;
            categorySelect.appendChild(option);
        });

        this.categories.forEach(category => {
            const option = document.createElement('option');
            option.value = category.name;
            option.textContent = `${category.icon} ${category.name}`;
            filterCategorySelect.appendChild(option);
        });

        categorySelect.value = currentCategoryVal;
        filterCategorySelect.value = currentFilterVal;
    }

    updateCategoryOptions() {
        this.populateCategoryDropdowns();
    }

    displayCategories() {
        const incomeContainer = document.getElementById('income-categories');
        const expenseContainer = document.getElementById('expense-categories');
        if (!incomeContainer || !expenseContainer) return;

        incomeContainer.innerHTML = '';
        expenseContainer.innerHTML = '';

        this.categories.forEach(category => {
            const categoryDiv = document.createElement('div');
            categoryDiv.className = 'category-item';
            categoryDiv.innerHTML = `
                <span class="category-icon">${category.icon}</span>
                <span class="category-name">${category.name}</span>
            `;

            if (category.type === 'income') {
                incomeContainer.appendChild(categoryDiv);
            } else {
                expenseContainer.appendChild(categoryDiv);
            }
        });
    }

    displayTransactions() {
        const transactionsList = document.getElementById('transactions-list');
        if (!transactionsList) return;

        if (this.transactions.length === 0) {
            transactionsList.innerHTML = '<div class="loading">No transactions found for this month.</div>';
            return;
        }

        const html = this.transactions.map(t => {
            const category = this.categories.find(cat => cat.name === t.category);
            const categoryIcon = category ? category.icon : '📁';
            const date = new Date(t.transaction_date + 'T00:00:00').toLocaleDateString('en-IN', {
                day: '2-digit',
                month: 'short',
                year: 'numeric'
            });
            const amount = this.formatCurrency(t.amount);

            return `
                <div class="transaction-item">
                    <div class="transaction-details">
                        <h4>${categoryIcon} ${t.category}</h4>
                        <p>Paid to: <strong>${t.payment_to || 'N/A'}</strong></p>
                        <p>${t.description || 'No description'}</p>
                        <small>${date} via ${t.source_details || t.payment_source}</small>
                    </div>
                    <div class="transaction-amount ${t.type}">
                        ${t.type === 'income' ? '+' : '-'}${amount}
                    </div>
                </div>
            `;
        }).join('');

        transactionsList.innerHTML = html;
    }

    async filterTransactions() {
        const { startDate, endDate } = this.getDateRangeForMonth(this.selectedMonth);
        await this.loadTransactions(startDate, endDate, false);
    }

    async updateStats(startDate, endDate, prevMonthSalary = 0) {
        try {
            const { data, error } = await supabaseClient.rpc('get_monthly_stats', {
                user_id_input: this.currentUser.id,
                start_date: startDate,
                end_date: endDate
            });

            if (error) throw error;

            const stats = data[0];
            if (!stats) {
                console.warn('No stats returned from RPC');
                return;
            }

            // Add salary pulled forward
            const finalIncome = Number(stats.total_income) + Number(prevMonthSalary);
            const finalBalance = Number(stats.net_balance) + Number(prevMonthSalary);

            document.getElementById('total-income').textContent = this.formatCurrency(finalIncome);
            document.getElementById('total-expenses').textContent = this.formatCurrency(stats.total_expenses);
            document.getElementById('net-balance').textContent = this.formatCurrency(finalBalance);

            const balanceCard = document.getElementById('balance-card');
            balanceCard.className = 'stat-card balance-card';
            if (finalBalance > 0) balanceCard.classList.add('positive');
            else if (finalBalance < 0) balanceCard.classList.add('negative');
        } catch (error) {
            console.error('Error updating stats:', error);
            this.showNotification('Failed to load summary', 'error');
        }
    }

    async updateChart(startDate, endDate, prevMonthSalary = 0) {
        try {
            const { data: transactions, error } = await supabaseClient
                .from('transactions')
                .select('transaction_date, type, amount')
                .eq('user_id', this.currentUser.id)
                .gte('transaction_date', startDate)
                .lte('transaction_date', endDate)
                .order('transaction_date');

            if (error) throw error;

            const chartData = this.processChartData(transactions, startDate, endDate, prevMonthSalary);

            if (this.chart) this.chart.destroy();

            const canvas = document.getElementById('chart');
            if (!canvas) return;

            const monthName = new Date(this.selectedMonth + '-02').toLocaleString('en-IN', { month: 'long', year: 'numeric' });
            document.getElementById('line-chart-title').textContent = `📈 Daily Breakdown (${monthName})`;

            this.chart = new Chart(canvas.getContext('2d'), {
                type: 'line',
                data: {
                    labels: chartData.labels,
                    datasets: [
                        {
                            label: 'Income (₹)',
                            data: chartData.income,
                            borderColor: '#10b981',
                            backgroundColor: 'rgba(16, 185, 129, 0.1)',
                            tension: 0.4,
                            fill: true
                        },
                        {
                            label: 'Expenses (₹)',
                            data: chartData.expenses,
                            borderColor: '#ef4444',
                            backgroundColor: 'rgba(239, 68, 68, 0.1)',
                            tension: 0.4,
                            fill: true
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: {
                            beginAtZero: true,
                            ticks: { callback: (v) => '₹' + v.toLocaleString('en-IN') }
                        }
                    },
                    plugins: {
                        tooltip: {
                            callbacks: {
                                label: (ctx) => `${ctx.dataset.label}: ₹${ctx.parsed.y.toLocaleString('en-IN')}`
                            }
                        }
                    }
                }
            });
        } catch (error) {
            console.error('Error updating chart:', error);
        }
    }

    processChartData(transactions, startDate, endDate, prevMonthSalary = 0) {
        const labels = [];
        const income = [];
        const expenses = [];

        const dailyData = {};
        const start = new Date(startDate + 'T00:00:00');
        const end = new Date(endDate + 'T00:00:00');

        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const dateStr = d.toISOString().split('T')[0];
            const label = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
            labels.push(label);
            dailyData[dateStr] = { income: 0, expenses: 0 };
        }

        // Add previous month salary to first day of this month
        if (dailyData[startDate]) {
            dailyData[startDate].income += Number(prevMonthSalary);
        }

        (transactions || []).forEach(t => {
            const dateStr = t.transaction_date;
            if (dailyData[dateStr]) {
                if (t.type === 'income') {
                    dailyData[dateStr].income += Number(t.amount);
                } else {
                    dailyData[dateStr].expenses += Number(t.amount);
                }
            }
        });

        Object.keys(dailyData).forEach(dateStr => {
            income.push(dailyData[dateStr].income);
            expenses.push(dailyData[dateStr].expenses);
        });

        return { labels, income, expenses };
    }

    async updateExpenseDonutChart(startDate, endDate) {
        try {
            const { data: expenses, error } = await supabaseClient.rpc('get_monthly_donut_data', {
                user_id_input: this.currentUser.id,
                start_date: startDate,
                end_date: endDate
            });

            if (error) throw error;

            this.allExpenses = expenses || [];
            this.renderChartBySource();
        } catch (error) {
            console.error('Error updating donut chart:', error);
        }
    }

    renderChartBySource() {
        this.currentChartView = 'source';
        const btn = document.getElementById('reset-chart-view-btn');
        if (btn) btn.style.display = 'none';

        const sourceData = this.allExpenses.reduce((acc, exp) => {
            const src = exp.payment_source || 'Unknown';
            if (!acc[src]) acc[src] = 0;
            acc[src] += Number(exp.total_amount);
            return acc;
        }, {});

        const labels = Object.keys(sourceData);
        const data = Object.values(sourceData);

        this.renderDonutChart(labels, data, '📊 Expenses by Source');
    }

    renderChartByCategory(source) {
        this.currentChartView = 'category';
        const btn = document.getElementById('reset-chart-view-btn');
        if (btn) btn.style.display = 'inline-block';

        const categoryData = this.allExpenses
            .filter(e => (e.payment_source || 'Unknown') === source)
            .reduce((acc, e) => {
                const cat = e.category || 'Uncategorized';
                if (!acc[cat]) acc[cat] = 0;
                acc[cat] += Number(e.total_amount);
                return acc;
            }, {});

        const labels = Object.keys(categoryData);
        const data = Object.values(categoryData);

        this.renderDonutChart(labels, data, `📂 Expenses from ${source}`);
    }

    renderDonutChart(labels, data, title) {
        if (this.expenseDonutChart) this.expenseDonutChart.destroy();

        const canvas = document.getElementById('expense-donut-chart');
        if (!canvas) return;

        const titleEl = document.getElementById('donut-chart-title');
        if (titleEl) titleEl.textContent = title;

        this.expenseDonutChart = new Chart(canvas.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels,
                datasets: [{
                    label: 'Amount (₹)',
                    data,
                    backgroundColor: [
                        '#4f46e5', '#10b981', '#f59e0b', '#ef4444',
                        '#3b82f6', '#8b5cf6', '#ec4899', '#6b7280',
                        '#f97316', '#84cc16', '#06b6d4', '#8b5a2b'
                    ],
                    borderWidth: 2,
                    borderColor: '#ffffff',
                    hoverOffset: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom', labels: { padding: 20, usePointStyle: true } },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => {
                                const value = ctx.parsed;
                                const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                                const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                                return `${ctx.label}: ₹${value.toLocaleString('en-IN')} (${percentage}%)`;
                            }
                        }
                    }
                },
                onClick: (evt, elements) => {
                    if (elements.length > 0 && this.currentChartView === 'source') {
                        const index = elements[0].index;
                        const source = labels[index];
                        this.renderChartByCategory(source);
                    }
                }
            }
        });
    }

    // --- Utility Methods ---

    formatCurrency(amount) {
        return '₹' + Number(amount).toLocaleString('en-IN', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    setTodayDate() {
        const el = document.getElementById('date');
        if (el) el.value = new Date().toISOString().split('T')[0];
    }

    resetForm() {
        document.getElementById('transaction-form').reset();
        this.setTodayDate();
        this.updateCategoryOptions();
        this.updateFormForSalary();
    }

    showPage(pageId, event) {
        document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
        document.querySelectorAll('.nav-tab').forEach(tab => tab.classList.remove('active'));

        document.getElementById(pageId).classList.add('active');
        if (event) event.currentTarget.classList.add('active');

        if (pageId === 'dashboard') {
            this.updateDashboardForSelectedMonth();
        }
    }

    showNotification(message, type = 'success') {
        const notification = document.getElementById('notification');
        const messageEl = document.getElementById('notification-message');

        messageEl.textContent = message.replace('Error: ', '');
        notification.className = `notification ${type} show`;

        if (this.notificationTimer) clearTimeout(this.notificationTimer);
        this.notificationTimer = setTimeout(() => this.hideNotification(), 5000);
    }

    hideNotification() {
        document.getElementById('notification').classList.remove('show');
    }

    getCurrentMonthString() {
        return new Date().toISOString().slice(0, 7);
    }

    getDateRangeForMonth(monthString) {
        const year = parseInt(monthString.split('-')[0], 10);
        const month = parseInt(monthString.split('-')[1], 10);

        const startDate = `${monthString}-01`;
        const lastDay = new Date(year, month, 0).getDate();
        const endDate = `${monthString}-${String(lastDay).padStart(2, '0')}`;

        return { startDate, endDate };
    }

    // --- Salary Helper Methods ---

    // PAYCHECK CYCLE FIX:
    // Get previous month's pay period as EXACT last working day only
    getPreviousMonthPayPeriod() {
        const [year, month1] = this.selectedMonth.split('-').map(Number); // month1 is 1-based
        const prevMonthDate = new Date(year, month1 - 1, 1);
        prevMonthDate.setMonth(prevMonthDate.getMonth() - 1);

        const prevYear = prevMonthDate.getFullYear();
        const prevMonth = prevMonthDate.getMonth() + 1; // 1-based

        const lastWorkingDay = this.getLastWorkingDay(prevYear, prevMonth);
        const d = this.formatDateToYYYYMMDD(lastWorkingDay);

        return { startDate: d, endDate: d };
    }

    // Query the salary credited on the last working day of previous month
    async getPreviousMonthSalary() {
        try {
            const { startDate, endDate } = this.getPreviousMonthPayPeriod();

            const { data, error } = await supabaseClient
                .from('transactions')
                .select('amount')
                .eq('user_id', this.currentUser.id)
                .eq('type', 'income')
                .ilike('category', 'Salary%') // case-insensitive, supports "Salary", "Salary Bonus", etc.
                .gte('transaction_date', startDate)
                .lte('transaction_date', endDate);

            if (error) throw error;

            const prevMonthSalary = (data || []).reduce((sum, tx) => sum + Number(tx.amount), 0);
            return prevMonthSalary;
        } catch (error) {
            console.error('Could not fetch previous month salary:', error);
            this.showNotification('Could not fetch previous salary', 'error');
            return 0;
        }
    }

    // Last working day for a 1-based month
    getLastWorkingDay(year, month) {
        const lastDay = new Date(year, month, 0); // last day of month
        const dayOfWeek = lastDay.getDay(); // 0=Sun, 6=Sat

        if (dayOfWeek === 0) { // Sunday
            lastDay.setDate(lastDay.getDate() - 2);
        } else if (dayOfWeek === 6) { // Saturday
            lastDay.setDate(lastDay.getDate() - 1);
        }
        return lastDay;
    }

    formatDateToYYYYMMDD(date) {
        return date.toISOString().split('T')[0];
    }

    // --- Optional Settings: Save/Load preferred salary account ---

    async loadSalaryAccountSetting() {
        try {
            const { data, error } = await supabaseClient
                .from('user_settings')
                .select('salary_account')
                .eq('user_id', this.currentUser.id)
                .single();

            if (!error && data && data.salary_account) {
                this.salaryAccount = data.salary_account;
            }

            const select = document.getElementById('salary-default-account');
            if (select) select.value = this.salaryAccount;
        } catch (e) {
            // table or row may not exist yet; ignore silently
        }
    }

    async saveSalaryAccountSetting(e) {
        e.preventDefault();
        const select = document.getElementById('salary-default-account');
        if (!select) return;

        const newAccount = select.value;

        try {
            const { error } = await supabaseClient
                .from('user_settings')
                .upsert({
                    user_id: this.currentUser.id,
                    salary_account: newAccount
                });

            if (error) throw error;

            this.salaryAccount = newAccount;
            this.showNotification(`Salary default account set to ${newAccount}`, 'success');
            // If user is on Add Transaction and Salary selected, refresh autofill
            this.updateFormForSalary();
        } catch (err) {
            console.error('Error saving salary account:', err);
            this.showNotification('Could not save salary account', 'error');
        }
    }
}

// --- Global Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    // Attach auth listeners
    document.getElementById('login-form').addEventListener('submit', handleLogin);
    document.getElementById('signup-form').addEventListener('submit', handleSignup);
    document.getElementById('reset-form').addEventListener('submit', handleReset);
    document.getElementById('login-tab-btn').addEventListener('click', () => showAuthTab('login'));
    document.getElementById('signup-tab-btn').addEventListener('click', () => showAuthTab('signup'));
    document.getElementById('forgot-password-link').addEventListener('click', (e) => {
        e.preventDefault();
        showAuthTab('reset');
    });
    document.getElementById('back-to-login-btn').addEventListener('click', () => showAuthTab('login'));

    // Auth state
    supabaseClient.auth.onAuthStateChange((event, session) => {
        const mainAppContainer = document.querySelector('.container');
        const authContainer = document.querySelector('#auth-container');

        if (session) {
            // Logged in
            authContainer.style.display = 'none';
            mainAppContainer.style.display = 'block';

            // Initialize main app
            if (!window.expenseTracker) {
                window.expenseTracker = new ExpenseTracker();
            }
        } else {
            // Logged out
            authContainer.style.display = 'flex';
            mainAppContainer.style.display = 'none';

            // Clean old instance
            if (window.expenseTracker) {
                if (window.expenseTracker.chart) window.expenseTracker.chart.destroy();
                if (window.expenseTracker.expenseDonutChart) window.expenseTracker.expenseDonutChart.destroy();
                window.expenseTracker = null;
            }
        }
    });
});
