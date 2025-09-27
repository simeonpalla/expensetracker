// script.js - FINAL VERSION

class ExpenseTracker {
    constructor() {
        this.transactions = [];
        this.categories = [];
        this.chart = null;
        this.loadOffset = 0;
        this.loadLimit = 10;
        this.salaryAccount = 'ICICI Bank';
        this.expenseDonutChart = null;
        this.allExpenses = [];
        this.currentChartView = 'source';
        this.paymentSources = {
            'upi': ['UBI', 'ICICI', 'SBI', 'Indian Bank'],
            'debit-card': ['UBI', 'ICICI', 'SBI', 'Indian Bank'],
            'credit-card': ['ICICI Platinum', 'ICICI Amazon Pay', 'ICICI Coral', 'RBL Paisabazar', 'UBI CC']
        };
        this.init();
    }

    async init() {
        await this.testConnection();
        await this.loadCategories();
        await this.loadTransactions();
        this.setupEventListeners();
        this.setTodayDate();
        console.log('✅ Expense Tracker initialized!');
    }

    async testConnection() {
        const statusDot = document.getElementById('status-dot');
        const statusText = document.getElementById('status-text');
        try {
            const { error } = await supabaseClient.from('categories').select('*', { count: 'exact', head: true });
            if (error) throw error;
            statusDot.className = 'status-dot connected';
            statusText.textContent = 'Connected to database';
        } catch (error) {
            statusDot.className = 'status-dot error';
            statusText.textContent = 'Database connection failed';
            console.error('❌ Supabase connection failed:', error.message);
        }
    }

    async loadCategories() {
        try {
            const { data, error } = await supabaseClient.from('categories').select('*').order('name');
            if (error) throw error;
            this.categories = data;
            this.populateCategoryDropdowns();
            this.displayCategories();
        } catch (error) {
            console.error('Error loading categories:', error);
            this.showNotification('Failed to load categories', 'error');
        }
    }

    async loadTransactions() {
        try {
            // FINAL TEST: A very simple query to see if ANY data can be loaded.
            const { data, error } = await supabaseClient
                .from('transactions')
                .select('id, amount, description'); // Select only the 3 safest columns

            if (error) {
                // If it still fails, throw the REAL database error
                throw new Error(`Database Error: ${error.message}`);
            }

            // If it succeeds, we can see the data in the browser console
            console.log("Successfully fetched transactions:", data);

            this.transactions = data;
            this.loadOffset = data.length;
            this.displayTransactions();
            this.updateLoadMoreButton();

        } catch (error) {
            console.error('Error loading transactions:', error);
            // This will now show the specific database error on the screen
            this.showNotification(error.message, 'error');
        }
    }
    
    setupEventListeners() {
        document.getElementById('transaction-form').addEventListener('submit', (e) => this.handleTransactionSubmit(e));
        document.getElementById('category-form').addEventListener('submit', (e) => this.handleCategorySubmit(e));
        document.getElementById('type').addEventListener('change', () => { this.updateCategoryOptions(); this.updateFormForSalary(); });
        document.getElementById('category').addEventListener('change', () => this.updateFormForSalary());
        document.getElementById('filter-type').addEventListener('change', () => this.filterTransactions());
        document.getElementById('filter-category').addEventListener('change', () => this.filterTransactions());
        document.getElementById('load-more-btn').addEventListener('click', () => this.loadMoreTransactions());
        document.getElementById('notification-close').addEventListener('click', () => this.hideNotification());
        document.getElementById('payment-source').addEventListener('change', () => this.updateSourceDetailsOptions());
        document.getElementById('reset-chart-view-btn').addEventListener('click', () => this.renderChartBySource());
    }

    updateFormForSalary() {
        const typeSelect = document.getElementById('type');
        const categorySelect = document.getElementById('category');
        const paymentSourceSelect = document.getElementById('payment-source');
        const sourceDetailsSelect = document.getElementById('source-details');
        const isSalary = typeSelect.value === 'income' && categorySelect.value === 'Salary';
        if (isSalary) {
            paymentSourceSelect.innerHTML = `<option value="salary" selected>Salary Deposit</option>`;
            sourceDetailsSelect.innerHTML = `<option value="${this.salaryAccount}" selected>${this.salaryAccount}</option>`;
            paymentSourceSelect.disabled = true;
            sourceDetailsSelect.disabled = true;
            sourceDetailsSelect.parentElement.style.display = 'block';
        } else {
            if (paymentSourceSelect.disabled) {
                paymentSourceSelect.innerHTML = `<option value="">Select Source</option><option value="upi">UPI</option><option value="credit-card">Credit Card</option><option value="debit-card">Debit Card</option><option value="cash">Cash</option>`;
            }
            paymentSourceSelect.disabled = false;
            sourceDetailsSelect.disabled = false;
            this.updateSourceDetailsOptions();
        }
    }

