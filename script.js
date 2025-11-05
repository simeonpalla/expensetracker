// script.js - Clean, Month-Centric Expense Tracker Implementation

// --- Authentication Functions (Moved from HTML) ---
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
    } catch (error)
    {
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
        this.salaryAccount = 'UBI';
        this.selectedMonth = this.getCurrentMonthString(); // e.g., "2025-11"
        
        this.paymentSources = {
            'upi': ['UBI', 'ICICI', 'SBI', 'Indian Bank'],
            'debit-card': ['UBI', 'ICICI', 'SBI', 'Indian Bank'],
            'credit-card': ['ICICI Platinum', 'ICICI Amazon Pay', 'ICICI Coral', 'RBL Paisabazar', 'UBI CC']
        };
        
        // This will be set on init
        this.currentUser = null;

        // Initialize immediately
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
            
            // Load categories once (this is fine)
            await this.loadCategories(); 
            
            // *** CHART FIX ***
            // DO NOT load dashboard data here. It will be loaded
            // when the user clicks the "Dashboard" tab for the first time.
            
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
            // A lightweight query to check connection
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
        document.getElementById('transactions-list').innerHTML = '<div class="loading">Loading transactions...</div>';

        try {
            // *** PAYCHECK CYCLE FIX ***
            // We need the salary *before* we can run the other updates
            const prevMonthSalary = await this.getPreviousMonthSalary();

            // Run all updates in parallel for a faster dashboard load
            await Promise.all([
                this.loadTransactions(startDate, endDate), // Initial page of transactions
                this.updateStats(startDate, endDate, prevMonthSalary),
                this.updateChart(startDate, endDate, prevMonthSalary),
                this.updateExpenseDonutChart(startDate, endDate)
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
            
            // Apply filters if they are set
            const filterType = document.getElementById('filter-type').value;
            const filterCategory = document.getElementById('filter-category').value;
            if (filterType) {
                query = query.eq('type', filterType);
            }
            if (filterCategory) {
                query = query.eq('category', filterCategory);
            }

            const { data, error } = await query;
            
            if (error) throw error;
            
            if (data && data.length > 0) {
                this.transactions.push(...data);
                this.loadOffset += data.length;
            }
            
            this.displayTransactions(); // Display whatever we have
            await this.updateLoadMoreButton(startDate, endDate);
        } catch (error) {
            console.error('Error loading transactions:', error);
            this.showNotification('Failed to load transactions', 'error');
        }
    }

    async loadMoreTransactions() {
        const { startDate, endDate } = this.getDateRangeForMonth(this.selectedMonth);
        await this.loadTransactions(startDate, endDate, true); // true = loadMore
    }

    async updateLoadMoreButton(startDate, endDate) {
        const container = document.getElementById('load-more-container');
        try {
            // Check total count *for the selected month*
            let query = supabaseClient
                .from('transactions')
                .select('*', { count: 'exact', head: true })
                .eq('user_id', this.currentUser.id)
                .gte('transaction_date', startDate)
                .lte('transaction_date', endDate);

            // Apply filters to count
            const filterType = document.getElementById('filter-type').value;
            const filterCategory = document.getElementById('filter-category').value;
            if (filterType) {
                query = query.eq('type', filterType);
            }
            if (filterCategory) {
                query = query.eq('category', filterCategory);
            }

            const { count, error } = await query;
            
            if (error) throw error;
            
            if (this.transactions.length < count) {
                container.style.display = 'block';
            } else {
                container.style.display = 'none';
            }
        } catch (error) {
            console.error('Error checking transaction count:', error);
            container.style.display = 'none';
        }
    }

    setupEventListeners() {
        // Form submissions
        document.getElementById('transaction-form').addEventListener('submit', (e) => this.handleTransactionSubmit(e));
        document.getElementById('category-form').addEventListener('submit', (e) => this.handleCategorySubmit(e));
        
        // Form changes
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
        document.getElementById('logout-btn').addEventListener('click', handleLogout); // Global auth func

        // Page Navigation
        document.querySelectorAll('.nav-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                const pageId = e.currentTarget.dataset.page;
                this.showPage(pageId, e);
            });
        });
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
            category: document.getElementById('category').value.trim(), // Trim whitespace on save
            transaction_date: document.getElementById('date').value,
            description: document.getElementById('description').value || null,
            payment_to: document.getElementById('payment-to').value,
            payment_source: document.getElementById('payment-source').value,
            source_details: document.getElementById('source-details').value || null,
            user_id: this.currentUser.id
        };

        if (!this.validateTransaction(transaction)) return;

        try {
            const { error } = await supabaseClient
                .from('transactions')
                .insert([transaction]);

            if (error) throw error;

            this.showNotification('Transaction added successfully!', 'success');
            
            // --- PAYCHECK CYCLE FIX ---
            // Check if the transaction affects the current dashboard
            
            // 1. Does it fall within the selected month?
            const transactionMonth = transaction.transaction_date.slice(0, 7);
            const affectsCurrentMonth = (transactionMonth === this.selectedMonth);

            // 2. Is it a "Salary" in the last week of the *previous* month?
            const { startDate: prevMonthStartDate, endDate: prevMonthEndDate } = this.getPreviousMonthPayPeriod();
            
            // Use a flexible check for "salary"
            const isSalary = transaction.type === 'income' && 
                             transaction.category.trim().toLowerCase() === 'salary';
                             
            const isPreviousMonthSalary = (
                isSalary &&
                transaction.transaction_date >= prevMonthStartDate &&
                transaction.transaction_date <= prevMonthEndDate
            );

            if (affectsCurrentMonth || isPreviousMonthSalary) {
                // Refresh the entire dashboard for this month
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
            name: document.getElementById('category-name').value.trim(), // Trim whitespace on save
            type: document.getElementById('category-type').value,
            icon: document.getElementById('category-icon').value.trim() || '📁',
            user_id: this.currentUser.id
        };

        if (!category.name || !category.type) {
            this.showNotification('Name and type are required', 'error');
            return;
        }

        try {
            const { error } = await supabaseClient
                .from('categories')
                .insert([category]);

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

    validateTransaction(transaction) {
        if (!transaction.type || !transaction.amount || transaction.amount <= 0 || 
            !transaction.category || !transaction.transaction_date) {
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
        const dateInput = document.getElementById('date'); // Get the date input
        
        // --- PAYCHECK CYCLE FIX ---
        // Use a flexible check for "salary"
        const isSalary = typeSelect.value === 'income' && 
                         categorySelect.value.trim().toLowerCase() === 'salary';
        
        if (isSalary) {
            // --- Auto-fill payment details (Existing logic) ---
            paymentSourceSelect.innerHTML = '<option value="salary" selected>Salary Deposit</option>';
            sourceDetailsSelect.innerHTML = `<option value="${this.salaryAccount}" selected>${this.salaryAccount}</option>`;
            paymentSourceSelect.disabled = true;
            sourceDetailsSelect.disabled = true;
            sourceDetailsSelect.parentElement.style.display = 'block';

            // --- NEW: Auto-fill date logic ---
            try {
                // Get the *currently selected* date to determine the month
                // Add T00:00:00 to avoid timezone issues
                const currentDate = new Date(dateInput.value + 'T00:00:00'); 
                const year = currentDate.getFullYear();
                const month = currentDate.getMonth() + 1; // getMonth() is 0-indexed

                const lastWorkingDay = this.getLastWorkingDay(year, month);
                dateInput.value = this.formatDateToYYYYMMDD(lastWorkingDay);
            } catch (e) {
                console.error("Could not auto-set salary date:", e);
                // Fail silently, user can still set it manually.
            }

        } else {
            // --- Restore payment details (Existing logic) ---
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
        
        const filteredCategories = selectedType ? 
            this.categories.filter(cat => cat.type === selectedType) : 
            []; 
        
        filteredCategories.forEach(category => {
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
        
        if (this.transactions.length === 0) {
            transactionsList.innerHTML = '<div class="loading">No transactions found for this month.</div>';
            return;
        }
        
        const transactionsHTML = this.transactions.map(transaction => {
            const category = this.categories.find(cat => cat.name === transaction.category);
            const categoryIcon = category ? category.icon : '📁';
            const date = new Date(transaction.transaction_date + 'T00:00:00').toLocaleDateString('en-IN', {
                day: '2-digit',
                month: 'short',
                year: 'numeric'
            });
            const amount = this.formatCurrency(transaction.amount);
            
            return `
                <div class="transaction-item">
                    <div class="transaction-details">
                        <h4>${categoryIcon} ${transaction.category}</h4>
                        <p>Paid to: <strong>${transaction.payment_to || 'N/A'}</strong></p>
                        <p>${transaction.description || 'No description'}</p>
                        <small>${date} via ${transaction.source_details || transaction.payment_source}</small>
                    </div>
                    <div class="transaction-amount ${transaction.type}">
                        ${transaction.type === 'income' ? '+' : '-'}${amount}
                    </div>
                </div>
            `;
        }).join('');
        
        transactionsList.innerHTML = transactionsHTML;
    }

    async filterTransactions() {
        const { startDate, endDate } = this.getDateRangeForMonth(this.selectedMonth);
        await this.loadTransactions(startDate, endDate, false); // false = new load
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

            // *** PAYCHECK CYCLE FIX ***
            // Add the salary from the previous month to this month's totals
            const finalIncome = stats.total_income + prevMonthSalary;
            const finalBalance = stats.net_balance + prevMonthSalary;
            
            document.getElementById('total-income').textContent = this.formatCurrency(finalIncome);
            document.getElementById('total-expenses').textContent = this.formatCurrency(stats.total_expenses);
            document.getElementById('net-balance').textContent = this.formatCurrency(finalBalance);
            
            const balanceCard = document.getElementById('balance-card');
            balanceCard.className = 'stat-card balance-card'; // Reset classes
            if (finalBalance > 0) {
                balanceCard.classList.add('positive');
            } else if (finalBalance < 0) {
                balanceCard.classList.add('negative');
            }
        } catch (error) {
            console.error('Error updating stats:', error);
            this.showNotification('Failed to load summary', 'error');
        }
    }

    async updateChart(startDate, endDate, prevMonthSalary = 0) {
        try {
            await this.waitForChart();
            
            const { data: transactions, error } = await supabaseClient
                .from('transactions')
                .select('transaction_date, type, amount')
                .eq('user_id', this.currentUser.id)
                .gte('transaction_date', startDate)
                .lte('transaction_date', endDate)
                .order('transaction_date');
            
            if (error) throw error;
            
            // *** PAYCHECK CYCLE FIX ***
            // Pass the pulled-forward salary to the chart processor
            const chartData = this.processChartData(transactions, startDate, endDate, prevMonthSalary);
            
            if (this.chart) {
                this.chart.destroy();
            }
            
            const ctx = document.getElementById('chart');
            if (!ctx) return;
            
            const monthName = new Date(this.selectedMonth + '-02').toLocaleString('en-IN', { month: 'long', year: 'numeric' });
            document.getElementById('line-chart-title').textContent = `📈 Daily Breakdown (${monthName})`;

            this.chart = new Chart(ctx.getContext('2d'), {
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
                            ticks: { callback: (value) => '₹' + value.toLocaleString('en-IN') }
                        }
                    },
                    plugins: {
                        tooltip: {
                            callbacks: {
                                label: (context) => `${context.dataset.label}: ₹${context.parsed.y.toLocaleString('en-IN')}`
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

        // *** PAYCHECK CYCLE FIX ***
        // Add the previous month's salary to the *first day* of this month's chart
        if (dailyData[startDate]) {
            dailyData[startDate].income += prevMonthSalary;
        }

        transactions.forEach(t => {
            const dateStr = t.transaction_date;
            if (dailyData[dateStr]) {
                if (t.type === 'income') {
                    dailyData[dateStr].income += parseFloat(t.amount);
                } else {
                    dailyData[dateStr].expenses += parseFloat(t.amount);
                }
            }
        });

        labels.forEach((label, index) => {
            const dateStr = Object.keys(dailyData)[index];
            income.push(dailyData[dateStr].income);
            expenses.push(dailyData[dateStr].expenses);
        });

        return { labels, income, expenses };
    }

    async updateExpenseDonutChart(startDate, endDate) {
        try {
            await this.waitForChart();
            
            const { data: expenses, error } = await supabaseClient.rpc('get_monthly_donut_data', {
                user_id_input: this.currentUser.id,
                start_date: startDate,
                end_date: endDate
            });
            
            if (error) throw error;
            
            // *** PAYCHECK CYCLE FIX ***
            // We do NOT add the salary to the *expense* chart, so this is correct.
            this.allExpenses = expenses || []; 
            this.renderChartBySource();
        } catch (error) {
            console.error('Error updating donut chart:', error);
        }
    }

    renderChartBySource() {
        this.currentChartView = 'source';
        document.getElementById('reset-chart-view-btn').style.display = 'none';
        
        const sourceData = this.allExpenses.reduce((acc, expense) => {
            const source = expense.payment_source;
            if (!acc[source]) {
                acc[source] = 0;
            }
            acc[source] += parseFloat(expense.total_amount);
            return acc;
        }, {});
        
        const labels = Object.keys(sourceData);
        const data = Object.values(sourceData);
        
        this.renderDonutChart(labels, data, '📊 Expenses by Source');
    }

    renderChartByCategory(source) {
        this.currentChartView = 'category';
        document.getElementById('reset-chart-view-btn').style.display = 'inline-block';
        
        const categoryData = this.allExpenses
            .filter(expense => expense.payment_source === source)
            .reduce((acc, expense) => {
                const category = expense.category;
                if (!acc[category]) {
                    acc[category] = 0;
                }
                acc[category] += parseFloat(expense.total_amount);
                return acc;
            }, {});
        
        const labels = Object.keys(categoryData);
        const data = Object.values(categoryData);
        
        this.renderDonutChart(labels, data, `📂 Expenses from ${source}`);
    }

    async renderDonutChart(labels, data, title) {
        try {
            await this.waitForChart();
            
            if (this.expenseDonutChart) {
                this.expenseDonutChart.destroy();
            }
            
            const ctx = document.getElementById('expense-donut-chart');
            if (!ctx) return;
            
            document.getElementById('donut-chart-title').textContent = title;
            
            this.expenseDonutChart = new Chart(ctx.getContext('2d'), {
                type: 'doughnut',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Amount (₹)',
                        data: data,
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
                        legend: {
                            position: 'bottom',
                            labels: { padding: 20, usePointStyle: true }
                        },
                        tooltip: {
                            callbacks: {
                                label: (context) => {
                                    const value = context.parsed;
                                    const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                    const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                                    return `${context.label}: ₹${value.toLocaleString('en-IN')} (${percentage}%)`;
                                }
                            }
                        }
                    },
                    onClick: (event, elements) => {
                        if (elements.length > 0 && this.currentChartView === 'source') {
                            const index = elements[0].index;
                            const source = labels[index];
                            this.renderChartByCategory(source);
                        }
                    }
                }
            });
        } catch (error) {
            console.error('Error rendering donut chart:', error);
        }
    }

    // --- Utility Methods ---

    // *** CHART FIX ***
    // This is the more resilient Chart.js loader
    async waitForChart() {
        return new Promise((resolve, reject) => {
            let attempts = 0;
            const maxAttempts = 50; // 5 seconds total
            
            const checkChart = () => {
                if (typeof Chart !== 'undefined') {
                    resolve();
                    return;
                }
                
                attempts++;
                if (attempts >= maxAttempts) {
                    // Try to load Chart.js dynamically
                    console.warn('Chart.js not loaded, attempting dynamic load...');
                    const script = document.createElement('script');
                    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.min.js';
                    script.onload = () => {
                        console.log('Chart.js loaded dynamically.');
                        resolve();
                    };
                    script.onerror = () => reject(new Error('Failed to load Chart.js from CDN'));
                    document.head.appendChild(script);
                    return;
                }
                
                setTimeout(checkChart, 100);
            };
            
            checkChart();
        });
    }

    formatCurrency(amount) {
        return '₹' + parseFloat(amount).toLocaleString('en-IN', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    setTodayDate() {
        document.getElementById('date').value = new Date().toISOString().split('T')[0];
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
        
        if (event) {
            event.currentTarget.classList.add('active');
        }
        
        // *** CHART FIX ***
        // Only load the dashboard data when the page is being shown
        if (pageId === 'dashboard') {
            this.updateDashboardForSelectedMonth();
        }
    }

    showNotification(message, type = 'success') {
        const notification = document.getElementById('notification');
        const messageEl = document.getElementById('notification-message');
        
        messageEl.textContent = message.replace('Error: ', ''); // Clean up error messages
        notification.className = `notification ${type} show`;
        
        // Clear old timers
        if (this.notificationTimer) {
            clearTimeout(this.notificationTimer);
        }
        
        this.notificationTimer = setTimeout(() => this.hideNotification(), 5000);
    }

    hideNotification() {
        document.getElementById('notification').classList.remove('show');
    }

    getCurrentMonthString() {
        return new Date().toISOString().slice(0, 7); // "YYYY-MM"
    }

    getDateRangeForMonth(monthString) {
        // monthString is "YYYY-MM"
        const year = parseInt(monthString.split('-')[0]);
        const month = parseInt(monthString.split('-')[1]);
        
        const startDate = `${monthString}-01`;
        
        const lastDay = new Date(year, month, 0).getDate();
        const endDate = `${monthString}-${lastDay}`;
        
        return { startDate, endDate };
    }

    // --- Salary Helper Methods ---
    
    // *** PAYCHECK CYCLE FIX ***
    // New helper to get the "pay period" (last 7 days) of the previous month
    getPreviousMonthPayPeriod() {
        const year = parseInt(this.selectedMonth.split('-')[0]);
        const month_1_based = parseInt(this.selectedMonth.split('-')[1]);
        
        // 1. Get previous month's end date (day 0 of current month)
        const prevMonthEndDate = new Date(year, month_1_based - 1, 0);
        const endDate = this.formatDateToYYYYMMDD(prevMonthEndDate);

        // 2. Get previous month's "pay period start" (e.g., 25th)
        // We get the 25th day of the *previous* month
        const prevMonthStartDate = new Date(prevMonthEndDate.getFullYear(), prevMonthEndDate.getMonth(), 25);
        const startDate = this.formatDateToYYYYMMDD(prevMonthStartDate);
        
        return { startDate, endDate };
    }

    // *** PAYCHECK CYCLE FIX ***
    // Updated function to use the new pay period helper
    async getPreviousMonthSalary() {
        // --- NEW DIAGNOSTIC LOG ---
        console.log("--- RUNNING getPreviousMonthSalary ---");

        try {
            // Get the date range for the last week of the previous month
            const { startDate, endDate } = this.getPreviousMonthPayPeriod();
            
            // --- NEW DIAGNOSTIC LOG ---
            console.log(`Querying for salary between: ${startDate} and ${endDate}`);

            
            // Query for "Salary" in that range
            const { data, error } = await supabaseClient
                .from('transactions')
                .select('amount')
                .eq('user_id', this.currentUser.id)
                .eq('type', 'income')
                // *** THIS IS THE FIX ***
                // This is now case-insensitive AND checks for "Salary" or "Salary "
                .ilike('category', 'Salary%') 
                .gte('transaction_date', startDate) // e.g., >= '2025-10-25'
                .lte('transaction_date', endDate);   // e.g., <= '2025-10-31'

            if (error) throw error;

            let prevMonthSalary = 0;
            if (data && data.length > 0) {
                // Sum up all salaries found (in case of bonus/multiple)
                prevMonthSalary = data.reduce((sum, tx) => sum + parseFloat(tx.amount), 0);
            }
            
            // --- NEW DIAGNOSTIC LOG ---
            console.log(`Found data:`, data);
            console.log(`Calculated previous month salary: ${prevMonthSalary}`);
            
            return prevMonthSalary;

        } catch (error) {
            console.error('Could not fetch previous month salary:', error);
            this.showNotification('Could not fetch previous salary', 'error');
            return 0;
        }
    }

    // This function is still used by the "Add Transaction" form, and it's correct
    getLastWorkingDay(year, month) {
        // month is 1-based (e.g., 11 for November)
        const lastDay = new Date(year, month, 0); 
        const dayOfWeek = lastDay.getDay(); // 0 = Sunday, 6 = Saturday

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

    // Handle Auth State
    // *** THIS IS THE FIX for the typo ***
    supabaseClient.auth.onAuthStateChange((event, session) => {
        const mainAppContainer = document.querySelector('.container');
        const authContainer = document.querySelector('#auth-container');
        
        if (session) {
            // User is logged in
            authContainer.style.display = 'none';
            mainAppContainer.style.display = 'block';
            
            // Initialize main app
            if (!window.expenseTracker) {
                window.expenseTracker = new ExpenseTracker();
            }
        } else {
            // User is logged out
            authContainer.style.display = 'flex';
            mainAppContainer.style.display = 'none';
            
            // Clean up old instance
            if (window.expenseTracker) {
                if (window.expenseTracker.chart) window.expenseTracker.chart.destroy();
                if (window.expenseTracker.expenseDonutChart) window.expenseTracker.expenseDonutChart.destroy();
                window.expenseTracker = null;
            }
        }
    });
});