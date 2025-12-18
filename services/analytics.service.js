// services/analytics.service.js

export class AnalyticsService {
    constructor(user, ui) {
        this.user = user;
        this.ui = ui;
    }

    async init() {
        // placeholder for monthly preload
    }

    async runLocalInsights() {
        const { data } = await supabaseClient
            .from('transactions')
            .select(`
                amount,
                type,
                category,
                transaction_date,
                payment_to
            `)
            .eq('user_id', this.user.id);

        if (!data || data.length < 5) {
            return this.ui.showNotification('Not enough data', 'warning');
        }

        const expense = data.filter(t => t.type === 'expense')
            .reduce((s, t) => s + t.amount, 0);

        this.ui.showNotification(
            `Total tracked expense: ₹${expense.toLocaleString('en-IN')}`
        );
    }
}