    updateSourceDetailsOptions() {
        const source = document.getElementById('payment-source').value;
        const detailsSelect = document.getElementById('source-details');
        detailsSelect.innerHTML = '<option value="">Select Details</option>';
        if (this.paymentSources[source]) {
            detailsSelect.parentElement.style.display = 'block';
            detailsSelect.required = true;
            this.paymentSources[source].forEach(optionText => {
                const option = document.createElement('option');
                option.value = optionText;
                option.textContent = optionText;
                detailsSelect.appendChild(option);
            });
        } else {
            detailsSelect.parentElement.style.display = 'none';
            detailsSelect.required = false;
        }
    }

    async handleTransactionSubmit(e) {
        e.preventDefault();
        const { data: { user } } = await supabaseClient.auth.getUser();
        if (!user) { this.showNotification('You must be logged in.', 'error'); return; }
        const transaction = {
            type: document.getElementById('type').value,
            amount: parseFloat(document.getElementById('amount').value),
            category: document.getElementById('category').value,
            transaction_date: document.getElementById('date').value,
            description: document.getElementById('description').value,
            payment_to: document.getElementById('payment-to').value,
            payment_source: document.getElementById('payment-source').value,
            source_details: document.getElementById('source-details').value,
            user_id: user.id
        };
        if (!this.validateTransaction(transaction)) return;
        try {
            const { error } = await supabaseClient.from('transactions').insert([transaction]);
            if (error) throw error;
            this.showNotification('Transaction added!', 'success');
            this.resetForm();
            this.loadTransactions().then(() => { if (document.getElementById('dashboard').classList.contains('active')) { this.updateDashboard(); } });
        } catch (error) {
            this.showNotification('Failed to add transaction: ' + error.message, 'error');
        }
    }

    async handleCategorySubmit(e) {
        e.preventDefault();
        const { data: { user } } = await supabaseClient.auth.getUser();
        if (!user) { this.showNotification('You must be logged in.', 'error'); return; }
        const category = {
            name: document.getElementById('category-name').value.trim(),
            type: document.getElementById('category-type').value,
            icon: document.getElementById('category-icon').value.trim() || '📁',
            user_id: user.id
        };
        if (!category.name || !category.type) { this.showNotification('Name and type are required.', 'error'); return; }
        try {
            const { error } = await supabaseClient.from('categories').insert([category]);
            if (error) {
                if (error.code === '23505') throw new Error('Category already exists!');
                throw error;
            }
            this.showNotification('Category added!', 'success');
            document.getElementById('category-form').reset();
            this.loadCategories();
        } catch (error) {
            this.showNotification(error.message, 'error');
        }
    }
    
    async loadMoreTransactions() {
        try {
            const { data, error } = await supabaseClient
                .from('transactions')
                .select('id, transaction_date, type, amount, category, description, payment_to, payment_source, source_details')
                .order('transaction_date', { ascending: false })
                .order('created_at', { ascending: false })
                .range(this.loadOffset, this.loadOffset + this.loadLimit - 1);

            if (error) throw error;
            
            this.transactions.push(...data);
            this.loadOffset += data.length;
            
            this.displayTransactions();
            this.updateLoadMoreButton();
            
        } catch (error) {
            console.error('Error loading more transactions:', error);
            this.showNotification('Failed to load more transactions', 'error');
        }
    }

    async updateLoadMoreButton() {
        const container = document.getElementById('load-more-container');
        try {
            // Get the total count of transactions for the user
            const { count, error } = await supabaseClient
                .from('transactions')
                .select('*', { count: 'exact', head: true });
            
            if (error) throw error;
            
            // If the number of loaded transactions is less than the total count, show the button
            if (this.transactions.length < count) {
                container.style.display = 'block';
            } else {
                container.style.display = 'none';
            }
        } catch (error) {
            console.error('Error checking transaction count:', error);
            container.style.display = 'none'; // Hide button on error
        }
    }
    
    validateTransaction(t){if(!t.type||!t.amount||t.amount<=0||!t.category||!t.transaction_date){this.showNotification('Please fill all required fields.','error');return false}return true}
    
