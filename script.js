// script.js
class ExpenseTracker {
    constructor() {
        this.currentPage = 'add-transaction'
        this.transactions = []
        this.categories = []
        this.chart = null
        this.loadOffset = 0
        this.loadLimit = 10

        // Define your salary account here
        this.salaryAccount = 'UBI';

        this.paymentSources = {
            'upi': ['UBI', 'ICICI', 'SBI', 'Indian Bank'],
            'debit-card': ['UBI', 'ICICI', 'SBI', 'Indian Bank'],
            'credit-card': ['ICICI Platinum', 'ICICI Amazon Pay', 'ICICI Coral', 'RBL Paisabazar', 'UBI CC']
        };
        
        this.init()
    }
    
    async init() {
        // Test Supabase connection 
        await this.testConnection()
        
        // Load initial data
        await this.loadCategories()
        await this.loadTransactions()
        
        // Set up event listeners
        this.setupEventListeners()
        
        // Set today's date as default
        this.setTodayDate()
        
        // Update dashboard
        this.updateDashboard()
        
        console.log('✅ Expense Tracker initialized!')
    }
    
    async testConnection() {
        const statusDot = document.getElementById('status-dot')
        const statusText = document.getElementById('status-text')
        
        try {
            const { count, error } = await supabaseClient
                .from('categories')
                .select('*', { count: 'exact', head: true })
            
            if (error) throw error
            
            statusDot.className = 'status-dot connected'
            statusText.textContent = 'Connected to database'
            console.log('✅ Supabase connected successfully!')
            return true
        } catch (error) {
            statusDot.className = 'status-dot error'
            statusText.textContent = 'Database connection failed'
            console.error('❌ Supabase connection failed:', error.message)
            this.showNotification('Database connection failed. Please check your configuration.', 'error')
            return false
        }
    }
    
    async loadCategories() {
        try {
            const { data, error } = await supabaseClient
                .from('categories')
                .select('*')
                .order('name')
            
            if (error) throw error
            
            this.categories = data
            this.populateCategoryDropdowns()
            this.displayCategories()
            
        } catch (error) {
            console.error('Error loading categories:', error)
            this.showNotification('Failed to load categories', 'error')
        }
    }
    
    async loadTransactions() {
        try {
            const { data, error } = await supabaseClient
                .from('transactions')
                .select('*')
                .order('transaction_date', { ascending: false })
                .order('created_at', { ascending: false })
                .range(0, this.loadLimit - 1)
            
            if (error) throw error
            
            this.transactions = data
            this.loadOffset = data.length
            
            this.displayTransactions()
            this.updateLoadMoreButton()
            
        } catch (error) {
            console.error('Error loading transactions:', error)
            this.showNotification('Failed to load transactions', 'error')
        }
    }
    
    async loadMoreTransactions() {
        try {
            const { data, error } = await supabaseClient
                .from('transactions')
                .select('*')
                .order('transaction_date', { ascending: false })
                .order('created_at', { ascending: false })
                .range(this.loadOffset, this.loadOffset + this.loadLimit - 1)
            
            if (error) throw error
            
            this.transactions.push(...data)
            this.loadOffset += data.length
            
            this.displayTransactions()
            this.updateLoadMoreButton()
            
        } catch (error) {
            console.error('Error loading more transactions:', error)
            this.showNotification('Failed to load more transactions', 'error')
        }
    }
    
    setupEventListeners() {
        // Transaction form
        document.getElementById('transaction-form').addEventListener('submit', (e) => {
            this.handleTransactionSubmit(e)
        })
        
        // Category form
        document.getElementById('category-form').addEventListener('submit', (e) => {
            this.handleCategorySubmit(e)
        })
        
        // Transaction type change
        document.getElementById('type').addEventListener('change', () => {
            this.updateCategoryOptions()
        })
        
        // Filter controls
        document.getElementById('filter-type').addEventListener('change', () => {
            this.filterTransactions()
        })
        
        document.getElementById('filter-category').addEventListener('change', () => {
            this.filterTransactions()
        })
        
        // Load more button
        document.getElementById('load-more-btn').addEventListener('click', () => {
            this.loadMoreTransactions()
        })
        
        // Notification close
        document.getElementById('notification-close').addEventListener('click', () => {
            this.hideNotification()
        })
        
        // Real-time updates
        this.setupRealTimeSubscription()
        
        document.getElementById('payment-source').addEventListener('change', () => {
            this.updateSourceDetailsOptions();
        });
    }

