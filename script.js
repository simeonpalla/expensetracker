// script.js - Advanced Salary-Cycle Expense Tracker & Local AI Coach

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
        this.notificationTimer = null;
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

            // Initialize Salary-cycle history dropdown (this will trigger dashboard load)
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
            if (statusDot) statusDot.className = 'status-dot connected';
            if (statusText) statusText.textContent = 'Connected to database';
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

        const { data: salaries, error } = await supabaseClient
            .from('transactions')
            .select('transaction_date, amount')
            .eq('user_id', this.currentUser.id)
            .eq('type', 'income')
            .ilike('category', '%Salary%')
            .order('transaction_date', { ascending: false });

        if (error || !salaries || salaries.length === 0) {
            selector.innerHTML = '<option value="">No Salary Data Found</option>';
            const d = new Date();
            d.setDate(1);
            const start = d.toISOString().split('T')[0];
            const end = new Date().toISOString().split('T')[0];
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

    async handleCycleChange() {
        const selector = document.getElementById('cycle-history');
        const value = selector.value;
        if (!value || !value.includes('|')) return;

        const [startDate, endDate] = value.split('|');
        await this.loadSpecificCycle(startDate, endDate);
    }

    async loadSpecificCycle(startDate, endDate) {
        console.log(`Loading cycle: ${startDate} to ${endDate}`);
        
        const chartTitle = document.getElementById('line-chart-title');
        const s = new Date(startDate).toLocaleDateString('en-IN', {day: 'numeric', month: 'short'});
        const e = new Date(endDate).toLocaleDateString('en-IN', {day: 'numeric', month: 'short'});
        if (chartTitle) chartTitle.innerHTML = `<span>📈 Trends: ${s} to ${e}</span>`;

        this.currentCycleStart = startDate;
        this.currentCycleEnd = endDate;

        this.transactions = [];
        this.loadOffset = 0;
        const listEl = document.getElementById('transactions-list');
        if (listEl) listEl.innerHTML = '<div class="loading">Loading cycle data...</div>';

        try {
            await Promise.all([
                this.loadTransactions(startDate, endDate),
                this.updateStats(startDate, endDate, 0),
                this.updateChart(startDate, endDate, 0),
                this.updateExpenseDonutChart(startDate, endDate)
            ]);

            const streak = this.calculateNoSpendStreak(this.transactions, startDate, endDate);
            document.getElementById('current-streak').textContent = `${streak.currentStreak} Days`;
            document.getElementById('best-streak').textContent = `Best: ${streak.bestStreak} days`;

        } catch (error) {
            console.error("Error loading cycle", error);
        }
    }

    // --- 📊 LOCAL AI COACH (NO EXTERNAL API) ---
    async generateLocalAIInsights() {
        const loading = document.getElementById('local-ai-loading');
        const result = document.getElementById('local-ai-result');
        if (!loading || !result) return;

        loading.style.display = 'block';
        result.style.display = 'none';
        result.innerHTML = '';

        try {
            // Analyse last 6 calendar months from today
            const today = new Date();
            const sixMonthsAgo = new Date();
            sixMonthsAgo.setMonth(today.getMonth() - 6);

            const startDate = sixMonthsAgo.toISOString().split('T')[0];
            const endDate = today.toISOString().split('T')[0];

            const { data, error } = await supabaseClient
                .from('transactions')
                .select('*')
                .eq('user_id', this.currentUser.id)
                .gte('transaction_date', startDate)
                .lte('transaction_date', endDate)
                .order('transaction_date', { ascending: true });

            if (error) throw error;

            if (!data || data.length < 5) {
                result.innerHTML = `
                    <p>
                        I only found <b>${data ? data.length : 0}</b> transactions between 
                        <b>${this.prettyDate(startDate)}</b> and <b>${this.prettyDate(endDate)}</b>.
                        That’s too little to say anything serious. Track a few more weeks and try again.
                    </p>
                `;
                result.style.display = 'block';
                return;
            }

            const txs = data;

            let totalIncome = 0;
            let totalExpenses = 0;

            const byCategory = {};
            const byBroadBucket = { essentials: 0, lifestyle: 0, financial: 0, other: 0 };
            const byMonth = {};
            const byWeekday = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
            const byHour = {};
            const merchantSpend = {};

            txs.forEach(t => {
                const amount = Number(t.amount) || 0;
                const isIncome = t.type === 'income';

                const dateStr = t.transaction_date;
                const d = new Date(dateStr + 'T00:00:00');
                const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                const weekday = d.getDay();

                if (!byMonth[monthKey]) byMonth[monthKey] = { income: 0, expense: 0 };

                if (isIncome) {
                    totalIncome += amount;
                    byMonth[monthKey].income += amount;
                } else {
                    totalExpenses += amount;
                    byMonth[monthKey].expense += amount;

                    byWeekday[weekday] += amount;

                    if (t.created_at) {
                        const h = new Date(t.created_at).getHours();
                        byHour[h] = (byHour[h] || 0) + amount;
                    }

                    const catRaw = (t.category || '').toLowerCase();
                    const payToRaw = (t.payment_to || '').toLowerCase();
                    const normCat = this.normalizeCategory(catRaw, payToRaw);

                    byCategory[normCat] = (byCategory[normCat] || 0) + amount;

                    const broad = this.mapToBroadBucket(normCat);
                    byBroadBucket[broad] += amount;

                    if (t.payment_to) {
                        merchantSpend[t.payment_to] = (merchantSpend[t.payment_to] || 0) + amount;
                    }
                }
            });

            const monthKeys = Object.keys(byMonth);
            const monthsWithData = monthKeys.length || 1;

            const expensePerMonth = totalExpenses / monthsWithData;

            const trackerBalance = totalIncome - totalExpenses;  // NOT true savings
            const overspend = trackerBalance < 0 ? -trackerBalance : 0;

            const topCats = Object.entries(byCategory)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5);

            const topMerchants = Object.entries(merchantSpend)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5);

            const lifestyleSpend = byBroadBucket.lifestyle;
            const potentialCut10 = lifestyleSpend * 0.10;
            const potentialCut20 = lifestyleSpend * 0.20;

            const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            const [worstDayIndex] = Object.entries(byWeekday).sort((a, b) => b[1] - a[1])[0];
            const worstDayName = weekdayNames[Number(worstDayIndex)];

            let peakHour = null, peakHourAmount = 0;
            Object.entries(byHour).forEach(([h, amt]) => {
                if (amt > peakHourAmount) {
                    peakHourAmount = amt;
                    peakHour = Number(h);
                }
            });

            const healthScore = this.computeHealthScore({
                totalIncome,
                totalExpenses,
                byBroadBucket,
                monthsWithData
            });

            const lifestyleShare = totalExpenses > 0 ? (lifestyleSpend / totalExpenses) : 0;
            let roast;
            if (lifestyleShare > 0.6) {
                roast = `🔥 You’re treating your salary like a limited-time festival offer—most of it vanishes on lifestyle swipes before “savings” even enters the chat.`;
            } else if (lifestyleShare > 0.4) {
                roast = `😏 You’re not reckless, but a big slice of your money is still going to “nice-to-have” instead of “need-to-have”.`;
            } else {
                roast = `🧘‍♂️ You’re relatively disciplined; focus now is optimisation, not damage control.`;
            }

            let html = '';

            html += `<p><b>One-line reality check:</b> ${roast}</p>`;

            html += `<h3>📅 Period Analysed</h3>`;
            html += `<p>From <b>${this.prettyDate(startDate)}</b> to <b>${this.prettyDate(endDate)}</b> (${monthsWithData} month(s) with data)</p>`;

            html += `<h3>💼 High-Level Snapshot</h3>`;
            html += `<ul>`;
            html += `<li>Total income <b>tracked in the app</b>: <b>${this.humanMoney(totalIncome)}</b></li>`;
            html += `<li>Total spending <b>tracked in the app</b>: <b>${this.humanMoney(totalExpenses)}</b></li>`;
            html += `<li>Unallocated amount (income − tracked expenses): <b>${this.humanMoney(trackerBalance)}</b><br>
                     <small>⚠ This is <b>not guaranteed savings</b>. It just means this money is not recorded as an expense here — it could be actual savings, cash withdrawals you didn’t log, transfers, etc.</small></li>`;
            if (overspend > 0) {
                html += `<li>You spent <b>${this.humanMoney(overspend)}</b> more than you earned (as per tracked data).</li>`;
            }
            html += `<li>Avg monthly spending (over months with data): <b>${this.humanMoney(expensePerMonth)}</b></li>`;
            html += `</ul>`;

            html += `<h3>🎯 Where Your Money Actually Goes</h3>`;
            html += `<p>Broad breakup of your <b>expenses</b>:</p>`;
            html += `<ul>`;
            html += `<li>Essentials (rent, groceries, bills, fuel, basic transport…): <b>${this.humanMoney(byBroadBucket.essentials)}</b></li>`;
            html += `<li>Lifestyle / discretionary (eating out, online shopping, entertainment, trips…): <b>${this.humanMoney(byBroadBucket.lifestyle)}</b></li>`;
            html += `<li>Financial (EMIs, insurance, investments): <b>${this.humanMoney(byBroadBucket.financial)}</b></li>`;
            html += `<li>Unclear / other: <b>${this.humanMoney(byBroadBucket.other)}</b></li>`;
            html += `</ul>`;

            if (topCats.length) {
                html += `<p>Top categories by spend:</p><ol>`;
                topCats.forEach(([name, amt]) => {
                    html += `<li><b>${name}</b>: ${this.humanMoney(amt)}</li>`;
                });
                html += `</ol>`;
            }

            if (topMerchants.length) {
                html += `<h3>🏪 Where you swipe the most</h3><ol>`;
                topMerchants.forEach(([m, amt]) => {
                    html += `<li><b>${m}</b>: ${this.humanMoney(amt)}</li>`;
                });
                html += `</ol>`;
            }

            html += `<h3>⏰ Timing Patterns</h3>`;
            html += `<ul>`;
            html += `<li>Heaviest spending day: <b>${worstDayName}</b></li>`;
            if (peakHour !== null) {
                const label = this.prettyHourRange(peakHour);
                html += `<li>Peak spending hour (based on entry time): <b>${label}</b></li>`;
            }
            html += `</ul>`;

            html += `<h3>💰 Potential Savings (Forward-Looking)</h3>`;
            html += `<p>You spend about <b>${this.humanMoney(lifestyleSpend)}</b> on lifestyle / discretionary categories.</p>`;
            html += `<ul>`;
            html += `<li>If you cut this by 10% → you could free up about <b>${this.humanMoney(potentialCut10)}</b> every month.</li>`;
            html += `<li>If you cut this by 20% → you could free up about <b>${this.humanMoney(potentialCut20)}</b> every month.</li>`;
            html += `</ul>`;

            html += `<h3>🧠 Overall Financial Health</h3>`;
            html += `<p>Based on your income vs expenses and share of lifestyle spend, I’d rate your financial health at <b>${healthScore}/10</b>.</p>`;

            html += `<h3>📌 3 Things To Do Before Next Salary</h3>`;
            html += `<ol>`;
            if (topCats[0]) {
                html += `<li>Put a hard monthly cap on <b>${topCats[0][0]}</b>. Aim to spend at least 10–20% less than this month.</li>`;
            } else {
                html += `<li>Pick one discretionary area (food delivery, shopping, cabs etc.) and set a strict weekly limit.</li>`;
            }
            html += `<li>On your heavy-spend day (<b>${worstDayName}</b>), pause every time before paying and ask “Will I remember this purchase in 3 months?” If not, skip.</li>`;
            html += `<li>On salary day, move a fixed % (start with 10%) to a separate savings / FD account immediately so it never feels “available” to spend.</li>`;
            html += `</ol>`;

            result.innerHTML = html;
            result.style.display = 'block';

        } catch (err) {
            console.error(err);
            this.showNotification('Local AI analysis failed', 'error');
        } finally {
            loading.style.display = 'none';
        }
    }

    // --- CORE DATA FUNCTIONS ---

    calculateNoSpendStreak(transactions, startDate, endDate) {
        const days = {};
        const start = new Date(startDate);
        const end = new Date(); // streak up to today

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

        let tempDate = new Date();
        while (true) {
            const dateStr = tempDate.toISOString().split('T')[0];
            if (new Date(dateStr) < start) break;
            
            if (days[dateStr]) {
                currentStreak++;
            } else if (dateStr !== todayStr) {
                break;
            } else if (dateStr === todayStr && !days[dateStr]) {
                currentStreak = 0;
                break;
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
        if (this.currentCycleStart && this.currentCycleEnd) {
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
        
        // History dropdown
        document.getElementById('cycle-history')?.addEventListener('change', () => this.handleCycleChange());

        // Buttons
        document.getElementById('load-more-btn')?.addEventListener('click', () => this.loadMoreTransactions());
        document.getElementById('notification-close')?.addEventListener('click', () => this.hideNotification());
        document.getElementById('reset-chart-view-btn')?.addEventListener('click', () => this.renderChartBySource());
        document.getElementById('clear-form-btn')?.addEventListener('click', () => this.resetForm());
        document.getElementById('logout-btn')?.addEventListener('click', handleLogout);

        // Local AI button
        document.getElementById('generate-local-ai-btn')?.addEventListener('click', () => this.generateLocalAIInsights());

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

            const isSalary = transaction.type === 'income' && 
                             transaction.category.toLowerCase().includes('salary');

            if (isSalary) {
                this.showNotification('🎉 New Salary Detected! Updating cycles...', 'success');
                await this.loadCycleHistory();
            } else {
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
        if (this.currentCycleStart && this.currentCycleEnd) {
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
                        y: { 
                            beginAtZero: true,
                            ticks: { callback: (v) => '₹' + v }
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
        const end = new Date(); // up to today

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

    // ---------------- Utility Methods ----------------

    formatCurrency(amount) {
        return '₹' + Number(amount).toLocaleString('en-IN', {
            minimumFractionDigits: 2, maximumFractionDigits: 2
        });
    }

    humanMoney(amount) {
        const n = Number(amount) || 0;
        const sign = n < 0 ? '-' : '';
        const abs = Math.abs(n);
        return sign + '₹' + abs.toLocaleString('en-IN', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        });
    }

    prettyDate(dateStr) {
        const d = new Date(dateStr + 'T00:00:00');
        return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    }

    prettyHourRange(h) {
        const hour = Number(h);
        if (hour === 0) return '12–1 AM';
        if (hour < 12) return `${hour}–${hour + 1} AM`;
        if (hour === 12) return '12–1 PM';
        return `${hour - 12}–${hour - 11} PM`;
    }

    normalizeCategory(catRaw, payToRaw) {
        const text = `${catRaw} ${payToRaw}`.toLowerCase();

        if (text.match(/(rent|lease)/)) return 'rent';
        if (text.match(/(zomato|swiggy|eat|restaurant|food|cafe|hotel)/)) return 'food & eating out';
        if (text.match(/(amazon|flipkart|myntra|ajio|shopping)/)) return 'online shopping';
        if (text.match(/(uber|ola|auto|cab|metro|bus|train|travel|flight|ticket)/)) return 'transport & travel';
        if (text.match(/(electricity|current bill|power|bijli)/)) return 'electricity bill';
        if (text.match(/(internet|wifi|broadband|jiofiber|airtel)/)) return 'internet & phone';
        if (text.match(/(recharge|mobile)/)) return 'mobile recharge';
        if (text.match(/(medical|medicine|pharmacy|hospital|doctor)/)) return 'health & medicine';
        if (text.match(/(fee|college|school|course)/)) return 'education';
        if (text.match(/(insurance|premium)/)) return 'insurance';
        if (text.match(/(mutual fund|sip|mf|investment|stocks|shares)/)) return 'investments';
        if (text.match(/(emi|loan)/)) return 'loan emi';
        if (text.match(/(grocery|groceries|supermarket|d-mart|dmart|bigbasket|jiomart|jio mart)/)) return 'groceries & household';

        return catRaw || 'other';
    }

    mapToBroadBucket(normCat) {
        const c = normCat.toLowerCase();
        if (c.match(/(rent|grocer|household|electricity|water|internet|wifi|broadband|mobile|medicine|health|education|loan emi|emi|fuel|transport)/)) {
            return 'essentials';
        }
        if (c.match(/(food & eating out|online shopping|shopping|entertainment|movies|travel|cab|uber|ola)/)) {
            return 'lifestyle';
        }
        if (c.match(/(insurance|investment|sip|mutual fund|fd|rd|savings)/)) {
            return 'financial';
        }
        return 'other';
    }

    computeHealthScore({ totalIncome, totalExpenses, byBroadBucket, monthsWithData }) {
        if (totalIncome <= 0 || monthsWithData === 0) return 4;

        const expenseRatio = totalExpenses / totalIncome;
        const lifestyleShare = totalExpenses > 0 ? (byBroadBucket.lifestyle / totalExpenses) : 0;

        let score = 10;

        if (expenseRatio > 0.9) score -= 3;
        if (expenseRatio > 1.0) score -= 2;

        if (lifestyleShare > 0.5) score -= 2;
        if (lifestyleShare > 0.7) score -= 1;

        if (byBroadBucket.financial < totalIncome * 0.05) score -= 1;

        if (score < 1) score = 1;
        if (score > 10) score = 10;
        return score;
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
            if (select) select.value = this.salaryAccount;
        } catch {
            // ignore if table not present
        }
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