    populateCategoryDropdowns(){const categorySelect=document.getElementById('category');const filterCategorySelect=document.getElementById('filter-category');categorySelect.innerHTML='<option value="">Select Category</option>';filterCategorySelect.innerHTML='<option value="">All Categories</option>';const selectedType=document.getElementById('type').value;const relevantCategories=selectedType?this.categories.filter(cat=>cat.type===selectedType):this.categories;relevantCategories.forEach(c=>{const o=document.createElement('option');o.value=c.name;o.textContent=`${c.icon} ${c.name}`;categorySelect.appendChild(o)});this.categories.forEach(c=>{const o=document.createElement('option');o.value=c.name;o.textContent=`${c.icon} ${c.name}`;filterCategorySelect.appendChild(o)})}
    
    updateCategoryOptions(){this.populateCategoryDropdowns()}
    
    displayCategories(){const incomeContainer=document.getElementById('income-categories');const expenseContainer=document.getElementById('expense-categories');incomeContainer.innerHTML='';expenseContainer.innerHTML='';this.categories.forEach(c=>{const el=document.createElement('div');el.className='category-item';el.innerHTML=`<span class="category-icon">${c.icon}</span> <span class="category-name">${c.name}</span>`;if(c.type==='income'){incomeContainer.appendChild(el)}else{expenseContainer.appendChild(el)}})}
    
    displayTransactions(){const container=document.getElementById('transactions-list');if(this.transactions.length===0){container.innerHTML='<div class="loading">No transactions found.</div>';return}container.innerHTML=this.transactions.map(t=>{const category=this.categories.find(c=>c.name===t.category);const icon=category?category.icon:'📁';const date=new Date(t.transaction_date).toLocaleDateString('en-IN');const amount=this.formatCurrency(t.amount);return`<div class="transaction-item"><div class="transaction-details"><h4>${icon} ${t.category}</h4><p>Paid to: <strong>${t.payment_to||'N/A'}</strong></p><p>${t.description||'No description'}</p><small>${date} via ${t.source_details||t.payment_source}</small></div><div class="transaction-amount ${t.type}">${t.type==='income'?'+':'-'}${amount}</div></div>`}).join('')}
    
    async filterTransactions(){const typeFilter=document.getElementById('filter-type').value;const categoryFilter=document.getElementById('filter-category').value;try{let query=supabaseClient.from('transactions').select('*').order('transaction_date',{ascending:false}).order('created_at',{ascending:false});if(typeFilter)query=query.eq('type',typeFilter);if(categoryFilter)query=query.eq('category',categoryFilter);const{data,error}=await query.limit(50);if(error)throw error;this.transactions=data;this.displayTransactions()}catch(error){this.showNotification('Failed to filter transactions','error')}}
    
    async updateDashboard(){await this.updateStats();await this.updateChart();await this.updateExpenseDonutChart()}
    
    async updateStats(){try{const{data,error}=await supabaseClient.from('transactions').select('type, amount');if(error)throw error;const totalIncome=data.filter(t=>t.type==='income').reduce((sum,t)=>sum+parseFloat(t.amount),0);const totalExpenses=data.filter(t=>t.type==='expense').reduce((sum,t)=>sum+parseFloat(t.amount),0);const netBalance=totalIncome-totalExpenses;document.getElementById('total-income').textContent=this.formatCurrency(totalIncome);document.getElementById('total-expenses').textContent=this.formatCurrency(totalExpenses);document.getElementById('net-balance').textContent=this.formatCurrency(netBalance);const balanceCard=document.getElementById('balance-card');balanceCard.className='stat-card balance-card';if(netBalance>0)balanceCard.classList.add('positive');else if(netBalance<0)balanceCard.classList.add('negative')}catch(error){console.error('Error updating stats:',error)}}
    
    async updateChart(){try{const sevenDaysAgo=new Date();sevenDaysAgo.setDate(sevenDaysAgo.getDate()-6);const{data,error}=await supabaseClient.from('transactions').select('transaction_date, type, amount').gte('transaction_date',sevenDaysAgo.toISOString().split('T')[0]).order('transaction_date');if(error)throw error;const chartData=this.processChartData(data);if(this.chart)this.chart.destroy();const ctx=document.getElementById('chart').getContext('2d');this.chart=new Chart(ctx,{type:'line',data:{labels:chartData.labels,datasets:[{label:'Income (₹)',data:chartData.income,borderColor:'#10b981',backgroundColor:'rgba(16, 185, 129, 0.1)',tension:0.4,fill:true},{label:'Expenses (₹)',data:chartData.expenses,borderColor:'#ef4444',backgroundColor:'rgba(239, 68, 68, 0.1)',tension:0.4,fill:true}]},options:{responsive:true,scales:{y:{beginAtZero:true,ticks:{callback:value=>'₹'+value.toLocaleString('en-IN')}}}}})}catch(error){console.error('Error updating chart:',error)}}
    
