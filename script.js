// script.js - Advanced Salary-Cycle Expense Tracker & AI Coach

// --- Authentication Functions (Unchanged) ---
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

// -----------------------------------------------------------
// ----------------------- MAIN CLASS ------------------------
// -----------------------------------------------------------

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

        // Default settings
        this.salaryAccount = 'UBI';
        
        // Track the currently viewed date range
        this.currentCycleStart = null;
        this.currentCycleEnd = null;

        this.paymentSources = {
            'upi': ['UBI', 'ICICI', 'SBI', 'Indian Bank'],
            'debit-card': ['UBI', 'ICICI', 'SBI', 'Indian Bank'],
            'credit-card': ['ICICI Platinum', 'ICICI Amazon Pay', 'ICICI Coral', 'RBL Paisabazar', 'UBI CC']
        };

        this.currentUser = null;
        this.init();
    }

    async init() {
        try {
            const { data: { user } } = await supabaseClient.auth.getUser();
            if (!user) return;
            this.currentUser = user;

            await this.loadSalaryAccountSetting();
            await this.testConnection();
            
            this.setupEventListeners();
            await this.loadCategories();
            this.setTodayDate();

            // ✅ INITIALIZE HISTORY DROPDOWN (This triggers the dashboard load)
            await this.loadCycleHistory();

        } catch (error) {
            console.error('❌ Init failed:', error);
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
            if (statusDot) statusDot.className = 'status-dot error';
            if (statusText) statusText.textContent = 'Database connection failed';
            throw error;
        }
    }

    // --- 🗓️ CYCLE HISTORY LOGIC ---

    async loadCycleHistory() {
        const selector = document.getElementById('cycle-history');
        if (!selector) return;

        // 1. Fetch ALL Salary entries, newest first
        const { data: salaries, error } = await supabaseClient
            .from('transactions')
            .select('transaction_date, amount')
            .eq('user_id', this.currentUser.id)
            .eq('type', 'income')
            .ilike('category', '%Salary%')
            .order('transaction_date', { ascending: false });

        if (error || !salaries || salaries.length === 0) {
            selector.innerHTML = '<option value="">No Salary Data Found</option>';
            // If no salary exists, fallback to current calendar month
            const d = new Date();
            d.setDate(1);
            const start = d.toISOString().split('T')[0];
            const end = new Date().toISOString().split('T')[0];
            this.loadSpecificCycle(start, end);
            return;
        }

        selector.innerHTML = ''; // Clear existing options

        // 2. Build Cycle Ranges
        // Cycle starts on Salary Date, ends the day before the NEXT Salary Date
        salaries.forEach((salary, index) => {
            const startDate = salary.transaction_date;
            let endDate;
            let label;

            if (index === 0) {
                // Latest Salary (Current Cycle)
                // End date is Today (or logic for next salary date if user wants to see future)
                endDate = new Date().toISOString().split('T')[0]; 
                const niceDate = new Date(startDate).toLocaleDateString('en-IN', {day: 'numeric', month: 'short'});
                label = `Current: Since ${niceDate}`;
            } else {
                // Past Cycles
                // The end date is the day BEFORE the salary that came after it (index - 1)
                const nextSalaryDate = new Date(salaries[index - 1].transaction_date);
                nextSalaryDate.setDate(nextSalaryDate.getDate() - 1);
                endDate = nextSalaryDate.toISOString().split('T')[0];

                const s = new Date(startDate).toLocaleDateString('en-IN', {day: 'numeric', month: 'short'});
                const e = new Date(endDate).toLocaleDateString('en-IN', {day: 'numeric', month: 'short'});
                label = `${s} - ${e}`;
            }

            // Create Option
            const option = document.createElement('option');
            option.value = `${startDate}|${endDate}`; // Store full range in value
            option.textContent = label;
            selector.appendChild(option);
        });

        // 3. Automatically select the first option (Current) and load it
        if (selector.options.length > 0) {
            selector.selectedIndex = 0;
            this.handleCycleChange(); 
        }
    }

    async handleCycleChange() {
        const selector = document.getElementById('cycle-history');
        const value = selector.value;
        if (!value || !value.includes('|')) return;

        const [startDate, endDate] = value.split('|');
        await this.loadSpecificCycle(startDate, endDate);
    }

    async loadSpecificCycle(startDate, endDate) {
        console.log(`Loading cycle: ${startDate} to ${endDate}`);
        
        // Update UI Title
        const chartTitle = document.getElementById('line-chart-title');
        const s = new Date(startDate).toLocaleDateString('en-IN', {day: 'numeric', month: 'short'});
        const e = new Date(endDate).toLocaleDateString('en-IN', {day: 'numeric', month: 'short'});
        if (chartTitle) chartTitle.innerHTML = `<span>📈 Trends: ${s} to ${e}</span>`;

        // Save current view state
        this.currentCycleStart = startDate;
        this.currentCycleEnd = endDate;

        // Reset Data Containers
        this.transactions = [];
        this.loadOffset = 0;
        const listEl = document.getElementById('transactions-list');
        if (listEl) listEl.innerHTML = '<div class="loading">Loading cycle data...</div>';

        try {
            await Promise.all([
                this.loadTransactions(startDate, endDate),
                // Pass 0 to updateStats to ensure "Remaining Budget" calculates strictly within this range
                // Net Balance = (Salary + Other Income inside range) - (Expenses inside range)
                this.updateStats(startDate, endDate, 0), 
                this.updateChart(startDate, endDate, 0),
                this.updateExpenseDonutChart(startDate, endDate)
            ]);

            // Update streak
            const streak = this.calculateNoSpendStreak(this.transactions, startDate, endDate);
            document.getElementById('current-streak').textContent = `${streak.currentStreak} Days`;
            document.getElementById('best-streak').textContent = `Best: ${streak.bestStreak} days`;

        } catch (error) {
            console.error("Error loading cycle", error);
        }
    }

    // --- ✨ AI COACH CAPABILITIES ---
    async generateAIInsights() {
        const apiKey = document.getElementById('ai-api-key').value;
        const resultDiv = document.getElementById('ai-result');
        const loadingDiv = document.getElementById('ai-loading');
        
        if (!apiKey) {
            this.showNotification('Please enter a Gemini API Key', 'error');
            return;
        }

        loadingDiv.style.display = 'block';
        resultDiv.style.display = 'none';

        // Gather Context
        const income = document.getElementById('total-income').textContent;
        const expense = document.getElementById('total-expenses').textContent;
        const balance = document.getElementById('net-balance').textContent;
        const streak = document.getElementById('current-streak').textContent;
        
        // Contextual Transaction List (Top 15 expenses)
        const expenseList = this.transactions
            .filter(t => t.type === 'expense')
            .slice(0, 15)
            .map(t => `- ${t.transaction_date}: ${t.category} ₹${t.amount} (${t.description || ''})`)
            .join('\n');

        const prompt = `
            Act as a smart, strict financial coach.
            Current Cycle Status:
            - Income: ${income}
            - Spent: ${expense}
            - Remaining: ${balance}
            - No-Spend Streak: ${streak}
            
            Recent Expenses:
            ${expenseList}

            Task:
            1. Roast my spending habits in 1 sentence. 🌶️
            2. Identify one category I am overspending on.
            3. Give me 3 specific, actionable tips to save money before my next salary.
            4. Rate my financial health (1-10).
            
            Use emojis. Use HTML tags like <b> for bolding.
        `;

        try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
            });

            const data = await response.json();
            
            if (data.error) throw new Error(data.error.message);
            
            const aiText = data.candidates[0].content.parts[0].text;
            
            resultDiv.style.display = 'block';
            resultDiv.innerHTML = aiText; // Render Markdown/HTML from AI

        } catch (error) {
            console.error(error);
            this.showNotification('AI Analysis failed. Check Key.', 'error');
        } finally {
            loadingDiv.style.display = 'none';
        }
    }

    // --- CORE DATA FUNCTIONS ---

    calculateNoSpendStreak(transactions, startDate, endDate) {
        const days = {};
        const start = new Date(startDate);
        const end = new Date(); // Calculate streak up to TODAY

        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            days[d.toISOString().split('T')[0]] = true;
        }

        transactions.forEach(t => {
            if (t.type === 'expense') {
                days[t.transaction_date] = false;
            }
        });

        let currentStreak = 0;
        let bestStreak = 0;
        const todayStr = new Date().toISOString().split('T')[0];

        // Iterate backwards from today
        let tempDate = new Date();
        while (true) {
            const dateStr = tempDate.toISOString().split('T')[0];
            if (new Date(dateStr) < start) break;
            
            if (days[dateStr]) {
                currentStreak++;
            } else if (dateStr !== todayStr) {
                // Break if missed a day (unless it's today and we haven't spent YET)
                break;
            } else if (dateStr === todayStr && !days[dateStr]) {
                currentStreak = 0;
                break;
            }
            tempDate.setDate(tempDate.getDate() - 1);
        }
        
        // Calc best streak
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

            const filterType = document.getElementById('filter-type')?.value || '';
            const filterCategory = document.getElementById('filter-category')?.value || '';
            if (filterType) query = query.eq('type', filterType);
            if (filterCategory) query = query.eq('category', filterCategory);

            const { data, error } = await query;
            if (error) throw error;

            if (data?.length) {
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
        if(this.currentCycleStart && this.currentCycleEnd) {
            await this.loadTransactions(this.currentCycleStart, this.currentCycleEnd, true);
        }
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

            const filterType = document.getElementById('filter-type')?.value || '';
            if (filterType) query = query.eq('type', filterType);
            
            const { count, error } = await query;
            if (error) throw error;
            container.style.display = (this.transactions.length < (count || 0)) ? 'block' : 'none';
        } catch (error) {
            container.style.display = 'none';
        }
    }

    setupEventListeners() {
        // Forms
        document.getElementById('transaction-form')?.addEventListener('submit', (e) => this.handleTransactionSubmit(e));
        document.getElementById('category-form')?.addEventListener('submit', (e) => this.handleCategorySubmit(e));
        document.getElementById('salary-settings-form')?.addEventListener('submit', (e) => this.saveSalaryAccountSetting(e));

        // Field changes
        document.getElementById('type')?.addEventListener('change', () => {
            this.updateCategoryOptions();
            this.updateFormForSalary();
        });
        document.getElementById('category')?.addEventListener('change', () => this.updateFormForSalary());
        document.getElementById('payment-source')?.addEventListener('change', () => this.updateSourceDetailsOptions());

        // Filters & Views
        document.getElementById('filter-type')?.addEventListener('change', () => this.filterTransactions());
        document.getElementById('filter-category')?.addEventListener('change', () => this.filterTransactions());
        
        // ✅ HISTORY DROPDOWN LISTENER
        document.getElementById('cycle-history')?.addEventListener('change', () => this.handleCycleChange());

        // Buttons
        document.getElementById('load-more-btn')?.addEventListener('click', () => this.loadMoreTransactions());
        document.getElementById('notification-close')?.addEventListener('click', () => this.hideNotification());
        document.getElementById('reset-chart-view-btn')?.addEventListener('click', () => this.renderChartBySource());
        document.getElementById('clear-form-btn')?.addEventListener('click', () => this.resetForm());
        document.getElementById('logout-btn')?.addEventListener('click', handleLogout);
        
        // ✅ AI BUTTON
        document.getElementById('generate-ai-btn')?.addEventListener('click', () => this.generateAIInsights());

        // Page Navigation
        document.querySelectorAll('.nav-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                const pageId = e.currentTarget.dataset.page;
                this.showPage(pageId, e);
            });
        });

        // AI Coach Local Button
        document.getElementById('generate-local-ai-btn')?.addEventListener('click', () => this.runLocalCoach());
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
            this.resetForm();

            // ✅ AUTO-UPDATE LOGIC
            const isSalary = transaction.type === 'income' && 
                             transaction.category.toLowerCase().includes('salary');

            if (isSalary) {
                this.showNotification('🎉 New Salary Detected! Updating cycles...', 'success');
                // Reload history to include the new salary cycle
                await this.loadCycleHistory();
            } else {
                // Refresh current view
                if (this.currentCycleStart && this.currentCycleEnd) {
                    await this.loadSpecificCycle(this.currentCycleStart, this.currentCycleEnd);
                }
            }
        } catch (error) {
            console.error('Error adding transaction:', error);
            this.showNotification(`Failed: ${error.message}`, 'error');
        }
    }

    async handleCategorySubmit(e) {
        e.preventDefault();
        const category = {
            name: document.getElementById('category-name').value.trim(),
            type: document.getElementById('category-type').value,
            icon: document.getElementById('category-icon').value.trim() || '📁',
            user_id: this.currentUser.id
        };

        if (!category.name || !category.type) return;

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

        const isSalary = typeSelect?.value === 'income' &&
                         (categorySelect?.value || '').trim().toLowerCase().includes('salary');

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
            // Restore default options
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
        const paymentSource = document.getElementById('payment-source')?.value;
        const sourceDetailsSelect = document.getElementById('source-details');
        if (!sourceDetailsSelect) return;

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

        const currentCategoryVal = categorySelect?.value || '';
        const currentFilterVal = filterCategorySelect?.value || '';

        if (categorySelect) categorySelect.innerHTML = '<option value="">Select Category</option>';
        if (filterCategorySelect) filterCategorySelect.innerHTML = '<option value="">All Categories</option>';

        const selectedType = document.getElementById('type')?.value;
        const filtered = selectedType ? this.categories.filter(cat => cat.type === selectedType) : [];

        filtered.forEach(category => {
            const option = document.createElement('option');
            option.value = category.name;
            option.textContent = `${category.icon} ${category.name}`;
            categorySelect?.appendChild(option);
        });

        this.categories.forEach(category => {
            const option = document.createElement('option');
            option.value = category.name;
            option.textContent = `${category.icon} ${category.name}`;
            filterCategorySelect?.appendChild(option);
        });

        if (categorySelect) categorySelect.value = currentCategoryVal;
        if (filterCategorySelect) filterCategorySelect.value = currentFilterVal;
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
            if (category.type === 'income') incomeContainer.appendChild(categoryDiv);
            else expenseContainer.appendChild(categoryDiv);
        });
    }
    // --- NORMALIZATION & BUCKETING ---

    normalizeCategory(rawCategory, merchant, description) {
        const c = (rawCategory || '').toLowerCase().trim();
        const m = (merchant || '').toLowerCase().trim();
        const d = (description || '').toLowerCase().trim();
        const text = `${c} ${m} ${d}`;

        // 1) Very specific merchants first
        if (/zomato|swiggy|blinkit|dominos|pizza hut|kfc|ubereats/.test(text)) {
            return 'Food Delivery';
        }
        if (/amazon|flipkart|myntra|ajio|meesho/.test(text)) {
            return 'Online Shopping';
        }
        if (/ola|uber|rapido/.test(text)) {
            return 'Cabs / Ride-hailing';
        }
        if (/netflix|prime video|hotstar|spotify|youtube premium|zee5/.test(text)) {
            return 'Subscriptions';
        }
        if (/lic|insurance|health insurance/.test(text)) {
            return 'Insurance';
        }
        if (/sip|mf|mutual fund|nifty|sensex|index fund|etf/.test(text)) {
            return 'Investments';
        }
        if (/fd|rd|fixed deposit|recurring deposit/.test(text)) {
            return 'Savings';
        }
        if (/rent|landlord|house rent/.test(text)) {
            return 'Rent';
        }
        if (/electricity|power bill|current bill|bescom|apspdcl|apepdcl|water bill|gas bill|lpg/.test(text)) {
            return 'Utilities';
        }
        if (/grocery|groceries|mart|d mart|d-mart|more|big bazaar|reliance fresh|supermarket/.test(text)) {
            return 'Groceries';
        }
        if (/petrol|diesel|fuel|hpcl|bpcl|ioc/.test(text)) {
            return 'Fuel';
        }
        if (/hospital|clinic|pharmacy|medical|chemist|lab test|diagnostic/.test(text)) {
            return 'Health / Medical';
        }

        // 2) Fallback to existing category text
        if (c) {
            // Title-case the category
            return c.split(' ')
                    .filter(Boolean)
                    .map(s => s[0].toUpperCase() + s.slice(1))
                    .join(' ');
        }

        // 3) Total fallback
        return 'Uncategorized';
    }

    getSpendingBucket(normalizedCategory) {
        const cat = normalizedCategory.toLowerCase();

        // NEEDS
        const needs = [
            'rent', 'utilities', 'groceries', 'fuel',
            'health / medical', 'insurance', 'emi', 'loan emi',
            'fees', 'school fees', 'college fees', 'bills'
        ];

        // WANTS
        const wants = [
            'food delivery', 'online shopping', 'cabs / ride-hailing',
            'subscriptions', 'entertainment', 'movies',
            'eating out', 'restaurants', 'travel', 'vacation', 'shopping'
        ];

        // SAVINGS / INVESTMENTS
        const savings = [
            'savings', 'investments', 'fd', 'rd',
            'mutual funds', 'sip', 'ppf', 'nps'
        ];

        if (needs.some(k => cat.includes(k))) return 'need';
        if (wants.some(k => cat.includes(k))) return 'want';
        if (savings.some(k => cat.includes(k))) return 'saving';

        // Default: 50% need, 50% want – handled in analysis
        return 'mixed';
    }

        async buildSpendingInsights(monthsBack = 6) {
        if (!this.currentUser) {
            this.showNotification('Login required for insights', 'error');
            return null;
        }

        // 1) Load last few months from Supabase
        const today = new Date();
        const endDate = today.toISOString().split('T')[0];
        const start = new Date();
        start.setMonth(start.getMonth() - monthsBack);
        const startDate = start.toISOString().split('T')[0];

        const { data: allTx, error } = await supabaseClient
            .from('transactions')
            .select('*')
            .eq('user_id', this.currentUser.id)
            .gte('transaction_date', startDate)
            .lte('transaction_date', endDate);

        if (error) {
            console.error('History load error:', error);
            this.showNotification('Failed to load history for insights', 'error');
            return null;
        }

        const txs = allTx || [];
        if (!txs.length) return null;

        let totalIncome = 0;
        let totalExpense = 0;

        const byCategory = {};
        const byMerchant = {};
        const byWeekday = { 0:0, 1:0, 2:0, 3:0, 4:0, 5:0, 6:0 };
        let needSpend = 0, wantSpend = 0, savingSpend = 0, mixedSpend = 0;

        txs.forEach(t => {
            const amount = Number(t.amount) || 0;
            if (!amount) return;

            if (t.type === 'income') {
                totalIncome += amount;
                return;
            }

            // Only expense path from here
            totalExpense += amount;

            const merchant = t.payment_to || '';
            const desc = t.description || '';

            const normCat = this.normalizeCategory(t.category, merchant, desc);
            const bucket = this.getSpendingBucket(normCat);

            // category totals
            if (!byCategory[normCat]) byCategory[normCat] = 0;
            byCategory[normCat] += amount;

            // merchant totals
            const mKey = merchant || 'Unknown';
            if (!byMerchant[mKey]) byMerchant[mKey] = 0;
            byMerchant[mKey] += amount;

            // weekday totals
            const d = new Date(t.transaction_date + 'T00:00:00');
            const dow = d.getDay();
            byWeekday[dow] += amount;

            // bucket totals
            if (bucket === 'need') needSpend += amount;
            else if (bucket === 'want') wantSpend += amount;
            else if (bucket === 'saving') savingSpend += amount;
            else mixedSpend += amount;
        });

        // Treat mixed as 50/50
        needSpend += mixedSpend * 0.5;
        wantSpend += mixedSpend * 0.5;

        const savings = totalIncome - totalExpense;
        const savingsRate = totalIncome > 0 ? savings / totalIncome : 0;
        const wantShare = totalExpense > 0 ? wantSpend / totalExpense : 0;

        // Top categories & merchants
        const topCategories = Object.entries(byCategory)
            .sort((a,b) => b[1] - a[1])
            .slice(0, 5);

        const topMerchants = Object.entries(byMerchant)
            .sort((a,b) => b[1] - a[1])
            .slice(0, 5);

        const dowNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
        const peakDow = Object.entries(byWeekday).sort((a,b) => b[1]-a[1])[0]; // [dow, amt]

        // ----- Build suggestions -----
        const suggestions = [];
        const targetSavingsRate = 0.20; // 20% recommended

        // 1) Savings rate
        if (totalIncome > 0) {
            if (savingsRate < targetSavingsRate) {
                const target = totalIncome * targetSavingsRate;
                const extraToSave = target - savings;
                suggestions.push({
                    severity: 'high',
                    message: `You are saving <b>${(savingsRate*100).toFixed(1)}%</b> of your income. ` +
                             `Aim for at least <b>${(targetSavingsRate*100)}%</b> (≈ <b>${this.formatCurrency(target)}</b>), ` +
                             `which means cutting ≈ <b>${this.formatCurrency(extraToSave)}</b> from monthly expenses.`
                });
            } else {
                suggestions.push({
                    severity: 'low',
                    message: `Your savings rate is about <b>${(savingsRate*100).toFixed(1)}%</b>. ` +
                             `Good job! Try to slowly push this towards <b>25–30%</b>.`
                });
            }
        }

        // 2) Wants vs Needs
        if (totalExpense > 0) {
            const wantPct = (wantShare * 100).toFixed(1);
            const idealWantShare = 0.25; // 25% of expenses as wants
            if (wantShare > idealWantShare) {
                const maxWants = totalExpense * idealWantShare;
                const overshoot = wantSpend - maxWants;
                suggestions.push({
                    severity: 'high',
                    message: `About <b>${wantPct}%</b> of your spending is on <b>wants / nice-to-have</b> items. ` +
                             `If you capped wants at <b>25%</b>, you could have saved ≈ <b>${this.formatCurrency(overshoot)}</b> over this period.`
                });
            } else {
                suggestions.push({
                    severity: 'medium',
                    message: `Your wants are about <b>${wantPct}%</b> of total spending. ` +
                             `That’s reasonably controlled — just watch out for month-end impulse purchases.`
                });
            }
        }

        // 3) Leak categories (foolish spend)
        topCategories.forEach(([cat, amt]) => {
            const share = totalExpense > 0 ? amt / totalExpense : 0;
            if (share > 0.15) { // >15% of expenses
                suggestions.push({
                    severity: 'medium',
                    message: `Category <b>${cat}</b> alone is ≈ <b>${(share*100).toFixed(1)}%</b> of your spending ` +
                             `(<b>${this.formatCurrency(amt)}</b>). ` +
                             `Try a strict monthly limit and cut this by <b>15–20%</b>.`
                });
            }
        });

        // 4) Leak merchants (Zomato / Swiggy / Amazon etc.)
        topMerchants.forEach(([m, amt]) => {
            if (amt > totalExpense * 0.10 && amt > 1000) {
                suggestions.push({
                    severity: 'medium',
                    message: `You spent about <b>${this.formatCurrency(amt)}</b> at <b>${m}</b>. ` +
                             `This looks like a leak — reduce frequency or set a weekly cap for this merchant.`
                });
            }
        });

        // 5) Peak day of week (when you throw money)
        if (peakDow && peakDow[1] > 0) {
            const [dow, amt] = peakDow;
            const share = totalExpense > 0 ? (amt / totalExpense) * 100 : 0;
            suggestions.push({
                severity: 'low',
                message: `<b>${dowNames[dow]}</b> is your highest-spending day ` +
                         `(<b>${this.formatCurrency(amt)}</b>, ≈ <b>${share.toFixed(1)}%</b> of your expenses). ` +
                         `Declare it a <b>“no impulse purchase”</b> day or set a fixed envelope for that day.`
            });
        }

        return {
            period: { startDate, endDate },
            totals: {
                totalIncome, totalExpense, savings, savingsRate
            },
            breakdown: {
                needSpend, wantSpend, savingSpend,
                topCategories, topMerchants
            },
            suggestions
        };
    }

        async runLocalCoach() {
        const loadingEl = document.getElementById('local-ai-loading');
        const resultEl = document.getElementById('local-ai-result');

        if (loadingEl) loadingEl.style.display = 'block';
        if (resultEl) {
            resultEl.style.display = 'none';
            resultEl.innerHTML = '';
        }

        const insights = await this.buildSpendingInsights(6); // last 6 months

        if (loadingEl) loadingEl.style.display = 'none';

        if (!resultEl) return;

        if (!insights) {
            resultEl.style.display = 'block';
            resultEl.innerHTML = `<p>No enough data found to analyze. Try adding more transactions.</p>`;
            return;
        }

        const { totals, breakdown, suggestions, period } = insights;
        const sr = (totals.savingsRate * 100).toFixed(1);
        const needPct = totals.totalExpense > 0 ? (breakdown.needSpend / totals.totalExpense * 100).toFixed(1) : '0.0';
        const wantPct = totals.totalExpense > 0 ? (breakdown.wantSpend / totals.totalExpense * 100).toFixed(1) : '0.0';

        const periodStr = `${new Date(period.startDate).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' })} 
                           → 
                           ${new Date(period.endDate).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' })}`;

        const summaryHtml = `
            <h3>📅 Period Analyzed</h3>
            <p><b>${periodStr}</b></p>

            <h3>📌 Overall Summary</h3>
            <ul>
                <li>Total Income: <b>${this.formatCurrency(totals.totalIncome)}</b></li>
                <li>Total Spent: <b>${this.formatCurrency(totals.totalExpense)}</b></li>
                <li>Savings: <b>${this.formatCurrency(totals.savings)}</b> (${sr}% of income)</li>
                <li>Needs vs Wants (by spend): <b>${needPct}% needs</b> / <b>${wantPct}% wants</b></li>
            </ul>

            <h3>🔥 Top Spending Categories</h3>
            <ul>
                ${breakdown.topCategories.map(([cat, amt]) => `
                    <li>${cat}: <b>${this.formatCurrency(amt)}</b></li>
                `).join('')}
            </ul>

            <h3>🧠 Coach Suggestions</h3>
        `;

        const suggestionHtml = suggestions.length
            ? `<ul class="insights-list">
                    ${suggestions.map(s => `
                        <li class="insight-item insight-${s.severity}">
                            ${s.message}
                        </li>
                    `).join('')}
               </ul>`
            : `<p>You’re actually doing quite well. Keep it up! ✅</p>`;

        resultEl.innerHTML = summaryHtml + suggestionHtml;
        resultEl.style.display = 'block';
    }


    displayTransactions() {
        const transactionsList = document.getElementById('transactions-list');
        if (!transactionsList) return;

        if (this.transactions.length === 0) {
            transactionsList.innerHTML = '<div class="loading">No transactions found in this cycle.</div>';
            return;
        }

        const html = this.transactions.map(t => {
            const category = this.categories.find(cat => cat.name === t.category);
            const categoryIcon = category ? category.icon : '📁';
            const date = new Date(t.transaction_date + 'T00:00:00').toLocaleDateString('en-IN', {
                day: '2-digit', month: 'short'
            });
            const amount = this.formatCurrency(t.amount);
            return `
                <div class="transaction-item">
                    <div class="transaction-details">
                        <h4>${categoryIcon} ${t.category}</h4>
                        <p>Paid to: <strong>${t.payment_to || 'N/A'}</strong></p>
                        <p>${t.description || ''}</p>
                        <small>${date} • ${t.source_details || t.payment_source}</small>
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
        if(this.currentCycleStart && this.currentCycleEnd) {
            await this.loadTransactions(this.currentCycleStart, this.currentCycleEnd, false);
        }
    }

    async updateStats(startDate, endDate, prevMonthSalary = 0) {
        try {
            const { data, error } = await supabaseClient.rpc('get_monthly_stats', {
                user_id_input: this.currentUser.id,
                start_date: startDate,
                end_date: endDate
            });
            if (error) throw error;

            const stats = data?.[0] || { total_income: 0, total_expenses: 0, net_balance: 0 };

            const finalIncome = Number(stats.total_income) + Number(prevMonthSalary);
            const finalBalance = Number(stats.net_balance) + Number(prevMonthSalary);

            document.getElementById('total-income').textContent = this.formatCurrency(finalIncome);
            document.getElementById('total-expenses').textContent = this.formatCurrency(stats.total_expenses);
            document.getElementById('net-balance').textContent = this.formatCurrency(finalBalance);

            const balanceCard = document.getElementById('balance-card');
            if (balanceCard) {
                balanceCard.className = 'stat-card balance-card';
                if (finalBalance > 0) balanceCard.classList.add('positive');
                else if (finalBalance < 0) balanceCard.classList.add('negative');
            }
        } catch (error) {
            console.error('Error updating stats:', error);
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
            const expensesMA = this.calculateMovingAverage(chartData.expenses, 5); 

            if (this.chart) this.chart.destroy();
            const canvas = document.getElementById('chart');
            if (!canvas) return;

            this.chart = new Chart(canvas.getContext('2d'), {
                type: 'line',
                data: {
                    labels: chartData.labels,
                    datasets: [
                        {
                            label: 'Expenses',
                            data: chartData.expenses,
                            borderColor: '#ef4444',
                            backgroundColor: 'rgba(239, 68, 68, 0.1)',
                            fill: true,
                            tension: 0.4
                        },
                        {
                            label: 'Trend',
                            data: expensesMA,
                            borderColor: '#3b82f6',
                            borderWidth: 1,
                            pointRadius: 0
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: { beginAtZero: true, ticks: { callback: (v) => '₹' + v } }
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
        const end = new Date(); // Chart up to today

        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const dateStr = d.toISOString().split('T')[0];
            const label = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
            labels.push(label);
            dailyData[dateStr] = { income: 0, expenses: 0 };
        }

        (transactions || []).forEach(t => {
            const dateStr = t.transaction_date;
            if (dailyData[dateStr]) {
                if (t.type === 'income') dailyData[dateStr].income += Number(t.amount);
                else dailyData[dateStr].expenses += Number(t.amount);
            }
        });

        Object.keys(dailyData).forEach(dateStr => {
            income.push(dailyData[dateStr].income);
            expenses.push(dailyData[dateStr].expenses);
        });

        return { labels, income, expenses };
    }

    calculateMovingAverage(data, windowSize = 5) {
        const result = [];
        for (let i = 0; i < data.length; i++) {
            const start = Math.max(0, i - windowSize + 1);
            const subset = data.slice(start, i + 1);
            const avg = subset.reduce((a, b) => a + b, 0) / subset.length;
            result.push(Number(avg.toFixed(2)));
        }
        return result;
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

        this.renderDonutChart(Object.keys(sourceData), Object.values(sourceData), 'Expenses by Source');
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

        this.renderDonutChart(Object.keys(categoryData), Object.values(categoryData), `Expenses via ${source}`);
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
                    data,
                    backgroundColor: ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#3b82f6', '#8b5cf6'],
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: 'bottom' } },
                onClick: (evt, elements) => {
                    if (elements.length > 0 && this.currentChartView === 'source') {
                        const index = elements[0].index;
                        this.renderChartByCategory(labels[index]);
                    }
                }
            }
        });
    }

    formatCurrency(amount) {
        return '₹' + Number(amount).toLocaleString('en-IN', {
            minimumFractionDigits: 2, maximumFractionDigits: 2
        });
    }

    setTodayDate() {
        const el = document.getElementById('date');
        if (el) el.value = new Date().toISOString().split('T')[0];
    }

    resetForm() {
        document.getElementById('transaction-form')?.reset();
        this.setTodayDate();
        this.updateCategoryOptions();
        this.updateFormForSalary();
    }

    showPage(pageId, event) {
        document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
        document.querySelectorAll('.nav-tab').forEach(tab => tab.classList.remove('active'));
        document.getElementById(pageId)?.classList.add('active');
        if (event) event.currentTarget.classList.add('active');
    }

    showNotification(message, type = 'success') {
        const notification = document.getElementById('notification');
        const messageEl = document.getElementById('notification-message');
        if (messageEl && notification) {
            messageEl.textContent = String(message).replace('Error: ', '');
            notification.className = `notification ${type} show`;
        }
        if (this.notificationTimer) clearTimeout(this.notificationTimer);
        this.notificationTimer = setTimeout(() => this.hideNotification(), 5000);
    }

    hideNotification() {
        document.getElementById('notification')?.classList.remove('show');
    }

    async loadSalaryAccountSetting() {
        try {
            const { data, error } = await supabaseClient
                .from('user_settings')
                .select('salary_account')
                .eq('user_id', this.currentUser?.id || '')
                .single();
            if (!error && data?.salary_account) this.salaryAccount = data.salary_account;
            
            const select = document.getElementById('salary-default-account');
            if(select) select.value = this.salaryAccount;
        } catch { }
    }

    async saveSalaryAccountSetting(e) {
        e.preventDefault();
        const select = document.getElementById('salary-default-account');
        if (!select) return;
        const newAccount = select.value;
        try {
            const { error } = await supabaseClient.from('user_settings')
                .upsert({ user_id: this.currentUser.id, salary_account: newAccount });
            if (error) throw error;
            this.salaryAccount = newAccount;
            this.showNotification(`Default salary account set to ${newAccount}`, 'success');
        } catch (err) {
            this.showNotification('Could not save setting', 'error');
        }
    }
}

// --------------- Global Initialization ---------------
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('login-form')?.addEventListener('submit', handleLogin);
    document.getElementById('signup-form')?.addEventListener('submit', handleSignup);
    document.getElementById('reset-form')?.addEventListener('submit', handleReset);
    document.getElementById('login-tab-btn')?.addEventListener('click', () => showAuthTab('login'));
    document.getElementById('signup-tab-btn')?.addEventListener('click', () => showAuthTab('signup'));
    document.getElementById('forgot-password-link')?.addEventListener('click', (e) => {
        e.preventDefault();
        showAuthTab('reset');
    });
    document.getElementById('back-to-login-btn')?.addEventListener('click', () => showAuthTab('login'));

    supabaseClient.auth.onAuthStateChange((event, session) => {
        const mainAppContainer = document.querySelector('.container');
        const authContainer = document.querySelector('#auth-container');

        if (session) {
            if (authContainer) authContainer.style.display = 'none';
            if (mainAppContainer) mainAppContainer.style.display = 'block';

            if (!window.expenseTracker) {
                window.expenseTracker = new ExpenseTracker();
            }
        } else {
            if (authContainer) authContainer.style.display = 'flex';
            if (mainAppContainer) mainAppContainer.style.display = 'none';
            if (window.expenseTracker) {
                if (window.expenseTracker.chart) window.expenseTracker.chart.destroy();
                if (window.expenseTracker.expenseDonutChart) window.expenseTracker.expenseDonutChart.destroy();
                window.expenseTracker = null;
            }
        }
    });
});