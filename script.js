// script.js - Clean Expense Tracker Implementation

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
        
        // Payment source mapping
        this.paymentSources = {
            'upi': ['UBI', 'ICICI', 'SBI', 'Indian Bank'],
            'debit-card': ['UBI', 'ICICI', 'SBI', 'Indian Bank'],
            'credit-card': ['ICICI Platinum', 'ICICI Amazon Pay', 'ICICI Coral', 'RBL Paisabazar', 'UBI CC']
        };
        
        this.init();
    }

    async init() {
        try {
            await this.testConnection();
            await this.loadCategories();
            await this.loadTransactions();
            this.setupEventListeners();
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

    async loadCategories() {
        try {
            const { data, error } = await supabaseClient
                .from('categories')
                .select('*')
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

    async loadTransactions() {
        try {
            const { data, error } = await supabaseClient
                .from('transactions')
                .select('*')
                .order('transaction_date', { ascending: false })
                .order('created_at', { ascending: false })
                .range(0, this.loadLimit - 1);
            
            if (error) throw error;
            
            this.transactions = data || [];
            this.loadOffset = this.transactions.length;
            this.displayTransactions();
            await this.updateLoadMoreButton();
        } catch (error) {
            console.error('Error loading transactions:', error);
            this.showNotification('Failed to load transactions', 'error');
        }
    }

    async loadMoreTransactions() {
        try {
            const { data, error } = await supabaseClient
                .from('transactions')
                .select('*')
                .order('transaction_date', { ascending: false })
                .order('created_at', { ascending: false })
                .range(this.loadOffset, this.loadOffset + this.loadLimit - 1);
            
            if (error) throw error;
            
            if (data && data.length > 0) {
                this.transactions.push(...data);
                this.loadOffset += data.length;
                this.displayTransactions();
            }
            
            await this.updateLoadMoreButton();
        } catch (error) {
            console.error('Error loading more transactions:', error);
            this.showNotification('Failed to load more transactions', 'error');
        }
    }

    async updateLoadMoreButton() {
        const container = document.getElementById('load-more-container');
        
        try {
            const { count, error } = await supabaseClient
                .from('transactions')
                .select('*', { count: 'exact', head: true });
            
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
    }

    async handleTransactionSubmit(e) {
        e.preventDefault();
        
        try {
            const { data: { user } } = await supabaseClient.auth.getUser();
            if (!user) {
                this.showNotification('You must be logged in', 'error');
                return;
            }

            const transaction = {
                type: document.getElementById('type').value,
                amount: parseFloat(document.getElementById('amount').value),
                category: document.getElementById('category').value,
                transaction_date: document.getElementById('date').value,
                description: document.getElementById('description').value || null,
                payment_to: document.getElementById('payment-to').value,
                payment_source: document.getElementById('payment-source').value,
                source_details: document.getElementById('source-details').value || null,
                user_id: user.id
            };

            if (!this.validateTransaction(transaction)) {
                return;
            }

            const { error } = await supabaseClient
                .from('transactions')
                .insert([transaction]);

            if (error) throw error;

            this.showNotification('Transaction added successfully!', 'success');
            this.resetForm();
            await this.loadTransactions();
            
            // Update dashboard if it's active
            if (document.getElementById('dashboard').classList.contains('active')) {
                await this.updateDashboard();
            }
        } catch (error) {
            console.error('Error adding transaction:', error);
            this.showNotification(`Failed to add transaction: ${error.message}`, 'error');
        }
    }

    async handleCategorySubmit(e) {
        e.preventDefault();
        
        try {
            const { data: { user } } = await supabaseClient.auth.getUser();
            if (!user) {
                this.showNotification('You must be logged in', 'error');
                return;
            }

            const category = {
                name: document.getElementById('category-name').value.trim(),
                type: document.getElementById('category-type').value,
                icon: document.getElementById('category-icon').value.trim() || '📁',
                user_id: user.id
            };

            if (!category.name || !category.type) {
                this.showNotification('Name and type are required', 'error');
                return;
            }

            const { error } = await supabaseClient
                .from('categories')
                .insert([category]);

            if (error) {
                if (error.code === '23505') {
                    throw new Error('Category already exists!');
                }
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
        
        const isSalary = typeSelect.value === 'income' && categorySelect.value === 'Salary';
        
        if (isSalary) {
            paymentSourceSelect.innerHTML = '<option value="salary" selected>Salary Deposit</option>';
            sourceDetailsSelect.innerHTML = `<option value="${this.salaryAccount}" selected>${this.salaryAccount}</option>`;
            paymentSourceSelect.disabled = true;
            sourceDetailsSelect.disabled = true;
            sourceDetailsSelect.parentElement.style.display = 'block';
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
        
        categorySelect.innerHTML = '<option value="">Select Category</option>';
        filterCategorySelect.innerHTML = '<option value="">All Categories</option>';
        
        const selectedType = document.getElementById('type').value;
        const filteredCategories = selectedType ? 
            this.categories.filter(cat => cat.type === selectedType) : 
            this.categories;
        
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
            transactionsList.innerHTML = '<div class="loading">No transactions found.</div>';
            return;
        }
        
        const transactionsHTML = this.transactions.map(transaction => {
            const category = this.categories.find(cat => cat.name === transaction.category);
            const categoryIcon = category ? category.icon : '📁';
            const date = new Date(transaction.transaction_date).toLocaleDateString('en-IN');
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
        const filterType = document.getElementById('filter-type').value;
        const filterCategory = document.getElementById('filter-category').value;
        
        try {
            let query = supabaseClient
                .from('transactions')
                .select('*')
                .order('transaction_date', { ascending: false })
                .order('created_at', { ascending: false });
            
            if (filterType) {
                query = query.eq('type', filterType);
            }
            
            if (filterCategory) {
                query = query.eq('category', filterCategory);
            }
            
            const { data, error } = await query.limit(50);
            
            if (error) throw error;
            
            this.transactions = data || [];
            this.displayTransactions();
        } catch (error) {
            console.error('Error filtering transactions:', error);
            this.showNotification('Failed to filter transactions', 'error');
        }
    }

    async updateDashboard() {
        try {
            await this.updateStats();
            await this.updateChart();
            await this.updateExpenseDonutChart();
        } catch (error) {
            console.error('Error updating dashboard:', error);
            this.showNotification('Failed to update dashboard', 'error');
        }
    }

    async updateStats() {
        try {
            const { data: { user } } = await supabaseClient.auth.getUser();
            if (!user) return;

            const { data: transactions, error } = await supabaseClient
                .from('transactions')
                .select('type, amount')
                .eq('user_id', user.id);
            
            if (error) throw error;
            
            let totalIncome = 0;
            let totalExpenses = 0;
            
            transactions.forEach(transaction => {
                if (transaction.type === 'income') {
                    totalIncome += parseFloat(transaction.amount);
                } else if (transaction.type === 'expense') {
                    totalExpenses += parseFloat(transaction.amount);
                }
            });
            
            const netBalance = totalIncome - totalExpenses;
            
            document.getElementById('total-income').textContent = this.formatCurrency(totalIncome);
            document.getElementById('total-expenses').textContent = this.formatCurrency(totalExpenses);
            document.getElementById('net-balance').textContent = this.formatCurrency(netBalance);
            
            const balanceCard = document.getElementById('balance-card');
            balanceCard.className = 'stat-card balance-card';
            if (netBalance > 0) {
                balanceCard.classList.add('positive');
            } else if (netBalance < 0) {
                balanceCard.classList.add('negative');
            }
        } catch (error) {
            console.error('Error updating stats:', error);
        }
    }

    async updateChart() {
        try {
            await this.waitForChart();
            
            const endDate = new Date();
            const startDate = new Date();
            startDate.setDate(endDate.getDate() - 6);
            
            const { data: transactions, error } = await supabaseClient
                .from('transactions')
                .select('transaction_date, type, amount')
                .gte('transaction_date', startDate.toISOString().split('T')[0])
                .order('transaction_date');
            
            if (error) throw error;
            
            const chartData = this.processChartData(transactions);
            
            if (this.chart) {
                this.chart.destroy();
            }
            
            const ctx = document.getElementById('chart');
            if (!ctx) {
                console.error('Chart canvas not found');
                return;
            }
            
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
                            ticks: {
                                callback: (value) => '₹' + value.toLocaleString('en-IN')
                            }
                        }
                    },
                    plugins: {
                        tooltip: {
                            callbacks: {
                                label: (context) => {
                                    return context.dataset.label + ': ₹' + context.parsed.y.toLocaleString('en-IN');
                                }
                            }
                        }
                    }
                }
            });
        } catch (error) {
            console.error('Error updating chart:', error);
            const chartContainer = document.getElementById('chart').parentElement;
            if (chartContainer) {
                chartContainer.innerHTML = `
                    <div style="text-align: center; padding: 20px; color: #ef4444;">
                        <p><strong>Chart Loading Error</strong></p>
                        <p>${error.message}</p>
                    </div>
                `;
            }
        }
    }

    processChartData(transactions) {
        const labels = [];
        const income = [];
        const expenses = [];
        
        for (let i = 6; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            labels.push(date.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' }));
            
            const dateStr = date.toISOString().split('T')[0];
            const dayIncome = transactions
                .filter(t => t.type === 'income' && t.transaction_date === dateStr)
                .reduce((sum, t) => sum + parseFloat(t.amount), 0);
            const dayExpenses = transactions
                .filter(t => t.type === 'expense' && t.transaction_date === dateStr)
                .reduce((sum, t) => sum + parseFloat(t.amount), 0);
            
            income.push(dayIncome);
            expenses.push(dayExpenses);
        }
        
        return { labels, income, expenses };
    }

    async updateExpenseDonutChart() {
        try {
            await this.waitForChart();
            
            const { data: { user } } = await supabaseClient.auth.getUser();
            if (!user) return;

            const { data: expenses, error } = await supabaseClient
                .from('transactions')
                .select('payment_source, category, amount')
                .eq('type', 'expense')
                .eq('user_id', user.id);
            
            if (error) throw error;
            
            const groupedExpenses = [];
            const sourceMap = {};
            
            expenses.forEach(expense => {
                const key = `${expense.payment_source}-${expense.category}`;
                if (!sourceMap[key]) {
                    sourceMap[key] = {
                        payment_source: expense.payment_source || 'Unknown',
                        category: expense.category || 'Uncategorized',
                        total_amount: 0
                    };
                    groupedExpenses.push(sourceMap[key]);
                }
                sourceMap[key].total_amount += parseFloat(expense.amount);
            });
            
            this.allExpenses = groupedExpenses;
            this.renderChartBySource();
        } catch (error) {
            console.error('Error updating donut chart:', error);
            const container = document.getElementById('donut-chart-container');
            if (container) {
                container.innerHTML = `
                    <div style="text-align: center; padding: 20px; color: #ef4444;">
                        <h3>📊 Expenses by Source</h3>
                        <p><strong>Chart Loading Error</strong></p>
                        <p>${error.message}</p>
                    </div>
                `;
            }
        }
    }

    renderChartBySource() {
        this.currentChartView = 'source';
        document.getElementById('reset-chart-view-btn').style.display = 'none';
        
        const sourceData = this.allExpenses.reduce((acc, expense) => {
            if (!acc[expense.payment_source]) {
                acc[expense.payment_source] = 0;
            }
            acc[expense.payment_source] += expense.total_amount;
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
                const category = expense.category || 'Uncategorized';
                if (!acc[category]) {
                    acc[category] = 0;
                }
                acc[category] += expense.total_amount;
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
            if (!ctx) {
                console.error('Donut chart canvas not found');
                return;
            }
            
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
                            labels: {
                                padding: 20,
                                usePointStyle: true
                            }
                        },
                        tooltip: {
                            callbacks: {
                                label: (context) => {
                                    const value = context.parsed;
                                    const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                    const percentage = ((value / total) * 100).toFixed(1);
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
                    const script = document.createElement('script');
                    script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.min.js';
                    script.onload = () => resolve();
                    script.onerror = () => reject(new Error('Failed to load Chart.js'));
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

    showNotification(message, type = 'success') {
        const notification = document.getElementById('notification');
        const messageEl = document.getElementById('notification-message');
        
        messageEl.textContent = message;
        notification.className = `notification ${type} show`;
        
        setTimeout(() => this.hideNotification(), 5000);
    }

    hideNotification() {
        document.getElementById('notification').classList.remove('show');
    }
}

// Global functions for page navigation and form management
function showPage(pageId, event) {
    document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
    document.querySelectorAll('.nav-tab').forEach(tab => tab.classList.remove('active'));
    
    document.getElementById(pageId).classList.add('active');
    
    if (event) {
        event.target.classList.add('active');
    }
    
    if (pageId === 'dashboard' && window.expenseTracker) {
        window.expenseTracker.updateDashboard();
    }
}

function resetForm() {
    if (window.expenseTracker) {
        window.expenseTracker.resetForm();
    }
}

// Initialize when DOM is ready and user is authenticated
document.addEventListener('DOMContentLoaded', () => {
    supabaseClient.auth.onAuthStateChange((event, session) => {
        const mainAppContainer = document.querySelector('.container');
        const authContainer = document.querySelector('#auth-container');
        
        if (session) {
            authContainer.style.display = 'none';
            mainAppContainer.style.display = 'block';
            
            if (!window.expenseTracker) {
                window.expenseTracker = new ExpenseTracker();
            }
        } else {
            authContainer.style.display = 'flex';
            mainAppContainer.style.display = 'none';
            
            if (window.expenseTracker) {
                window.expenseTracker = null;
            }
        }
    });
});