    // In script.js, add this new function inside the ExpenseTracker class

    updateFormForSalary() {
        const typeSelect = document.getElementById('type');
        const categorySelect = document.getElementById('category');
        const paymentSourceSelect = document.getElementById('payment-source');
        const sourceDetailsSelect = document.getElementById('source-details');
        const sourceDetailsGroup = sourceDetailsSelect.parentElement;

        // Check if the combination is Income + Salary
        const isSalary = typeSelect.value === 'income' && categorySelect.value === 'Salary';

        if (isSalary) {
            // If it IS salary, lock the payment fields
            paymentSourceSelect.innerHTML = `<option value="salary" selected>Salary Deposit</option>`;
            sourceDetailsSelect.innerHTML = `<option value="${this.salaryAccount}" selected>${this.salaryAccount}</option>`;
            
            paymentSourceSelect.disabled = true;
            sourceDetailsSelect.disabled = true;
            sourceDetailsGroup.style.display = 'block'; // Ensure the bank/card field is visible

        } else {
            // If it's NOT salary, restore the fields to normal
            if (paymentSourceSelect.disabled) {
                // Only restore if it was previously disabled
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

            // Update the bank/card options based on the current selection
            this.updateSourceDetailsOptions();
        }
    }
    updateSourceDetailsOptions() {
        const source = document.getElementById('payment-source').value;
        const detailsSelect = document.getElementById('source-details');
        const detailsContainer = detailsSelect.parentElement; // The form-group div

        // Clear previous options
        detailsSelect.innerHTML = '<option value="">Select Details</option>';

        if (this.paymentSources[source]) {
            // If the selected source has details (e.g., UPI, Credit Card)
            detailsContainer.style.display = 'block'; // Show the dropdown
            detailsSelect.required = true;

            this.paymentSources[source].forEach(optionText => {
                const option = document.createElement('option');
                option.value = optionText;
                option.textContent = optionText;
                detailsSelect.appendChild(option);
            });
        } else {
            // If source has no details (e.g., Cash)
            detailsContainer.style.display = 'none'; // Hide the dropdown
            detailsSelect.required = false;
        }
    }
    
    setupRealTimeSubscription() {
        // Subscribe to transaction changes
        supabaseClient
            .channel('transactions-channel')
            .on('postgres_changes', 
                { event: '*', schema: 'public', table: 'transactions' },
                (payload) => {
                    console.log('Real-time update:', payload)
                    this.handleRealTimeUpdate(payload)
                }
            )
            .subscribe()
    }
    
    async handleRealTimeUpdate(payload) {
        // Reload transactions and update dashboard
        await this.loadTransactions()
        this.updateDashboard()
        
        if (payload.eventType === 'INSERT') {
            this.showNotification('New transaction added!', 'success')
        } else if (payload.eventType === 'DELETE') {
            this.showNotification('Transaction deleted!', 'warning')
        }
    }
    
    async handleTransactionSubmit(e) {
        e.preventDefault()

        const { data: { user } } = await supabaseClient.auth.getUser();
        if (!user) {
            this.showNotification('You must be logged in to add a transaction.', 'error');
            return;
        }
        
        const transaction = {
            type: document.getElementById('type').value,
            amount: parseFloat(document.getElementById('amount').value),
            category: document.getElementById('category').value,
            transaction_date: document.getElementById('date').value,
            description: document.getElementById('description').value,
            // New fields
            payment_to: document.getElementById('payment-to').value,
            payment_source: document.getElementById('payment-source').value,
            source_details: document.getElementById('source-details').value,
            user_id: user.id 
        };
        
        // Validate data
        if (!this.validateTransaction(transaction)) {
            return
        }
        
        try {
            const { data, error } = await supabaseClient
                .from('transactions')
                .insert([transaction])
                .select()
            
            if (error) throw error
            
            this.showNotification('Transaction added successfully!', 'success')
            this.resetForm()
            
            // Refresh data
            await this.loadTransactions()
            this.updateDashboard()
            
        } catch (error) {
            console.error('Error adding transaction:', error)
            this.showNotification('Failed to add transaction: ' + error.message, 'error')
        }
    }
    
    async handleCategorySubmit(e) {
        e.preventDefault()
        const { data: { user } } = await supabaseClient.auth.getUser();
        if (!user) {
            this.showNotification('You must be logged in to add a category.', 'error');
            return;
        }
        
        const category = {
            name: document.getElementById('category-name').value.trim(),
            type: document.getElementById('category-type').value,
            icon: document.getElementById('category-icon').value.trim() || '📁',
            user_id: user.id
        }
        
        if (!category.name || !category.type) {
            this.showNotification('Please fill in all required fields', 'error')
            return
        }
        
        try {
            const { data, error } = await supabaseClient
                .from('categories')
                .insert([category])
                .select()
            
            if (error) throw error
            
            this.showNotification('Category added successfully!', 'success')
            document.getElementById('category-form').reset()
            
            // Refresh categories
            await this.loadCategories()
            
        } catch (error) {
            console.error('Error adding category:', error)
            if (error.code === '23505') { // Unique constraint violation
                this.showNotification('Category already exists!', 'error')
            } else {
                this.showNotification('Failed to add category: ' + error.message, 'error')
            }
        }
    }
    
    validateTransaction(transaction) {
        if (!transaction.type) {
            this.showNotification('Please select transaction type', 'error')
            return false
        }
        
        if (!transaction.amount || transaction.amount <= 0) {
            this.showNotification('Please enter a valid amount', 'error')
            return false
        }
        
        if (!transaction.category) {
            this.showNotification('Please select a category', 'error')
            return false
        }
        
        if (!transaction.transaction_date) {
            this.showNotification('Please select a date', 'error')
            return false
        }
        
        return true
    }
    
    populateCategoryDropdowns() {
        const categorySelect = document.getElementById('category')
        const filterCategorySelect = document.getElementById('filter-category')
        
        // Clear existing options (except first one)
        categorySelect.innerHTML = '<option value="">Select Category</option>'
        filterCategorySelect.innerHTML = '<option value="">All Categories</option>'
        
        // Get selected type for main form
        const selectedType = document.getElementById('type').value
        
        // Populate main form dropdown
        const relevantCategories = selectedType 
            ? this.categories.filter(cat => cat.type === selectedType)
            : this.categories
        
        relevantCategories.forEach(category => {
            const option = document.createElement('option')
            option.value = category.name
            option.textContent = `${category.icon} ${category.name}`
            categorySelect.appendChild(option)
        })
        
        // Populate filter dropdown with all categories
        this.categories.forEach(category => {
            const option = document.createElement('option')
            option.value = category.name
            option.textContent = `${category.icon} ${category.name}`
            filterCategorySelect.appendChild(option)
        })
    }
    
    updateCategoryOptions() {
        this.populateCategoryDropdowns()
    }
    
    displayCategories() {
        const incomeContainer = document.getElementById('income-categories')
        const expenseContainer = document.getElementById('expense-categories')
        
        incomeContainer.innerHTML = ''
        expenseContainer.innerHTML = ''
        
        this.categories.forEach(category => {
            const categoryElement = document.createElement('div')
            categoryElement.className = 'category-item'
            categoryElement.innerHTML = `
                <span class="category-icon">${category.icon}</span>
                <span class="category-name">${category.name}</span>
            `
            
            if (category.type === 'income') {
                incomeContainer.appendChild(categoryElement)
            } else {
                expenseContainer.appendChild(categoryElement)
            }
        })
    }
    
    displayTransactions() {
        const container = document.getElementById('transactions-list')
        
        if (this.transactions.length === 0) {
            container.innerHTML = '<div class="loading">No transactions found. Add your first transaction!</div>'
            return
        }
        
        container.innerHTML = this.transactions.map(transaction => {
            const category = this.categories.find(cat => cat.name === transaction.category)
            const icon = category ? category.icon : '📁'
            const date = new Date(transaction.transaction_date).toLocaleDateString('en-IN')
            const amount = this.formatCurrency(transaction.amount)
            
            return `
                <div class="transaction-item">
                    <div class="transaction-details">
                        <h4>${icon} ${transaction.category}</h4>
                        <p>Paid to: <strong>${transaction.payment_to || 'N/A'}</strong></p>
                        <p>${transaction.description || 'No description'}</p>
                        <small>${date} via ${transaction.source_details || transaction.payment_source}</small>
                    </div>
                    <div class="transaction-amount ${transaction.type}">
                        ${transaction.type === 'income' ? '+' : '-'}${amount}
                    </div>
                </div>
            `
        }).join('')
    }
    
    async filterTransactions() {
        const typeFilter = document.getElementById('filter-type').value
        const categoryFilter = document.getElementById('filter-category').value
        
        try {
            let query = supabaseClient
                .from('transactions')
                .select('*')
                .order('transaction_date', { ascending: false })
                .order('created_at', { ascending: false })
            
            if (typeFilter) {
                query = query.eq('type', typeFilter)
            }
            
            if (categoryFilter) {
                query = query.eq('category', categoryFilter)
            }
            
            const { data, error } = await query.limit(50)
            
            if (error) throw error
            
            this.transactions = data
            this.displayTransactions()
            
        } catch (error) {
            console.error('Error filtering transactions:', error)
            this.showNotification('Failed to filter transactions', 'error')
        }
    }
    
    async updateLoadMoreButton() {
        const container = document.getElementById('load-more-container')
        
        // Check if there are more transactions to load
        try {
            const { count, error } = await supabaseClient
                .from('transactions')
                .select('*', { count: 'exact', head: true })
            
            if (error) throw error
            
            if (this.transactions.length < count) {
                container.style.display = 'block'
            } else {
                container.style.display = 'none'
            }
            
        } catch (error) {
            console.error('Error checking transaction count:', error)
        }
    }
    
    async updateDashboard() {
        await this.updateStats()
        await this.updateChart()
    }
    
    async updateStats() {
        try {
            // Get summary statistics
            const { data, error } = await supabaseClient
                .from('transactions')
                .select('type, amount')
            
            if (error) throw error
            
            const totalIncome = data
                .filter(t => t.type === 'income')
                .reduce((sum, t) => sum + parseFloat(t.amount), 0)
            
            const totalExpenses = data
                .filter(t => t.type === 'expense')
                .reduce((sum, t) => sum + parseFloat(t.amount), 0)
            
            const netBalance = totalIncome - totalExpenses
            
            // Update UI
            document.getElementById('total-income').textContent = this.formatCurrency(totalIncome)
            document.getElementById('total-expenses').textContent = this.formatCurrency(totalExpenses)
            document.getElementById('net-balance').textContent = this.formatCurrency(netBalance)
            
            // Update balance card styling
            const balanceCard = document.getElementById('balance-card')
            balanceCard.className = 'stat-card balance-card'
            if (netBalance > 0) {
                balanceCard.classList.add('positive')
            } else if (netBalance < 0) {
                balanceCard.classList.add('negative')
            }
            
        } catch (error) {
            console.error('Error updating stats:', error)
        }
    }
    
    async updateChart() {
        try {
            // Get last 7 days of data
            const sevenDaysAgo = new Date()
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6)
            
            const { data, error } = await supabaseClient
                .from('transactions')
                .select('transaction_date, type, amount')
                .gte('transaction_date', sevenDaysAgo.toISOString().split('T')[0])
                .order('transaction_date')
            
            if (error) throw error
            
            // Process data for chart
            const chartData = this.processChartData(data)
            
            // Destroy existing chart
            if (this.chart) {
                this.chart.destroy()
            }
            
            // Create new chart
            const chartEl = document.getElementById('chart')
            if (!chartEl) return
            const ctx = chartEl.getContext('2d')
            this.chart = new Chart(ctx, {
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
                    plugins: {
                        title: {
                            display: false
                        },
                        legend: {
                            display: true,
                            position: 'top'
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            ticks: {
                                callback: function(value) {
                                    return '₹' + value.toLocaleString('en-IN')
                                }
                            }
                        }
                    },
                    interaction: {
                        intersect: false,
                        mode: 'index'
                    }
                }
            })
            
        } catch (error) {
            console.error('Error updating chart:', error)
        }
    }
    
    processChartData(data) {
        const today = new Date()
        const labels = []
        const income = []
        const expenses = []
        
        // Create labels for last 7 days
        for (let i = 6; i >= 0; i--) {
            const date = new Date(today)
            date.setDate(date.getDate() - i)
            labels.push(date.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' }))
            
            const dateString = date.toISOString().split('T')[0]
            
            const dayIncome = data
                .filter(t => t.type === 'income' && t.transaction_date === dateString)
                .reduce((sum, t) => sum + parseFloat(t.amount), 0)
            
            const dayExpenses = data
                .filter(t => t.type === 'expense' && t.transaction_date === dateString)
                .reduce((sum, t) => sum + parseFloat(t.amount), 0)
            
            income.push(dayIncome)
            expenses.push(dayExpenses)
        }
        
        return { labels, income, expenses }
    }
    
    formatCurrency(amount) {
        return '₹' + parseFloat(amount).toLocaleString('en-IN', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        })
    }
    
    setTodayDate() {
        const today = new Date().toISOString().split('T')[0]
        document.getElementById('date').value = today
    }
    
    resetForm() {
        document.getElementById('transaction-form').reset()
        this.setTodayDate()
        this.updateCategoryOptions()
    }
    
    showNotification(message, type = 'success') {
        const notification = document.getElementById('notification')
        const messageElement = document.getElementById('notification-message')
        
        messageElement.textContent = message
        notification.className = `notification ${type} show`
        
        // Auto-hide after 5 seconds
        setTimeout(() => {
            this.hideNotification()
        }, 5000)
    }
    
    hideNotification() {
        const notification = document.getElementById('notification')
        notification.classList.remove('show')
    }
}

