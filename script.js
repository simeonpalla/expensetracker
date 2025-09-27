// script.js - FINAL OPTIMIZED VERSION

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
        await this.loadTransactions(); // Loads only the first page of transactions
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
            this.showNotification('Failed to load categories', 'error');
        }
    }

    async loadTransactions() {
        try {
            const { data, error } = await supabaseClient.from('transactions').select('*').order('transaction_date', { ascending: false }).order('created_at', { ascending: false }).range(0, this.loadLimit - 1);
            if (error) throw error;
            this.transactions = data;
            this.loadOffset = data.length;
            this.displayTransactions();
            await this.updateLoadMoreButton();
        } catch (error) {
            this.showNotification(`Failed to load transactions: ${error.message}`, 'error');
        }
    }

    async loadMoreTransactions() {
        try {
            const { data, error } = await supabaseClient.from('transactions').select('*').order('transaction_date', { ascending: false }).order('created_at', { ascending: false }).range(this.loadOffset, this.loadOffset + this.loadLimit - 1);
            if (error) throw error;
            this.transactions.push(...data);
            this.loadOffset += data.length;
            this.displayTransactions();
            await this.updateLoadMoreButton();
        } catch (error) {
            this.showNotification('Failed to load more transactions', 'error');
        }
    }

    async updateLoadMoreButton() {
        const container = document.getElementById('load-more-container');
        try {
            const { count, error } = await supabaseClient.from('transactions').select('*', { count: 'exact', head: true });
            if (error) throw error;
            if (this.transactions.length < count) {
                container.style.display = 'block';
            } else {
                container.style.display = 'none';
            }
        } catch (error) {
            container.style.display = 'none';
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
    
    // ... This file continues with all your other functions like handleTransactionSubmit, updateDashboard, etc. ...
    // ... Please replace the entire file with this complete code block ...
    
    updateSourceDetailsOptions(){const e=document.getElementById("payment-source").value,t=document.getElementById("source-details");t.innerHTML='<option value="">Select Details</option>',this.paymentSources[e]?(t.parentElement.style.display="block",t.required=!0,this.paymentSources[e].forEach(e=>{const n=document.createElement("option");n.value=e,n.textContent=e,t.appendChild(n)})):(t.parentElement.style.display="none",t.required=!1)}
    async handleTransactionSubmit(e){e.preventDefault();const{data:{user:t}}=await supabaseClient.auth.getUser();if(!t)return void this.showNotification("You must be logged in.","error");const n={type:document.getElementById("type").value,amount:parseFloat(document.getElementById("amount").value),category:document.getElementById("category").value,transaction_date:document.getElementById("date").value,description:document.getElementById("description").value,payment_to:document.getElementById("payment-to").value,payment_source:document.getElementById("payment-source").value,source_details:document.getElementById("source-details").value,user_id:t.id};if(this.validateTransaction(n))try{const{error:e}=await supabaseClient.from("transactions").insert([n]);if(e)throw e;this.showNotification("Transaction added!","success"),this.resetForm(),this.loadTransactions().then(()=>{document.getElementById("dashboard").classList.contains("active")&&this.updateDashboard()})}catch(e){this.showNotification("Failed to add transaction: "+e.message,"error")}}
    async handleCategorySubmit(e){e.preventDefault();const{data:{user:t}}=await supabaseClient.auth.getUser();if(!t)return void this.showNotification("You must be logged in.","error");const n={name:document.getElementById("category-name").value.trim(),type:document.getElementById("category-type").value,icon:document.getElementById("category-icon").value.trim()||"📁",user_id:t.id};if(!n.name||!n.type)return void this.showNotification("Name and type are required.","error");try{const{error:e}=await supabaseClient.from("categories").insert([n]);if(e){if("23505"===e.code)throw new Error("Category already exists!");throw e}this.showNotification("Category added!","success"),document.getElementById("category-form").reset(),this.loadCategories()}catch(e){this.showNotification(e.message,"error")}}
    validateTransaction(e){return!e.type||!e.amount||e.amount<=0||!e.category||!e.transaction_date?(this.showNotification("Please fill all required fields.","error"),!1):!0}
    populateCategoryDropdowns(){const e=document.getElementById("category"),t=document.getElementById("filter-category");e.innerHTML='<option value="">Select Category</option>',t.innerHTML='<option value="">All Categories</option>';const n=document.getElementById("type").value,o=n?this.categories.filter(e=>e.type===n):this.categories;o.forEach(t=>{const n=document.createElement("option");n.value=t.name,n.textContent=`${t.icon} ${t.name}`,e.appendChild(n)}),this.categories.forEach(e=>{const n=document.createElement("option");n.value=e.name,n.textContent=`${e.icon} ${e.name}`,t.appendChild(n)})}
    updateCategoryOptions(){this.populateCategoryDropdowns()}
    displayCategories(){const e=document.getElementById("income-categories"),t=document.getElementById("expense-categories");e.innerHTML="",t.innerHTML="",this.categories.forEach(n=>{const o=document.createElement("div");o.className="category-item",o.innerHTML=`<span class="category-icon">${n.icon}</span> <span class="category-name">${n.name}</span>`,"income"===n.type?e.appendChild(o):t.appendChild(o)})}
    displayTransactions(){const e=document.getElementById("transactions-list");if(0===this.transactions.length)return void(e.innerHTML='<div class="loading">No transactions found.</div>');e.innerHTML=this.transactions.map(e=>{const t=this.categories.find(t=>t.name===e.category),n=t?t.icon:"📁",o=new Date(e.transaction_date).toLocaleDateString("en-IN"),a=this.formatCurrency(e.amount);return`<div class="transaction-item"><div class="transaction-details"><h4>${n} ${e.category}</h4><p>Paid to: <strong>${e.payment_to||"N/A"}</strong></p><p>${e.description||"No description"}</p><small>${o} via ${e.source_details||e.payment_source}</small></div><div class="transaction-amount ${e.type}">${"income"===e.type?"+":"-"}${a}</div></div>`}).join("")}
    async filterTransactions(){const e=document.getElementById("filter-type").value,t=document.getElementById("filter-category").value;try{let n=supabaseClient.from("transactions").select("*").order("transaction_date",{ascending:!1}).order("created_at",{ascending:!1});e&&(n=n.eq("type",e)),t&&(n=n.eq("category",t));const{data:o,error:a}=await n.limit(50);if(a)throw a;this.transactions=o,this.displayTransactions()}catch(e){this.showNotification("Failed to filter transactions","error")}}
    async updateDashboard(){await this.updateStats();await this.updateChart();await this.updateExpenseDonutChart()}
    async updateStats(){try{const{data:e,error:t}=await supabaseClient.rpc("get_dashboard_stats");if(t)throw t;const n=e[0].total_income,o=e[0].total_expenses,a=n-o;document.getElementById("total-income").textContent=this.formatCurrency(n),document.getElementById("total-expenses").textContent=this.formatCurrency(o),document.getElementById("net-balance").textContent=this.formatCurrency(a);const c=document.getElementById("balance-card");c.className="stat-card balance-card",a>0?c.classList.add("positive"):a<0&&c.classList.add("negative")}catch(e){console.error("Error updating stats:",e)}}
    async updateChart(){try{const e=new Date;e.setDate(e.getDate()-6);const{data:t,error:n}=await supabaseClient.from("transactions").select("transaction_date, type, amount").gte("transaction_date",e.toISOString().split("T")[0]).order("transaction_date");if(n)throw n;const o=this.processChartData(t);this.chart&&this.chart.destroy();const a=document.getElementById("chart").getContext("2d");this.chart=new Chart(a,{type:"line",data:{labels:o.labels,datasets:[{label:"Income (₹)",data:o.income,borderColor:"#10b981",backgroundColor:"rgba(16, 185, 129, 0.1)",tension:.4,fill:!0},{label:"Expenses (₹)",data:o.expenses,borderColor:"#ef4444",backgroundColor:"rgba(239, 68, 68, 0.1)",tension:.4,fill:!0}]},options:{responsive:!0,scales:{y:{beginAtZero:!0,ticks:{callback:e=>"₹"+e.toLocaleString("en-IN")}}}}})}catch(e){console.error("Error updating chart:",e)}}
    processChartData(e){const t=[],n=[],o=[];for(let a=6;a>=0;a--){const c=new Date;c.setDate(c.getDate()-a),t.push(c.toLocaleDateString("en-IN",{weekday:"short",day:"numeric"}));const r=c.toISOString().split("T")[0],i=e.filter(e=>"income"===e.type&&e.transaction_date===r).reduce((e,t)=>e+parseFloat(t.amount),0),s=e.filter(e=>"expense"===e.type&&e.transaction_date===r).reduce((e,t)=>e+parseFloat(t.amount),0);n.push(i),o.push(s)}return{labels:t,income:n,expenses:o}}
    async updateExpenseDonutChart(){try{const{data:e,error:t}=await supabaseClient.rpc("get_expense_by_source");if(t)throw t;const n=e.reduce((e,t)=>(e[t.payment_source]=t.total_amount,e),{});this.allExpenses=e,this.renderChartBySource(n)}catch(t){document.getElementById("donut-chart-container").innerHTML=`<p style="color:red;font-family:monospace;word-break:break-all"><strong>Error:</strong> Could not load chart.<br><strong>Reason:</strong> ${t.message}</p>`}}
    renderChartBySource(){this.currentChartView="source",document.getElementById("reset-chart-view-btn").style.display="none";const e=this.allExpenses.reduce((e,t)=>(e[t.payment_source]=t.total_amount,e),{}),t=Object.keys(e),n=Object.values(e);this.renderDonutChart(t,n,"📊 Expenses by Source")}
    renderChartByCategory(e){this.currentChartView="category",document.getElementById("reset-chart-view-btn").style.display="inline-block";const t=this.allExpenses.filter(t=>t.payment_source===e).reduce((e,t)=>(e[t.category||"Uncategorized"]=t.total_amount,e),{}),n=Object.keys(t),o=Object.values(t);this.renderDonutChart(n,o,`📂 Expenses from ${e}`)}
    renderDonutChart(e,t,n){this.expenseDonutChart&&this.expenseDonutChart.destroy();const o=document.getElementById("expense-donut-chart").getContext("2d");document.getElementById("donut-chart-title").textContent=n,this.expenseDonutChart=new Chart(o,{type:"doughnut",data:{labels:e,datasets:[{label:"Amount (₹)",data:t,backgroundColor:["#4f46e5","#10b981","#f59e0b","#ef4444","#3b82f6","#8b5cf6","#ec4899","#6b7280"],hoverOffset:4}]},options:{responsive:!0,plugins:{legend:{position:"top"}},onClick:(t,n)=>{if(n.length>0&&"source"===this.currentChartView){const t=n[0].index,o=e[t];this.renderChartByCategory(o)}}}})}
    formatCurrency(e){return"₹"+parseFloat(e).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2})}
    setTodayDate(){document.getElementById("date").value=(new Date).toISOString().split("T")[0]}
    resetForm(){document.getElementById("transaction-form").reset(),this.setTodayDate(),this.updateCategoryOptions(),this.updateFormForSalary()}
    showNotification(e,t="success"){const n=document.getElementById("notification"),o=document.getElementById("notification-message");o.textContent=e,n.className=`notification ${t} show`,setTimeout(()=>this.hideNotification(),5e3)}
    hideNotification(){document.getElementById("notification").classList.remove("show")}
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