    processChartData(data){const labels=[];const income=[];const expenses=[];for(let i=6;i>=0;i--){const date=new Date();date.setDate(date.getDate()-i);labels.push(date.toLocaleDateString('en-IN',{weekday:'short',day:'numeric'}));const dateString=date.toISOString().split('T')[0];const dayIncome=data.filter(t=>t.type==='income'&&t.transaction_date===dateString).reduce((sum,t)=>sum+parseFloat(t.amount),0);const dayExpenses=data.filter(t=>t.type==='expense'&&t.transaction_date===dateString).reduce((sum,t)=>sum+parseFloat(t.amount),0);income.push(dayIncome);expenses.push(dayExpenses)}return{labels,income,expenses}}
    
    async updateExpenseDonutChart(){try{const{data,error}=await supabaseClient.from('transactions').select('payment_source, category, amount').eq('type','expense');if(error)throw error;this.allExpenses=data;this.renderChartBySource()}catch(error){console.error('Error fetching data for donut chart:',error);document.getElementById('donut-chart-container').innerHTML=`<p style="color: red; font-family: monospace; word-break: break-all;"><strong>Error:</strong> Could not load chart.<br><strong>Reason:</strong> ${error.message}</p>`}}
    
    renderChartBySource(){this.currentChartView='source';document.getElementById('reset-chart-view-btn').style.display='none';const sourceData=this.allExpenses.reduce((acc,e)=>{const source=e.payment_source||'Unknown';if(!acc[source])acc[source]=0;acc[source]+=e.amount;return acc},{});const labels=Object.keys(sourceData);const data=Object.values(sourceData);this.renderDonutChart(labels,data,'📊 Expenses by Source')}
    
    renderChartByCategory(source){this.currentChartView='category';document.getElementById('reset-chart-view-btn').style.display='inline-block';const categoryData=this.allExpenses.filter(e=>(e.payment_source||'Unknown')===source).reduce((acc,e)=>{const category=e.category||'Uncategorized';if(!acc[category])acc[category]=0;acc[category]+=e.amount;return acc},{});const labels=Object.keys(categoryData);const data=Object.values(categoryData);this.renderDonutChart(labels,data,`📂 Expenses from ${source}`)}
    
    renderDonutChart(labels,data,title){if(this.expenseDonutChart)this.expenseDonutChart.destroy();const ctx=document.getElementById('expense-donut-chart').getContext('2d');document.getElementById('donut-chart-title').textContent=title;this.expenseDonutChart=new Chart(ctx,{type:'doughnut',data:{labels:labels,datasets:[{label:'Amount (₹)',data:data,backgroundColor:['#4f46e5','#10b981','#f59e0b','#ef4444','#3b82f6','#8b5cf6','#ec4899','#6b7280'],hoverOffset:4}]},options:{responsive:true,plugins:{legend:{position:'top'}},onClick:(event,elements)=>{if(elements.length>0&&this.currentChartView==='source'){const i=elements[0].index;const source=labels[i];this.renderChartByCategory(source)}}}})}
    
    formatCurrency(amount){return'₹'+parseFloat(amount).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}
    
    setTodayDate(){document.getElementById('date').value=new Date().toISOString().split('T')[0]}
    
    resetForm(){document.getElementById('transaction-form').reset();this.setTodayDate();this.updateCategoryOptions();this.updateFormForSalary()}
    
    showNotification(message,type='success'){const n=document.getElementById('notification');const m=document.getElementById('notification-message');m.textContent=message;n.className=`notification ${type} show`;setTimeout(()=>this.hideNotification(),5000)}
    
    hideNotification(){document.getElementById('notification').classList.remove('show')}
}

function showPage(pageId,event){document.querySelectorAll('.page').forEach(page=>page.classList.remove('active'));document.querySelectorAll('.nav-tab').forEach(tab=>tab.classList.remove('active'));document.getElementById(pageId).classList.add('active');if(event)event.target.classList.add('active');if(pageId==='dashboard'&&window.expenseTracker){window.expenseTracker.updateDashboard()}}
function resetForm(){if(window.expenseTracker)window.expenseTracker.resetForm()}

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