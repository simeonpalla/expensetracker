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

    async loadByCycle(cycleStart) {
        const cycleStartDate = this.normalizeDate(cycleStart);

        // 1️⃣ Fetch cycle window
        const { data: cycle, error: cycleErr } = await supabaseClient
            .from('salary_cycles')
            .select('cycle_start, cycle_end')
            .eq('user_id', this.user.id)
            .eq('cycle_start', cycleStartDate)
            .single();

        if (cycleErr || !cycle) {
            this.renderList([]);
            return;
        }

        // 2️⃣ Fetch transactions in window
        const { data, error } = await supabaseClient
            .from('transactions')
            .select(`
                id,
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

        if (error) {
            this.ui.showNotification('Failed to load transactions', 'error');
            return;
        }

        this.renderList(data || []);
    }

    renderList(transactions) {
        const list = document.getElementById('transactions-list');

        if (!transactions.length) {
            list.innerHTML =
                '<div class="loading">No transactions in this cycle</div>';
            return;
        }

        list.innerHTML = transactions.map(t => `
            <div class="transaction-item">
                <div class="transaction-details">
                    <h4>${t.category}</h4>
                    <p>Paid to: ${t.payment_to || '—'}</p>
                    <small>
                        ${new Date(t.transaction_date).toLocaleDateString('en-IN')}
                        • ${t.source_details || t.payment_source}
                    </small>
                </div>
                <div class="transaction-amount ${t.type}">
                    ${t.type === 'income' ? '+' : '-'}₹${Number(t.amount).toLocaleString('en-IN')}
                </div>
            </div>
        `).join('');
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
            payment_source: paymentSource.value,
            source_details: sourceDetails.value || null
        };

        if (!tx.amount || tx.amount <= 0) {
            this.ui.showNotification('Invalid amount', 'error');
            return;
        }

        const { error } = await supabaseClient
            .from('transactions')
            .insert(tx);

        if (!error) {
            this.ui.showNotification('Transaction added');
        }
    }

    normalizeDate(d) {
        return new Date(d).toISOString().split('T')[0];
    }
}
