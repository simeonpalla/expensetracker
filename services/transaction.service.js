// services/transaction.service.js

export class TransactionService {
    constructor(user, ui) {
        this.user = user;
        this.ui = ui;
    }

    async init() {
        document.getElementById('transaction-form')
            .addEventListener('submit', e => this.add(e));
    }

    async add(e) {
        e.preventDefault();

        const tx = {
            user_id: this.user.id,
            type: type.value,
            amount: +amount.value,
            category: category.value,
            transaction_date: date.value,
            payment_to: paymentTo.value,
            payment_source: paymentSource.value
        };

        if (tx.amount <= 0) return this.ui.showNotification('Invalid amount', 'error');

        const { error } = await supabaseClient.from('transactions').insert(tx);
        if (!error) this.ui.showNotification('Transaction added');
    }
}