// Global functions for navigation
function showPage(pageId, event) {
    // Hide all pages
    document.querySelectorAll('.page').forEach(page => {
        page.classList.remove('active')
    })
    
    // Remove active from all tabs
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.classList.remove('active')
    })
    
    // Show selected page
    document.getElementById(pageId).classList.add('active')
    
    // Add active to clicked tab
    if (event) {
        event.target.classList.add('active')
    }
    
    // Update dashboard if switching to dashboard
    if (pageId === 'dashboard' && window.expenseTracker) {
        window.expenseTracker.updateDashboard()
    }
}

function resetForm() {
    if (window.expenseTracker) {
        window.expenseTracker.resetForm()
    }
}

// Initialize the app when authenticated
document.addEventListener('DOMContentLoaded', () => {
    // Listen for login/logout events to toggle UI
    supabaseClient.auth.onAuthStateChange((event, session) => {
        const mainAppContainer = document.querySelector('.container');
        const authContainer = document.querySelector('#auth-container');

        if (session) {
            // User is signed in
            authContainer.style.display = 'none';
            mainAppContainer.style.display = 'block';

            // Initialize the app only once, after login
            if (!window.expenseTracker) {
                window.expenseTracker = new ExpenseTracker();
            }
        } else {
            // User is signed out
            authContainer.style.display = 'flex';
            mainAppContainer.style.display = 'none';
            
            // Clear the app instance on logout
            if (window.expenseTracker) {
                window.expenseTracker = null;
            }
        }
    });
});