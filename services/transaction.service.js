// services/transaction.service.js

export class TransactionService {
    constructor(user, ui) {
        this.user = user;
        this.ui = ui;
    }

    async init() {
        document
            .getElementById('transaction-form')
            ?.addEventListener('submit', e => this.add(e));
    }

    async add(e) {
        e.preventDefault();

        const tx = {
            user_id: this.user.id,
            type: type.value,
            amount: Number(amount.value),
            category: category.value,
            transaction_date: date.value,
            payment_to: paymentTo.value,
            payment_source: paymentSource.value
        };

        if (tx.amount <= 0) {
            this.ui.showNotification('Invalid amount', 'error');
            return;
        }

        await supabaseClient.from('transactions').insert(tx);
        this.ui.showNotification('Transaction added');
    }

    async loadByCycle(cycleStart) {
        const { data: cycle } = await supabaseClient
            .from('salary_cycles')
            .select('cycle_start, cycle_end')
            .eq('user_id', this.user.id)
            .eq('cycle_start', cycleStart)
            .single();

        if (!cycle) return;

        const { data } = await supabaseClient
            .from('transactions')
            .select(`
                type,
                amount,
                category,
                transaction_date,
                payment_to,
                payment_source,
                source_details
            `)
            .eq('user_id', this.user.id)
            .gte('transaction_date', cycle.cycle_start)
            .lte('transaction_date', cycle.cycle_end)
            .order('transaction_date', { ascending: false });

        const list = document.getElementById('transactions-list');

        if (!data?.length) {
            list.innerHTML = '<div class="loading">No transactions</div>';
            return;
        }

        list.innerHTML = data.map(t => `
            <div class="transaction-item">
                <div>
                    <b>${t.category}</b><br>
                    <small>${t.payment_to || ''}</small>
                </div>
                <div class="transaction-amount ${t.type}">
                    ${t.type === 'income' ? '+' : '-'}₹${t.amount}
                </div>
            </div>
        `).join('');
    }
}
