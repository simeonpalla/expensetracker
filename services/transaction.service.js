// services/transaction.service.js

export class TransactionService {
    constructor(user, ui, categoryService) {
        this.user = user;
        this.ui = ui;
        this.categoryService = categoryService;

        this.paymentSources = {
            upi: ['UBI', 'ICICI', 'SBI', 'Indian Bank'],
            'debit-card': ['UBI', 'ICICI', 'SBI', 'Indian Bank'],
            'credit-card': [
                'ICICI Platinum',
                'ICICI Amazon Pay',
                'ICICI Coral',
                'RBL Paisabazar'
            ]
        };
    }

    async init() {
        document
            .getElementById('transaction-form')
            .addEventListener('submit', e => this.addTransaction(e));

        document
            .getElementById('type')
            .addEventListener('change', (e) => {
                this.categoryService.updateCategoryDropdown(e.target.value);
                this.resetPaymentSource();
            });

        document
            .getElementById('payment-source')
            .addEventListener('change', (e) => {
                this.updateSourceDetails(e.target.value);
            });

        document
            .getElementById('category')
            .addEventListener('change', () => {
                this.handleSalaryMode();
            });
    }

    async addTransaction(e) {
        e.preventDefault();

        const tx = {
            user_id: this.user.id,
            type: document.getElementById('type').value,
            amount: Number(document.getElementById('amount').value),
            category: document.getElementById('category').value,
            transaction_date: document.getElementById('date').value,
            payment_to: document.getElementById('payment-to').value,
            payment_source: document.getElementById('payment-source').value,
            source_details: document.getElementById('source-details').value || null
        };

        if (!tx.type || !tx.category || tx.amount <= 0) {
            this.ui.showNotification('Fill all required fields', 'error');
            return;
        }

        const { error } = await supabaseClient
            .from('transactions')
            .insert(tx);

        if (error) {
            this.ui.showNotification(error.message, 'error');
            return;
        }

        this.ui.showNotification('Transaction added');
        document.getElementById('transaction-form').reset();
    }

    resetPaymentSource() {
        const ps = document.getElementById('payment-source');
        const sd = document.getElementById('source-details');

        ps.disabled = false;
        sd.disabled = false;
        sd.parentElement.style.display = 'none';
    }

    updateSourceDetails(source) {
        const select = document.getElementById('source-details');
        if (!select) return;

        select.innerHTML = '<option value="">Select Bank / Card</option>';

        const options = this.paymentSources[source];
        if (!options) {
            select.parentElement.style.display = 'none';
            return;
        }

        select.parentElement.style.display = 'block';

        options.forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            select.appendChild(opt);
        });
    }

    handleSalaryMode() {
        const type = document.getElementById('type').value;
        const category = document.getElementById('category').value;

        const ps = document.getElementById('payment-source');
        const sd = document.getElementById('source-details');

        const isSalary =
            type === 'income' &&
            category?.toLowerCase().includes('salary');

        if (isSalary) {
            ps.innerHTML = '<option value="salary">Salary Deposit</option>';
            ps.disabled = true;

            sd.innerHTML = '<option value="Salary Account">Salary Account</option>';
            sd.disabled = true;
            sd.parentElement.style.display = 'block';
        } else {
            ps.disabled = false;
            sd.disabled = false;
        }
    }

    async loadForCycle(cycleStart, cycleEnd) {
        const list = document.getElementById('transactions-list');
        list.innerHTML = '<div class="loading">Loading transactions...</div>';

        const { data, error } = await supabaseClient.rpc(
            'get_transactions_for_cycle',
            { cycle_start: cycleStart, cycle_end: cycleEnd }
        );

        if (error) {
            list.innerHTML = '';
            this.ui.showNotification('Failed to load transactions', 'error');
            return;
        }

        // ✅ SAFE: cache AFTER data exists
        this.ui.analyticsService.analyticsData.transactions = data || [];

        list.innerHTML = '';

        if (!data.length) {
            list.innerHTML = '<div class="empty">No transactions</div>';
            return;
        }

        data.forEach(tx => {
            const row = document.createElement('div');
            row.className = `transaction-item ${tx.type}`;
            row.innerHTML = `
                <div>
                    <strong>${tx.category}</strong>
                    <div class="meta">${tx.payment_to}</div>
                </div>
                <div class="amount">
                    ${tx.type === 'expense' ? '-' : '+'}₹${tx.amount}
                </div>
            `;
            list.appendChild(row);
        });
    }


}
