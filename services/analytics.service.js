// services/analytics.service.js

export class AnalyticsService {
    constructor(user, ui) {
        this.user = user;
        this.ui = ui;
    }

    async init() {
        console.info('[Analytics] Ready');
    }

    async runLocalInsights() {
        try {
            const { data, error } = await supabaseClient
                .from('transactions')
                .select(`
                    amount,
                    type,
                    category,
                    transaction_date,
                    payment_to
                `)
                .eq('user_id', this.user.id);

            if (error) throw error;

            if (!data || data.length < 5) {
                this.ui.showNotification('Not enough data', 'warning');
                return;
            }

            const expense = data
                .filter(t => t.type === 'expense')
                .reduce((s, t) => s + t.amount, 0);

            this.ui.showNotification(
                `Total tracked expense: ₹${expense.toLocaleString('en-IN')}`
            );
        } catch (err) {
            console.error('[Analytics] Insight failed', err);
            this.ui.showNotification('Analytics failed to load', 'error');
        }
    }

    async loadCycleAggregates() {
        try {
            const { data, error } = await supabaseClient
                .from('cycle_aggregates')
                .select('*')
                .order('cycle_start', { ascending: false });

            if (error) throw error;
            return data || [];
        } catch (err) {
            console.warn('[Analytics] cycle_aggregates unavailable');
            return [];
        }
    }

    async loadDailyExpenses(cycleStart, cycleEnd) {
        try {
            const { data, error } = await supabaseClient.rpc(
                'get_cycle_daily_expenses',
                { cycle_start: cycleStart, cycle_end: cycleEnd }
            );

            if (error) throw error;
            return data || [];
        } catch (err) {
            console.warn('[Analytics] daily expenses unavailable');
            return [];
        }
    }
}
