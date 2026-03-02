// ======================================================
// EXPENSE TRACKER — FRONTEND CONTROLLER (BFF VERSION)
// Works with Netlify Functions instead of direct Supabase
// ======================================================


// ===============================
// API LAYER (talks to Netlify)
// ===============================
const API = {

    async request(path, options = {}) {

        const session = JSON.parse(localStorage.getItem('session') || 'null');

        const res = await fetch(`/.netlify/functions/${path}`, {
            headers: {
                'Content-Type': 'application/json',
                ...(session?.access_token && {
                    Authorization: `Bearer ${session.access_token}`
                })
            },
            ...options
        });

        if (!res.ok) {
            const text = await res.text();
            throw new Error(text || 'API Error');
        }

        if (res.status === 204) return null;
        return await res.json();
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

    getTransactions(userId) {
        return this.request(`transactions?user_id=${userId}`);
    },

    addTransaction(tx) {
        return this.request('transactions', {
            method: 'POST',
            body: JSON.stringify(tx)
        });
    }
};


// ===============================
// AUTH
// ===============================
async function handleLogin(e) {
    e.preventDefault();

    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    try {
        const session = await API.login(email, password);
        localStorage.setItem('session', JSON.stringify(session));
        location.reload();
    } catch (err) {
        const errorDiv = document.getElementById('auth-error');
        errorDiv.textContent = err.message;
        errorDiv.style.display = 'block';
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

    constructor() {
        const session = JSON.parse(localStorage.getItem('session'));
        this.currentUser = session.user;

        this.transactions = [];
        this.categories = [];

        this.paymentSources = {
            upi: ['UBI', 'ICICI', 'SBI', 'Indian Bank'],
            'debit-card': ['UBI', 'ICICI', 'Indian Bank'],
            'credit-card': ['ICICI Amazon', 'ICICI Coral', 'RBL', 'Union Bank'],
            cash: ['Cash']
        };

        this.init();
    }

    async init() {
        await this.loadCategories();
        await this.loadTransactions();
        this.setupEventListeners();
        this.setTodayDate();
        this.showPage('dashboard');
    }


    // ===============================
    // NAVIGATION
    // ===============================
    showPage(pageId) {
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));

        document.getElementById(pageId)?.classList.add('active');
        document.querySelector(`[data-page="${pageId}"]`)?.classList.add('active');
    }


    // ===============================
    // CATEGORY LOGIC
    // ===============================
    async loadCategories() {
        this.categories = await API.getCategories();
        this.populateCategoryDropdowns();
        this.displayCategories();
    }

    populateCategoryDropdowns() {
        const type = document.getElementById('type').value;
        const select = document.getElementById('category');

        select.innerHTML = '<option value="">Select Category</option>';

        this.categories
            .filter(c => !type || c.type === type)
            .forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.name;
                opt.textContent = `${c.icon} ${c.name}`;
                select.appendChild(opt);
            });

        this.populateFilterCategories();
    }

    populateFilterCategories() {
        const filter = document.getElementById('filter-category');
        filter.innerHTML = '<option value="">All Categories</option>';

        this.categories.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.name;
            opt.textContent = `${c.icon} ${c.name}`;
            filter.appendChild(opt);
        });
    }

    displayCategories() {
        const incomeDiv = document.getElementById('income-categories');
        const expenseDiv = document.getElementById('expense-categories');

        incomeDiv.innerHTML = '';
        expenseDiv.innerHTML = '';

        this.categories.forEach(c => {
            const div = document.createElement('div');
            div.className = 'category-item';
            div.textContent = `${c.icon} ${c.name}`;

            if (c.type === 'income') incomeDiv.appendChild(div);
            else expenseDiv.appendChild(div);
        });
    }

    async handleCategorySubmit(e) {
        e.preventDefault();

        const category = {
            name: document.getElementById('category-name').value,
            type: document.getElementById('category-type').value,
            icon: document.getElementById('category-icon').value || '📁',
            user_id: this.currentUser.id
        };

        await API.addCategory(category);
        await this.loadCategories();
        e.target.reset();
    }


    // ===============================
    // PAYMENT SOURCE → DETAILS
    // ===============================
    updateSourceDetailsOptions() {
        const source = document.getElementById('payment-source').value;
        const details = document.getElementById('source-details');

        details.innerHTML = '<option value="">Select Details</option>';

        (this.paymentSources[source] || []).forEach(s => {
            const opt = document.createElement('option');
            opt.value = s;
            opt.textContent = s;
            details.appendChild(opt);
        });
    }


    // ===============================
    // TRANSACTIONS
    // ===============================
    async loadTransactions() {
        this.transactions = await API.getTransactions(this.currentUser.id);
        this.displayTransactions();
    }

    async handleTransactionSubmit(e) {
        e.preventDefault();

        const tx = {
            type: document.getElementById('type').value,
            amount: parseFloat(document.getElementById('amount').value),
            category: document.getElementById('category').value,
            transaction_date: document.getElementById('date').value,
            description: document.getElementById('description').value || null,
            payment_to: document.getElementById('payment-to').value,
            payment_source: document.getElementById('payment-source').value,
            source_details: document.getElementById('source-details').value || null,
            user_id: this.currentUser.id
        };

        await API.addTransaction(tx);

        e.target.reset();
        this.setTodayDate();
        await this.loadTransactions();
    }

    displayTransactions() {
        const list = document.getElementById('transactions-list');
        const filterType = document.getElementById('filter-type').value;
        const filterCategory = document.getElementById('filter-category').value;

        const filtered = this.transactions.filter(t =>
            (!filterType || t.type === filterType) &&
            (!filterCategory || t.category === filterCategory)
        );

        if (!filtered.length) {
            list.innerHTML = '<div class="loading">No transactions found</div>';
            return;
        }

        list.innerHTML = filtered.map(t => `
            <div class="transaction-item">
                <div>
                    <strong>${t.category}</strong><br>
                    <small>${t.transaction_date}</small>
                </div>
                <div class="${t.type}">
                    ${t.type === 'income' ? '+' : '-'}₹${Number(t.amount).toFixed(2)}
                </div>
            </div>
        `).join('');
    }


    // ===============================
    setTodayDate() {
        document.getElementById('date').value =
            new Date().toISOString().split('T')[0];
    }

    setupEventListeners() {
        document.getElementById('transaction-form')
            .addEventListener('submit', e => this.handleTransactionSubmit(e));

        document.getElementById('category-form')
            .addEventListener('submit', e => this.handleCategorySubmit(e));

        document.getElementById('type')
            .addEventListener('change', () => this.populateCategoryDropdowns());

        document.getElementById('payment-source')
            .addEventListener('change', () => this.updateSourceDetailsOptions());

        document.getElementById('filter-type')
            .addEventListener('change', () => this.displayTransactions());

        document.getElementById('filter-category')
            .addEventListener('change', () => this.displayTransactions());

        document.getElementById('logout-btn')
            .addEventListener('click', handleLogout);

        document.querySelectorAll('.nav-tab').forEach(tab => {
            tab.addEventListener('click', () => this.showPage(tab.dataset.page));
        });
    }
}


// ===============================
// INIT
// ===============================
document.addEventListener('DOMContentLoaded', () => {

    document.getElementById('login-form')
        .addEventListener('submit', handleLogin);

    const session = localStorage.getItem('session');
    const authContainer = document.getElementById('auth-container');
    const appContainer = document.querySelector('.container');

    if (session) {
        authContainer.style.display = 'none';
        appContainer.style.display = 'block';
        window.app = new ExpenseTracker();
    } else {
        authContainer.style.display = 'flex';
    }
});