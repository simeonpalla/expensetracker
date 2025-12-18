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
    async loadCycleAggregates() {
        const { data, error } = await supabaseClient
            .from('cycle_aggregates')
            .select(`
                cycle_start,
                cycle_end,
                income,
                expense,
                expense_tx_count
            `)
            .order('cycle_start', { ascending: false });

        if (error) {
            this.ui.showNotification('Failed to load cycle summary', 'error');
            return [];
        }

        return data || [];
    }
    async loadDailyExpenses(cycleStart, cycleEnd) {
        const { data, error } = await supabaseClient.rpc(
            'get_cycle_daily_expenses',
            {
                cycle_start: cycleStart,
                cycle_end: cycleEnd
            }
        );

        if (error) {
            this.ui.showNotification('Failed to load daily expenses', 'error');
            return [];
        }

        return data || [];
    }

}
